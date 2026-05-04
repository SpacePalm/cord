// Глобальная палитра команд (Ctrl/Cmd+K).
// Один инпут, фильтрация по серверам, каналам, действиям и админ-функциям.
// Источники данных — React Query кэш (['groups'], ['chats', groupId]) и zustand-сторы.
//
// Навигация:
//   — канал: setLastGroup+setLastChannel → AppPage подписан и синкает локальный стейт
//   — группа: setLastGroup → AppPage выберет первый текстовый канал
//   — admin/settings/logout: через react-router navigate или сторы

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Search, Hash, Volume2, Server, Shield, LogOut, Settings, Languages, Plus, MessageSquare, User as UserIcon, Filter } from 'lucide-react';
import type { Chat, Group } from '../types';
import { authApi } from '../api/auth';
import { useAuthStore } from '../store/authStore';
import { useSessionStore } from '../store/sessionStore';
import { useLangStore, useT, LANGUAGES } from '../i18n';
import { groupsApi } from '../api/groups';
import { searchApi, type UserShort, type GlobalMessageHit } from '../api/search';
import { dmsApi } from '../api/dms';

type ItemKind = 'channel' | 'group' | 'settings' | 'user' | 'message' | 'action' | 'admin';

// Фильтры для быстрого сужения выдачи. 'all' — ничего не фильтрует.
// 'nav' объединяет серверы и каналы, 'command' — действия/настройки/админ-пункты.
type Filter = 'all' | 'nav' | 'user' | 'message' | 'command';

const FILTERS: Array<{ key: Filter; labelKey: string; prefix?: string }> = [
  { key: 'all',     labelKey: 'palette.filterAll' },
  { key: 'nav',     labelKey: 'palette.filterNav',      prefix: '#' },
  { key: 'user',    labelKey: 'palette.filterPeople',   prefix: '@' },
  { key: 'message', labelKey: 'palette.filterMessages' },
  { key: 'command', labelKey: 'palette.filterCommands', prefix: '>' },
];

// Какие виды Item показывать при данном фильтре.
function matchesFilter(filter: Filter, kind: ItemKind): boolean {
  if (filter === 'all') return true;
  if (filter === 'nav') return kind === 'channel' || kind === 'group';
  if (filter === 'user') return kind === 'user';
  if (filter === 'message') return kind === 'message';
  if (filter === 'command') return kind === 'action' || kind === 'settings' || kind === 'admin';
  return true;
}

// Индекс вкладок настроек — для поиска по параметрам (#фаза 1).
// labelKey должен содержать синонимы: «Профиль — имя и аватар» → ищется и по «аватар».
const SETTINGS_INDEX: Array<{ key: string; tab: string; labelKey: string }> = [
  { key: 'set:profile',       tab: 'profile',       labelKey: 'palette.setProfile'       },
  { key: 'set:security',      tab: 'security',      labelKey: 'palette.setSecurity'      },
  { key: 'set:audio',         tab: 'audio',         labelKey: 'palette.setAudio'         },
  { key: 'set:notifications', tab: 'notifications', labelKey: 'palette.setNotifications' },
  { key: 'set:appearance',    tab: 'appearance',    labelKey: 'palette.setAppearance'    },
  { key: 'set:language',      tab: 'language',      labelKey: 'palette.setLanguage'      },
];

interface Item {
  key: string;
  kind: ItemKind;
  label: string;
  // Если задан — рендерится вместо label (для подсветки совпадений и т.п.)
  labelNode?: React.ReactNode;
  hint?: string;
  hintNode?: React.ReactNode;
  icon: React.ReactNode;
  onSelect: () => void;
  // Задизейбленные пункты остаются в списке, но не кликаются/не выбираются Enter'ом.
  disabled?: boolean;
  disabledReason?: string;
}

