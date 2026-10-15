// Quick switcher — "Быстрый поиск" (cord-ios QuickSwitcherView.swift).
// Large sheet: xmark | title | slider.horizontal.3 (→ advanced search 350 ms after this sheet closed),
// clearable search field, filter chips (#/@/> prefixes while the chip is "All"), plain list with sticky headers:
// recent searches, or Каналы → Серверы → Люди → Сообщения → Действия (caps + "Показать ещё N").
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { keepPreviousData, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { present, primeKeyboard, type SheetCtx } from '../../present/PresentationProvider';
import { SheetScreen } from '../../nav/Screen';
import { BarButton } from '../../nav/BarButton';
import { mobileNav } from '../../nav/NavStack';
import type { Route } from '../../nav/routes';
import { CordSearchField, Icon, ListSection, PlainList, Row, type SFSymbol } from '../../ui';
import { useMT } from '../../i18n';
import { groupsApi } from '../../../api/groups';
import { dmsApi } from '../../../api/dms';
import { searchApi, type GlobalMessageHit, type UserShort } from '../../../api/search';
import { useLangStore } from '../../../i18n';
import { performMobileLogout } from '../settings/logout';
import type { Chat, Group } from '../../../types';
import { clearRecent, highlight, loadRecent, persistRecent, snippetAround } from './searchText';
import { openAdvancedSearch } from './AdvancedSearchSheet';
import './search.css';

type Filter = 'all' | 'nav' | 'people' | 'message' | 'command';
type Kind = 'channel' | 'server' | 'user' | 'message' | 'action';

const FILTERS: { key: Filter; labelKey: string; prefix?: string }[] = [
  { key: 'all', labelKey: 'palette.filterAll' },
  { key: 'nav', labelKey: 'palette.filterNav', prefix: '#' },
  { key: 'people', labelKey: 'palette.filterPeople', prefix: '@' },
  { key: 'message', labelKey: 'palette.filterMessages' },
  { key: 'command', labelKey: 'palette.filterCommands', prefix: '>' },
];

const ORDER: Kind[] = ['channel', 'server', 'user', 'message', 'action'];
const CAPS: Record<Kind, number> = { channel: 5, server: 5, user: 5, message: 5, action: 20 };
const SECTION_KEY: Record<Kind, string> = {
  channel: 'palette.channels',
  server: 'palette.groups',
  user: 'palette.people',
  message: 'palette.messagesSection',
  action: 'palette.actions',
};

function allowed(f: Filter, kind: Kind): boolean {
  switch (f) {
    case 'all':
      return true;
    case 'nav':
      return kind === 'channel' || kind === 'server';
    case 'people':
      return kind === 'user';
    case 'message':
      return kind === 'message';
    case 'command':
      return kind === 'action';
  }
}

/** Effective filter + query: a leading `#`/`@`/`>` switches the filter while the chip is "All". */
function effectiveOf(raw: string, filter: Filter): { filter: Filter; query: string } {
  const trimmed = raw.replace(/^ +/, '');
  if (filter === 'all' && trimmed.length) {
    const f = FILTERS.find((x) => x.prefix && trimmed[0] === x.prefix);
    if (f) return { filter: f.key, query: trimmed.slice(1).trim() };
  }
  return { filter, query: trimmed.trim() };
}

interface Item {
  id: string;
  kind: Kind;
  title: string;
  subtitle?: string;
  icon: SFSymbol;
  color?: string | null;
  run: () => void;
}

const isHexColor = (s: string | null | undefined): s is string => !!s && /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s.trim());

// ───────────────────────────── presentation ─────────────────────────────

let presented = false;

/** Present the quick switcher (root nav-bar magnifier; sessionStore.openPalette bridge). */
export function openQuickSwitcher(): void {
  if (presented) return;
  presented = true;
  // inside the tap: lets the field mounted by the sheet raise the iOS keyboard
  primeKeyboard();
  present.presentSheet((ctx) => <QuickSwitcherSheet {...ctx} />, {
    onDismiss: () => {
      presented = false;
    },
  });
}

// ───────────────────────────── sheet ─────────────────────────────

export function QuickSwitcherSheet(props: SheetCtx) {
  const { dismiss } = props;
  const t = useMT();
  // single instance: also released when the shell unmounts with the sheet still open (logout)
  useEffect(() => {
    presented = true;
    return () => {
      presented = false;
    };
  }, []);
  const qc = useQueryClient();
  const lang = useLangStore((s) => s.lang);
  const setLang = useLangStore((s) => s.setLang);

  const [rawQuery, setRawQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState<Set<Kind>>(() => new Set());
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = useRef(false);

  const eff = useMemo(() => effectiveOf(rawQuery, filter), [rawQuery, filter]);

  // 300 ms debounce of the effective filter + query (people / messages requests)
  const [deb, setDeb] = useState<{ q: string; f: Filter }>({ q: '', f: 'all' });
  useEffect(() => {
    const id = window.setTimeout(() => setDeb({ q: eff.query, f: eff.filter }), 300);
    return () => window.clearTimeout(id);
  }, [eff.query, eff.filter]);

  const changeQuery = (v: string) => {
    setRawQuery(v);
    setExpanded(new Set());
  };
  const changeFilter = (f: Filter) => {
    setFilter(f);
    setExpanded(new Set());
  };

  // ── local sources: servers (not DM, not personal) and all their chats ──
  const { data: groupsData } = useQuery<Group[]>({ queryKey: ['groups'], queryFn: groupsApi.list, staleTime: 30_000 });
  const servers = useMemo(() => (groupsData ?? []).filter((g) => !g.is_dm && !g.is_personal), [groupsData]);
  const chatQueries = useQueries({
    queries: servers.map((g) => ({
      queryKey: ['chats', g.id],
      queryFn: () => groupsApi.listChats(g.id),
      staleTime: 30_000,
    })),
  });
  // iOS fetches every server's channels first and then shows the "Каналы" section at once
  const channelsReady = chatQueries.every((q) => !q.isPending);
  const channels: { chat: Chat; group: Group }[] = [];
  servers.forEach((g, i) => {
    const list = chatQueries[i]?.data;
    if (Array.isArray(list)) list.forEach((chat) => channels.push({ chat, group: g }));
  });

  // ── async sources (≥ 2 chars) ──
  const qOk = deb.q.length >= 2;
  const wantUsers = qOk && (deb.f === 'all' || deb.f === 'people');
  const wantMessages = qOk && (deb.f === 'all' || deb.f === 'message');
  // previous hits stay visible while a refined query loads; after the query dropped below 2 chars they
  // were cleared (iOS `userHits = []`), so a new query starts empty
  const lastQ = useRef('');
  const keepPrev = lastQ.current.length >= 2;
  useEffect(() => {
    lastQ.current = deb.q;
  }, [deb.q]);
  const usersQ = useQuery<UserShort[]>({
    queryKey: ['m-palette-users', deb.q],
    // errors (e.g. the shared 60/min search rate limit) are NOT cached as an empty result for 10 s —
    // they render as no hits and the same query is fetched again next time
    queryFn: () => searchApi.users(deb.q, 20),
    enabled: wantUsers,
    staleTime: 10_000,
    retry: false,
    placeholderData: keepPrev ? keepPreviousData : undefined,
  });
  const messagesQ = useQuery<GlobalMessageHit[]>({
    queryKey: ['m-palette-messages', deb.q],
    queryFn: () => searchApi.messages({ q: deb.q, limit: 25, sort: 'relevance' }),
    enabled: wantMessages,
    staleTime: 10_000,
    retry: false,
    placeholderData: keepPrev ? keepPreviousData : undefined,
  });
  const userHits = wantUsers && !usersQ.isError ? usersQ.data ?? [] : [];
  const messageHits = wantMessages && !messagesQ.isError ? messagesQ.data ?? [] : [];
  const asyncLoading = (wantUsers && usersQ.isFetching) || (wantMessages && messagesQ.isFetching);

  // ── actions ──
  const go = (route: Route) => {
    void dismiss();
    mobileNav.navigate(route); // waits for the sheet to slide down, then pushes on the root stack
  };

  const remember = () => setRecent(persistRecent(deb.q));

  const pickUser = async (u: UserShort) => {
    if (busy.current) return;
    busy.current = true;
    remember();
    try {
      const dm = await dmsApi.openWith(u.id);
      if (dm.is_new) void qc.invalidateQueries({ queryKey: ['dms'] });
      void dismiss();
      mobileNav.navigate({ name: 'chat', chatId: dm.chat_id, title: dm.peer.display_name, groupId: dm.group_id });
    } catch {
      navigator.clipboard?.writeText(`@${u.username}`).catch(() => undefined);
      void dismiss();
    } finally {
      busy.current = false;
    }
  };

  const logout = () => {
    // the same path as Settings → "Выйти": voice reset first, tokens, media cache, react-query cache
    // (ProtectedRoute → /login)
    void dismiss().then(() => performMobileLogout(qc));
  };

  const openAdvanced = () => {
    const q = eff.query;
    // keep the keyboard alive across the sheet hand-off (the advanced field focuses on mount)
    primeKeyboard();
    void dismiss().then(() => openAdvancedSearch(q));
  };

  // ── sections ──
  const sections = (() => {
    const ql = eff.query.toLowerCase();
    const match = (s: string) => !ql || s.toLowerCase().includes(ql);
    const by: Record<Kind, Item[]> = { channel: [], server: [], user: [], message: [], action: [] };

    if (channelsReady) {
      for (const { chat, group } of channels) {
        if (!match(chat.name) && !match(group.name)) continue;
        by.channel.push({
          id: `ch:${chat.id}`,
          kind: 'channel',
          title: chat.name,
          subtitle: group.name,
          icon: chat.type === 'voice' ? 'speaker.wave.2.fill' : 'number',
          color: chat.color,
          // voice channels too open the message timeline (no voice join), as iOS
          run: () => go({ name: 'chat', chatId: chat.id, title: chat.name, groupId: group.id }),
        });
      }
    }
    for (const g of servers) {
      if (!match(g.name)) continue;
      by.server.push({
        id: `g:${g.id}`,
        kind: 'server',
        title: g.name,
        subtitle: t('palette.group'),
        icon: 'server.rack',
        run: () => go({ name: 'channels', groupId: g.id }),
      });
    }
    for (const u of userHits) {
      by.user.push({
        id: `u:${u.id}`,
        kind: 'user',
        title: u.display_name || u.username,
        subtitle: `@${u.username}`,
        icon: 'person.crop.circle.fill',
        run: () => void pickUser(u),
      });
    }
    for (const m of messageHits) {
      const content = (m.content ?? '').replace(/\s+/g, ' ');
      const preview = snippetAround(content, eff.query, 80);
      by.message.push({
        id: `m:${m.id}`,
        kind: 'message',
        title: preview || '…',
        subtitle: `${m.author_display_name ?? ''} · #${m.chat_name ?? ''}`,
        icon: 'text.bubble.fill',
        color: m.chat_color,
        run: () => {
          remember();
          go({
            name: 'chat',
            chatId: m.chat_id,
            title: m.chat_name,
            groupId: m.group_id,
            jumpTo: { messageId: m.id, createdAt: m.created_at },
          });
        },
      });
    }
    const actions: Item[] = [
      {
        id: 'a:lang',
        kind: 'action',
        title: t('palette.toggleLang'),
        icon: 'globe',
        run: () => {
          setLang(lang === 'ru' ? 'en' : 'ru');
          void dismiss();
        },
      },
      { id: 'a:logout', kind: 'action', title: t('palette.logout'), icon: 'rectangle.portrait.and.arrow.right', run: logout },
    ];
    by.action = actions.filter((a) => match(a.title));

    return ORDER.filter((k) => allowed(eff.filter, k) && by[k].length > 0).map((k) => ({ kind: k, items: by[k] }));
  })();

  const showRecent = !rawQuery.trim() && filter === 'all' && recent.length > 0;

  let list: ReactNode;
  if (showRecent) {
    list = (
      <ListSection
        header={t('palette.historySection')}
        headerAccessory={
          <button
            type="button"
            className="m-srch-hclear"
            onPointerDown={(e) => e.preventDefault() /* keep the keyboard up */}
            onClick={() => {
              clearRecent();
              setRecent([]);
            }}
          >
            {t('palette.historyClear')}
          </button>
        }
      >
        {recent.map((q) => (
          <Row
            key={q}
            icon="clock"
            iconColor="var(--text-secondary)"
            title={q}
            titleColor="var(--text-secondary)"
            titleLines={1}
            onPress={() => changeQuery(q)}
          />
        ))}
      </ListSection>
    );
  } else {
    list = (
      <>
        {sections.length === 0 && (
          <Row bg="clear" separator={false}>
            <div className="m-srch-noresults">{t('palette.noResults')}</div>
          </Row>
        )}
        {sections.map(({ kind, items }) => {
          const cap = expanded.has(kind) ? items.length : Math.min(items.length, CAPS[kind]);
          return (
            <ListSection key={kind} header={t(SECTION_KEY[kind])}>
              {items.slice(0, cap).map((it) => (
                <Row
                  key={it.id}
                  className="m-srch-row"
                  leading={
                    <span className="m-srch-lead">
                      {isHexColor(it.color) && <span className="m-srch-dot" style={{ background: it.color }} />}
                      <span className="m-srch-icon">
                        <Icon name={it.icon} size={it.icon === 'number' ? 21 : 22} />
                      </span>
                    </span>
                  }
                  leadingGap={10}
                  title={highlight(it.title, eff.query)}
                  titleLines={1}
                  subtitle={it.subtitle}
                  subtitleLines={1}
                  onPress={it.run}
                />
              ))}
              {items.length > cap && (
                <Row
                  style={{ minHeight: 44 }}
                  onPress={() => setExpanded((s) => new Set(s).add(kind))}
                  ariaLabel={t('palette.showMore', String(items.length - cap))}
                >
                  <span className="m-srch-more">{t('palette.showMore', String(items.length - cap))}</span>
                </Row>
              )}
            </ListSection>
          );
        })}
      </>
    );
  }

  return (
    <SheetScreen
      title={t('palette.title')}
      scroll={false}
      leading={<BarButton icon="xmark" ariaLabel={t('common.close')} onPress={() => void dismiss()} />}
      trailing={<BarButton icon="slider.horizontal.3" ariaLabel={t('palette.advanced')} onPress={openAdvanced} />}
    >
      <div className="m-srch-fill">
        <CordSearchField
          style={{ margin: '12px 12px 0', flex: 'none' }}
          value={rawQuery}
          onChange={changeQuery}
          placeholder={t('palette.placeholder')}
          loading={asyncLoading}
          clearable
          autoFocus
          inputRef={inputRef}
          onSubmit={() => inputRef.current?.blur()}
        />
        <div className="m-srch-chips" role="toolbar">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className="m-srch-chip"
              aria-pressed={filter === f.key}
              onPointerDown={(e) => e.preventDefault() /* the field keeps focus (iOS chips don't refocus) */}
              onClick={() => changeFilter(f.key)}
            >
              <span>{t(f.labelKey)}</span>
              {f.prefix && <span className="m-srch-chip-prefix">{f.prefix}</span>}
            </button>
          ))}
        </div>
        <div className="m-srch-scroll">
          <PlainList>{list}</PlainList>
        </div>
      </div>
    </SheetScreen>
  );
}