// Подсветка совпадений: разбивает текст на сегменты по каждому слову запроса,
// совпадающие (без учёта регистра) оборачивает в <mark>.
function highlight(text: string, query: string): React.ReactNode {
  const words = query.trim().split(/\s+/).filter((w) => w.length >= 2);
  if (words.length === 0) return text;
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = text.split(re);
  return parts.map((part, i) =>
    i % 2 === 1
      ? <mark key={i} className="bg-[var(--accent)]/30 text-[var(--text-primary)] rounded px-0.5">{part}</mark>
      : <span key={i}>{part}</span>
  );
}

// История поиска — до 10 последних успешных запросов в localStorage.
const HISTORY_KEY = 'cord:search-history';
const HISTORY_MAX = 10;

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string').slice(0, HISTORY_MAX) : [];
  } catch { return []; }
}

// Возвращает фрагмент длиной ~width с контекстом вокруг первого совпадения q.
// Если совпадений нет или q пуст — просто первые width символов.
function _snippetAround(text: string, q: string, width: number): string {
  const words = q.trim().split(/\s+/).filter((w) => w.length >= 2);
  if (words.length === 0 || text.length <= width) return text.slice(0, width);
  const lower = text.toLowerCase();
  const idx = words
    .map((w) => lower.indexOf(w.toLowerCase()))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)[0];
  if (idx === undefined) return text.slice(0, width);
  const pad = Math.max(0, Math.floor((width - words[0].length) / 2));
  const start = Math.max(0, idx - pad);
  const snippet = text.slice(start, start + width);
  return (start > 0 ? '…' : '') + snippet + (start + width < text.length ? '…' : '');
}

function saveHistory(q: string): string[] {
  const trimmed = q.trim();
  if (trimmed.length < 2) return loadHistory();
  const current = loadHistory().filter((x) => x !== trimmed);
  const updated = [trimmed, ...current].slice(0, HISTORY_MAX);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(updated)); } catch { /* quota */ }
  return updated;
}

// Палитра хранит своё состояние в sessionStore. Хоткеи:
//   Cmd/Ctrl+K — тоггл палитры
//   Cmd/Ctrl+Shift+F — расширенный поиск напрямую
function usePaletteOpenState() {
  const open = useSessionStore((s) => s.uiPaletteOpen);
  const togglePalette = useSessionStore((s) => s.togglePalette);
  const closePalette = useSessionStore((s) => s.closePalette);
  const openAdvancedSearch = useSessionStore((s) => s.openAdvancedSearch);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (e.shiftKey && (k === 'f' || k === 'а')) {
        e.preventDefault();
        openAdvancedSearch();
        return;
      }
      if (!e.shiftKey && (k === 'k' || k === 'л')) {
        e.preventDefault();
        togglePalette();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [togglePalette, openAdvancedSearch]);

  return [open, (v: boolean) => (v ? useSessionStore.getState().openPalette() : closePalette())] as const;
}

export function CommandPalette() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const setLang = useLangStore((s) => s.setLang);
  const lang = useLangStore((s) => s.lang);
  const setLastGroup = useSessionStore((s) => s.setLastGroup);
  const setLastChannel = useSessionStore((s) => s.setLastChannel);
  const openSettings = useSessionStore((s) => s.openSettings);
  const openCreateServer = useSessionStore((s) => s.openCreateServer);
  const setPendingJumpTo = useSessionStore((s) => s.setPendingJumpTo);
  // Во время звонка блокируем переходы в админ-панель — смена страницы может
  // оборвать голосовую сессию.
  const voicePresence = useSessionStore((s) => s.voicePresence);
  const inCall = voicePresence !== null;

  const [open, setOpen] = usePaletteOpenState();
  const [rawQuery, setRawQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [activeIdx, setActiveIdx] = useState(0);
  // Какие секции раскрыты («Показать ещё» нажата для этого kind)
  const [expanded, setExpanded] = useState<Set<ItemKind>>(new Set());
  const openAdvancedSearch = useSessionStore((s) => s.openAdvancedSearch);
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Ref на текущий плоский список видимых элементов — используется в handleKey
  // (он объявлен до того, как рендер построит visibleItems).
  const visibleItemsRef = useRef<Item[]>([]);

  // Префиксы: первый символ переключает фильтр, оставшийся текст — собственно запрос.
  // Например, '#gen' → filter='nav', query='gen'. Если пользователь уже выбрал
  // фильтр чипом — префикс игнорируется (фильтр важнее).
  const { effectiveFilter, query } = useMemo(() => {
    const trimmed = rawQuery.trimStart();
    if (filter === 'all' && trimmed.length > 0) {
      const f = FILTERS.find((x) => x.prefix && trimmed.startsWith(x.prefix));
      if (f) return { effectiveFilter: f.key, query: trimmed.slice(f.prefix!.length).trim() };
    }
    return { effectiveFilter: filter, query: trimmed.trim() };
  }, [rawQuery, filter]);

  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Debounce запроса для async-секций: поиск людей/сообщений с задержкой 300 мс,
  // чтобы не палить бэк при каждом нажатии клавиши.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(id);
  }, [query]);

  const asyncEnabled = open && debouncedQuery.length >= 2;
  // Если активирован фильтр только nav/command — async-запросы не нужны, экономим бэк.
  const wantUsers = asyncEnabled && (effectiveFilter === 'all' || effectiveFilter === 'user');
  const wantMessages = asyncEnabled && (effectiveFilter === 'all' || effectiveFilter === 'message');

  const { data: userHits = [], isFetching: usersLoading } = useQuery({
    queryKey: ['palette-users', debouncedQuery],
    queryFn: () => searchApi.users(debouncedQuery),
    enabled: wantUsers,
    staleTime: 10_000,
  });

  const { data: messageHits = [], isFetching: messagesLoading } = useQuery({
    queryKey: ['palette-messages', debouncedQuery],
    queryFn: () => searchApi.messages({ q: debouncedQuery, limit: 25 }),
    enabled: wantMessages,
    staleTime: 10_000,
  });

  // Группы — через useQuery, чтобы реагировать на изменение кэша AppPage'а
  const { data: groupsData } = useQuery<Group[]>({
    queryKey: ['groups'],
    queryFn: groupsApi.list,
    staleTime: 30_000,
  });
  const groups = groupsData ?? [];

  // Префетч каналов для всех групп при открытии палитры, чтобы поиск работал глобально.
  // React Query кэширует — при повторных открытиях мгновенно.
  const channelQueries = useQueries({
    queries: groups.map((g) => ({
      queryKey: ['chats', g.id],
      queryFn: () => groupsApi.listChats(g.id),
      enabled: open,
      staleTime: 30_000,
    })),
  });

  // Для поиска каналов исключаем DM-группы: их "каналы" (text + voice) —
  // это внутренняя структура личных сообщений, а не отдельные места навигации.
  // Навигация к DM идёт через фильтр "Люди" (@) + выбор собеседника.
  const channels = useMemo(() => {
    const out: Array<{ chat: Chat; group: Group }> = [];
    groups.forEach((g, i) => {
      if (g.is_dm) return;
      const list = (channelQueries[i]?.data ?? []) as Chat[];
      list.forEach((c) => out.push({ chat: c, group: g }));
    });
    return out;
  }, [groups, channelQueries]);

  // Сброс при открытии
  useEffect(() => {
    if (open) {
      setRawQuery('');
      setFilter('all');
      setActiveIdx(0);
      setExpanded(new Set());
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Сброс раскрытых секций при изменении запроса или фильтра — иначе старая "раскрытость"
  // вводит в заблуждение на новой выдаче.
  useEffect(() => {
    setExpanded(new Set());
  }, [debouncedQuery, effectiveFilter]);

  const goToChannel = (groupId: string, channelId: string) => {
    setLastGroup(groupId);
    setLastChannel(channelId);
    if (location.pathname !== '/app') navigate('/app');
    setOpen(false);
  };

  const goToGroup = (groupId: string) => {
    setLastGroup(groupId);
    setLastChannel(null); // AppPage подберёт первый канал
    if (location.pathname !== '/app') navigate('/app');
    setOpen(false);
  };

  // Успешный выбор async-результата (человека или сообщения) — сохраняем запрос в истории.
  const persistQuery = () => {
    if (debouncedQuery.length >= 2) setHistory(saveHistory(debouncedQuery));
  };

  const jumpToMessage = (hit: GlobalMessageHit) => {
    persistQuery();
    setLastGroup(hit.group_id);
    setLastChannel(hit.chat_id);
    setPendingJumpTo({ chatId: hit.chat_id, messageId: hit.id, createdAt: hit.created_at });
    if (location.pathname !== '/app') navigate('/app');
    setOpen(false);
  };

  const setDmMode = useSessionStore.getState().setDmMode;

  // Клик по пользователю — открыть (или создать) DM с ним.
  // Идемпотентно: если DM уже была, просто переходим в неё.
  const pickUser = async (u: UserShort) => {
    persistQuery();
    setOpen(false);
    try {
      const dm = await dmsApi.openWith(u.id);
      setLastGroup(dm.group_id);
      setLastChannel(dm.chat_id);
      setDmMode(true);
      if (location.pathname !== '/app') navigate('/app');
    } catch {
      // Фолбэк — копируем @username если API недоступно
      navigator.clipboard.writeText(`@${u.username}`).catch(() => {});
    }
  };

  // Построение списка
  const items: Item[] = useMemo(() => {
    const q = query.toLowerCase();
    const match = (s: string) => !q || s.toLowerCase().includes(q);

    const result: Item[] = [];

    // Каналы
    for (const { chat, group } of channels) {
      if (match(chat.name) || match(group.name)) {
        const baseIcon = chat.type === 'voice' ? <Volume2 size={15} /> : <Hash size={15} />;
        // Цветной кружок (если есть) рядом с иконкой канала.
        const icon = chat.color ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: chat.color }} aria-hidden />
            {baseIcon}
          </span>
        ) : baseIcon;
        result.push({
          key: `ch:${chat.id}`,
          kind: 'channel',
          label: chat.name,
          hint: group.name,
          icon,
          onSelect: () => goToChannel(group.id, chat.id),
        });
      }
    }

    // Группы — DM-группы не показываем как "сервер", переход в DM идёт через
    // фильтр "Люди" + выбор собеседника (см. pickUser).
    for (const g of groups) {
      if (g.is_dm) continue;
      if (match(g.name)) {
        result.push({
          key: `g:${g.id}`,
          kind: 'group',
          label: g.name,
          hint: t('palette.group'),
          icon: <Server size={15} />,
          onSelect: () => goToGroup(g.id),
        });
      }
    }

    // Настройки (индексированные вкладки)
    for (const s of SETTINGS_INDEX) {
      const label = t(s.labelKey);
      if (match(label)) {
        result.push({
          key: s.key,
          kind: 'settings',
          label,
          hint: t('palette.inSettings'),
          icon: <Settings size={15} />,
          onSelect: () => {
            setOpen(false);
            if (location.pathname !== '/app') navigate('/app');
            openSettings(s.tab);
          },
        });
      }
    }

    // Люди (async — бэк уже отфильтровал по подстроке)
    for (const u of userHits) {
      const label = u.display_name || u.username;
      result.push({
        key: `u:${u.id}`,
        kind: 'user',
        label,
        labelNode: highlight(label, query),
        hint: `@${u.username}`,
        hintNode: <>@{highlight(u.username, query)}</>,
        icon: u.image_path
          ? <img src={u.image_path} alt="" className="w-4 h-4 rounded-full object-cover" />
          : <UserIcon size={15} />,
        onSelect: () => pickUser(u),
      });
    }

    // Сообщения (async). Превью — фрагмент вокруг первого совпадения, чтобы юзер
    // видел не «начало текста», а именно где матчится.
    // Цвет канала резолвим из локального кэша каналов (groups → channels).
    const chatColorById = new Map<string, string | null | undefined>();
    for (const { chat } of channels) chatColorById.set(chat.id, chat.color);
    for (const m of messageHits) {
      const content = (m.content ?? '').replace(/\s+/g, ' ');
      const preview = _snippetAround(content, query, 80);
      const color = chatColorById.get(m.chat_id);
      const hintNode = (
        <span className="inline-flex items-center gap-1.5">
          <span>{m.author_display_name} ·</span>
          {color && (
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} aria-hidden />
          )}
          <span>#{m.chat_name}</span>
        </span>
      );
      result.push({
        key: `m:${m.id}`,
        kind: 'message',
        label: preview || '…',
        labelNode: highlight(preview || '…', query),
        hint: `${m.author_display_name} · #${m.chat_name}`,
        hintNode,
        icon: <MessageSquare size={15} />,
        onSelect: () => jumpToMessage(m),
      });
    }

    // Универсальные действия
    const actions: Array<Omit<Item, 'kind'>> = [
      {
        key: 'a:lang',
        label: t('palette.toggleLang'),
        hint: LANGUAGES[lang === 'ru' ? 'en' : 'ru']?.label,
        icon: <Languages size={15} />,
        onSelect: () => {
          setLang(lang === 'ru' ? 'en' : 'ru');
          setOpen(false);
        },
      },
      {
        key: 'a:create-server',
        label: t('palette.createServer'),
        icon: <Plus size={15} />,
        onSelect: () => {
          setOpen(false);
          if (location.pathname !== '/app') navigate('/app');
          openCreateServer();
        },
      },
      {
        key: 'a:logout',
        label: t('palette.logout'),
        icon: <LogOut size={15} />,
        onSelect: () => {
          const rt = localStorage.getItem('refresh_token');
          if (rt) authApi.logoutOnServer(rt).catch(() => {});
          logout();
          navigate('/login');
          setOpen(false);
        },
      },
    ];
    for (const a of actions) {
      if (match(a.label)) result.push({ ...a, kind: 'action' });
    }

    // Админ-зона — только для админов
    if (user?.role === 'admin') {
      const adminActions: Array<Omit<Item, 'kind'>> = [
        {
          key: 'adm:panel',
          label: t('palette.adminPanel'),
          icon: <Shield size={15} />,
          onSelect: () => { navigate('/admin'); setOpen(false); },
        },
        {
          key: 'adm:users',
          label: t('palette.adminUsers'),
          icon: <Shield size={15} />,
          onSelect: () => { navigate('/admin?tab=users'); setOpen(false); },
        },
        {
          key: 'adm:system',
          label: t('palette.adminSystem'),
          icon: <Shield size={15} />,
          onSelect: () => { navigate('/admin?tab=system'); setOpen(false); },
        },
      ];
      for (const a of adminActions) {
        if (match(a.label)) {
          result.push({
            ...a,
            kind: 'admin',
            disabled: inCall,
            disabledReason: inCall ? t('palette.disabledInCall') : undefined,
          });
        }
      }
    }

    // Финальная фильтрация по активному фильтру (чип или префикс)
    return effectiveFilter === 'all' ? result : result.filter((it) => matchesFilter(effectiveFilter, it.kind));
  }, [query, effectiveFilter, channels, groups, userHits, messageHits, user, lang, t, inCall, setLang, logout, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Держим activeIdx в диапазоне
  useEffect(() => {
    // Клэмп по видимым элементам (могут быть <items из-за SECTION_CAPS)
    const len = visibleItemsRef.current.length;
    if (activeIdx >= len) setActiveIdx(Math.max(0, len - 1));
  }, [items, expanded, effectiveFilter, activeIdx]);

  // Скролл к активному элементу
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  const handleKey = (e: React.KeyboardEvent) => {
    const visible = visibleItemsRef.current;
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, visible.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = visible[activeIdx];
      if (item && !item.disabled) item.onSelect();
    } else if (e.key === 'Tab') {
      // Tab / Shift+Tab — циклический переключатель фильтра
      e.preventDefault();
      const idx = FILTERS.findIndex((f) => f.key === effectiveFilter);
      const next = e.shiftKey
        ? (idx - 1 + FILTERS.length) % FILTERS.length
        : (idx + 1) % FILTERS.length;
      setFilter(FILTERS[next].key);
      setActiveIdx(0);
    } else if (e.key === 'Backspace' && rawQuery === '' && filter !== 'all') {
      // Backspace в пустом инпуте — снять фильтр
      e.preventDefault();
      setFilter('all');
    }
  };

  if (!open) return null;

  // Заголовки секций
  const sectionLabel = (kind: ItemKind): string =>
    kind === 'channel' ? t('palette.channels')
    : kind === 'group' ? t('palette.groups')
    : kind === 'settings' ? t('palette.settingsSection')
    : kind === 'user' ? t('palette.people')
    : kind === 'message' ? t('palette.messagesSection')
    : kind === 'admin' ? t('palette.adminSection')
    : t('palette.actions');

  // Кэпы по секциям: когда фильтр === 'all' — показываем верхушки каждой секции,
  // остальное прячем под "Показать ещё". При активном фильтре (Люди/Сообщения/...) —
  // показываем всё, т.к. пользователь явно попросил один тип.
  const SECTION_CAPS: Record<ItemKind, number> = {
    channel: 5, group: 5, user: 5, message: 5,
    // Секции малые по природе — показываем целиком всегда.
    settings: 20, action: 20, admin: 20,
  };

  // Группируем items по kind с сохранением исходного порядка
  const grouped: Array<{ kind: ItemKind; items: Item[] }> = [];
  let lastGroup: { kind: ItemKind; items: Item[] } | null = null;
  for (const item of items) {
    if (!lastGroup || lastGroup.kind !== item.kind) {
      lastGroup = { kind: item.kind, items: [] };
      grouped.push(lastGroup);
    }
    lastGroup.items.push(item);
  }

  // Плоский список видимых элементов — для клавиатурной навигации (активные индексы
  // указывают на реальные доступные элементы, а не на items из исходного массива).
  const visibleItems: Item[] = [];
  // Финальный рендер: заголовок → ограниченный список → "Показать ещё"
  const rendered: React.ReactNode[] = [];
  let globalIdx = 0;

  // История поиска — показываем только когда запрос пуст и фильтр 'all'.
  // Клик → подставляет в инпут, который триггерит обычный поиск.
  const showHistory = rawQuery.trim().length === 0 && effectiveFilter === 'all' && history.length > 0;
  if (showHistory) {
    rendered.push(
      <div key="h-history" className="flex items-center justify-between px-3 pt-2 pb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          {t('palette.historySection')}
        </span>
        <button
          onClick={() => { localStorage.removeItem(HISTORY_KEY); setHistory([]); }}
          className="text-[10px] text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors"
        >
          {t('palette.historyClear')}
        </button>
      </div>
    );
    for (const h of history) {
      const idx = globalIdx;
      const isActive = idx === activeIdx;
      const historyItem: Item = {
        key: `hist:${h}`,
        kind: 'action',
        label: h,
        icon: <Search size={15} />,
        onSelect: () => { setRawQuery(h); setActiveIdx(0); inputRef.current?.focus(); },
      };
      visibleItems.push(historyItem);
      rendered.push(
        <button
          key={historyItem.key}
          data-idx={idx}
          onMouseEnter={() => setActiveIdx(idx)}
          onClick={() => historyItem.onSelect()}
          className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
            isActive ? 'bg-[var(--accent)]/15 text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-white/5'
          }`}
        >
          <span className={`shrink-0 ${isActive ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
            <Search size={15} />
          </span>
          <span className="flex-1 truncate">{h}</span>
        </button>
      );
      globalIdx++;
    }
  }

  for (const group of grouped) {
    const cap = effectiveFilter === 'all' ? SECTION_CAPS[group.kind] : Infinity;
    const isExpanded = expanded.has(group.kind);
    const visibleCount = isExpanded ? group.items.length : Math.min(group.items.length, cap);
    const hiddenCount = group.items.length - visibleCount;

    rendered.push(
      <div key={`h-${group.kind}`} className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        {sectionLabel(group.kind)}
      </div>
    );

    for (let i = 0; i < visibleCount; i++) {
      const item = group.items[i];
      visibleItems.push(item);
      const idx = globalIdx;
      const isActive = idx === activeIdx;
      rendered.push(
        <button
          key={item.key}
          data-idx={idx}
          disabled={item.disabled}
          title={item.disabledReason}
          onMouseEnter={() => setActiveIdx(idx)}
          onClick={() => { if (!item.disabled) item.onSelect(); }}
          className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
            item.disabled
              ? 'text-[var(--text-muted)] opacity-50 cursor-not-allowed'
              : isActive
                ? 'bg-[var(--accent)]/15 text-[var(--text-primary)]'
                : 'text-[var(--text-secondary)] hover:bg-white/5'
          }`}
        >
          <span className={`shrink-0 ${
            item.disabled ? 'text-[var(--text-muted)]'
            : isActive ? 'text-[var(--accent)]'
            : 'text-[var(--text-muted)]'
          }`}>
            {item.icon}
          </span>
          <span className="flex-1 truncate">{item.labelNode ?? item.label}</span>
          {item.disabled && item.disabledReason ? (
            <span className="text-[10px] text-[var(--text-muted)] shrink-0">{item.disabledReason}</span>
          ) : (item.hintNode || item.hint) && (
            <span className="text-xs text-[var(--text-muted)] shrink-0">{item.hintNode ?? item.hint}</span>
          )}
        </button>
      );
      globalIdx++;
    }

    if (hiddenCount > 0) {
      rendered.push(
        <button
          key={`more-${group.kind}`}
          onClick={() => setExpanded((prev) => new Set(prev).add(group.kind))}
          className="w-full px-3 py-1.5 text-xs text-[var(--accent)] hover:bg-white/5 text-left transition-colors"
        >
          {t('palette.showMore', { count: String(hiddenCount) })}
        </button>
      );
    }
  }
  // Синхронизируем ref для handleKey
  visibleItemsRef.current = visibleItems;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] bg-black/50 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
    >
      <div className="w-[min(92vw,560px)] rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-3 border-b border-[var(--border-color)]">
          <Search size={16} className="text-[var(--text-muted)] shrink-0" />
          <input
            ref={inputRef}
            value={rawQuery}
            onChange={(e) => { setRawQuery(e.target.value); setActiveIdx(0); }}
            onKeyDown={handleKey}
            placeholder={t('palette.placeholder')}
            className="flex-1 bg-transparent py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
          />
          {(usersLoading || messagesLoading) && (
            <div className="w-3 h-3 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin shrink-0" />
          )}
          <kbd className="text-[10px] text-[var(--text-muted)] border border-[var(--border-color)] rounded px-1.5 py-0.5 shrink-0">
            ESC
          </kbd>
        </div>

        {/* Чипы фильтров + кнопка расширенного поиска справа */}
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[var(--border-color)] overflow-x-auto">
          {FILTERS.map((f) => {
            const active = effectiveFilter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => { setFilter(f.key); setActiveIdx(0); inputRef.current?.focus(); }}
                className={`shrink-0 px-2 py-1 rounded text-xs transition-colors ${
                  active
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5'
                }`}
              >
                {t(f.labelKey)}
                {f.prefix && <span className={`ml-1 ${active ? 'opacity-70' : 'opacity-50'}`}>{f.prefix}</span>}
              </button>
            );
          })}
          <button
            onClick={() => {
              openAdvancedSearch();
              setOpen(false);
            }}
            title={t('palette.advancedHint')}
            className="ml-auto shrink-0 flex items-center gap-1 px-2 py-1 rounded text-xs text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-white/5 transition-colors"
          >
            <Filter size={11} />
            <span>{t('palette.advanced')}</span>
          </button>
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
          {items.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-[var(--text-muted)]">
              {t('palette.noResults')}
            </div>
          ) : rendered}
        </div>

        <div className="flex items-center gap-4 px-3 py-2 border-t border-[var(--border-color)] text-[11px] text-[var(--text-muted)]">
          <span>↑↓ {t('palette.hintNavigate')}</span>
          <span>↵ {t('palette.hintSelect')}</span>
          <span>⇥ {t('palette.hintFilter')}</span>
          <span className="ml-auto">⌘K / Ctrl+K</span>
        </div>
      </div>

    </div>,
    document.body,
  );
}
