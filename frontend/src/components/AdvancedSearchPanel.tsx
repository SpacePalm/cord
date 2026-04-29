// AdvancedSearchPanel — расширенный режим глобального поиска внутри палитры.
//
// Открывается из CommandPalette по кнопке/тоггеру. Layout: левая колонка —
// визуальные фильтры (группы, каналы, авторы, дата, контент), правая — текстовый
// инпут + результаты с группировкой и сортировкой.
//
// Все фильтры опциональны. Если ничего не задано и q пуст — показываем
// «Введите запрос или выберите фильтр».
//
// Сохранённые поиски: хранятся в preferences_json (синкаются между девайсами).

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  X, Search, Hash, Volume2, Image as ImageIcon, Paperclip, Mic, Link2,
  BarChart2, Pin, AtSign, Edit3, Forward, Save, Trash2, ChevronDown, ChevronRight,
} from 'lucide-react';
import { searchApi, type GlobalMessageHit, type MessageSearchParams, type ScopeOut } from '../api/search';
import { useAuthStore } from '../store/authStore';
import { useSavedSearchesStore, type SavedSearch } from '../store/savedSearchesStore';
import { useT, useLocale } from '../i18n';

interface Props {
  initialQuery?: string;
  onClose: () => void;
  onJumpToMessage: (hit: GlobalMessageHit) => void;
}

// ── Date presets ──────────────────────────────────────────────────────────
type DatePreset = 'any' | 'today' | 'week' | 'month' | 'custom';

function datePresetToRange(preset: DatePreset, customAfter?: string, customBefore?: string): { after?: string; before?: string } {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  switch (preset) {
    case 'today': {
      const d = new Date(now); d.setHours(0, 0, 0, 0);
      return { after: iso(d) };
    }
    case 'week': {
      const d = new Date(now); d.setDate(d.getDate() - 7);
      return { after: iso(d) };
    }
    case 'month': {
      const d = new Date(now); d.setDate(d.getDate() - 30);
      return { after: iso(d) };
    }
    case 'custom':
      return { after: customAfter, before: customBefore };
    default:
      return {};
  }
}

// ── Filter state ──────────────────────────────────────────────────────────
interface FilterState {
  q: string;
  groupIds: string[];
  chatIds: string[];
  fromUserIds: string[];
  datePreset: DatePreset;
  customAfter: string;
  customBefore: string;
  hasImage: boolean;
  hasFile: boolean;
  hasVoice: boolean;
  hasLink: boolean;
  hasPoll: boolean;
  pinnedOnly: boolean;
  mentionsMe: boolean;
  isEdited: boolean;
  isForwarded: boolean;
  // Длина — toggle активирует, тогда от и до применяются.
  lengthEnabled: boolean;
  minLength: number;
  maxLength: number;
  sort: 'relevance' | 'newest' | 'oldest';
}

const DEFAULT_FILTERS: FilterState = {
  q: '',
  groupIds: [],
  chatIds: [],
  fromUserIds: [],
  datePreset: 'any',
  customAfter: '',
  customBefore: '',
  hasImage: false,
  hasFile: false,
  hasVoice: false,
  hasLink: false,
  hasPoll: false,
  pinnedOnly: false,
  mentionsMe: false,
  isEdited: false,
  isForwarded: false,
  lengthEnabled: false,
  minLength: 0,
  maxLength: 500,
  sort: 'relevance',
};

function filtersToParams(s: FilterState): MessageSearchParams {
  const range = datePresetToRange(s.datePreset, s.customAfter, s.customBefore);
  return {
    q: s.q.trim() || undefined,
    group_ids: s.groupIds.length ? s.groupIds : undefined,
    chat_ids: s.chatIds.length ? s.chatIds : undefined,
    from_user_ids: s.fromUserIds.length ? s.fromUserIds : undefined,
    after: range.after,
    before: range.before,
    has_image: s.hasImage || undefined,
    has_file: s.hasFile || undefined,
    has_voice: s.hasVoice || undefined,
    has_link: s.hasLink || undefined,
    has_poll: s.hasPoll || undefined,
    pinned_only: s.pinnedOnly || undefined,
    mentions_me: s.mentionsMe || undefined,
    is_edited: s.isEdited || undefined,
    is_forwarded: s.isForwarded || undefined,
    min_length: s.lengthEnabled ? s.minLength : undefined,
    max_length: s.lengthEnabled ? s.maxLength : undefined,
    sort: s.sort,
  };
}

function isEmptySearch(s: FilterState): boolean {
  return (
    !s.q.trim() &&
    !s.groupIds.length && !s.chatIds.length && !s.fromUserIds.length &&
    s.datePreset === 'any' &&
    !s.hasImage && !s.hasFile && !s.hasVoice && !s.hasLink && !s.hasPoll &&
    !s.pinnedOnly && !s.mentionsMe && !s.isEdited && !s.isForwarded &&
    !s.lengthEnabled
  );
}

// ── Component ─────────────────────────────────────────────────────────────
export function AdvancedSearchPanel({ initialQuery, onClose, onJumpToMessage }: Props) {
  const t = useT();
  const locale = useLocale();
  const currentUserId = useAuthStore((s) => s.user?.id);

  const [filters, setFilters] = useState<FilterState>({
    ...DEFAULT_FILTERS,
    q: initialQuery ?? '',
  });
  const [debouncedFilters, setDebouncedFilters] = useState(filters);
  const [groupBy, setGroupBy] = useState<'none' | 'chat'>('none');

  // debounce — чтобы не дёргать бэк на каждое нажатие
  useEffect(() => {
    const id = setTimeout(() => setDebouncedFilters(filters), 350);
    return () => clearTimeout(id);
  }, [filters]);

  // Scope (группы, каналы, участники) — один запрос на сессию
  const { data: scope } = useQuery<ScopeOut>({
    queryKey: ['search-scope'],
    queryFn: searchApi.scope,
    staleTime: 5 * 60_000,
  });

  // Видимые каналы — фильтруем по выбранным группам, иначе показываем все.
  // DM-группы скрываем — их «каналы» внутренние.
  const visibleChats = useMemo(() => {
    if (!scope) return [];
    const dmGroupIds = new Set(scope.groups.filter((g) => g.is_dm).map((g) => g.id));
    return scope.chats.filter((c) => {
      if (dmGroupIds.has(c.group_id)) return false;
      if (filters.groupIds.length === 0) return true;
      return filters.groupIds.includes(c.group_id);
    });
  }, [scope, filters.groupIds]);

  // Поисковый запрос
  const params = useMemo(() => filtersToParams(debouncedFilters), [debouncedFilters]);
  const empty = isEmptySearch(debouncedFilters);

  const { data: hits = [], isFetching } = useQuery<GlobalMessageHit[]>({
    queryKey: ['advanced-search', params],
    queryFn: () => searchApi.messages({ ...params, limit: 50 }),
    enabled: !empty,
    staleTime: 10_000,
  });

  // Группировка результатов
  const grouped = useMemo(() => {
    if (groupBy !== 'chat') return [{ key: 'all', label: '', hits }];
    const map = new Map<string, GlobalMessageHit[]>();
    for (const h of hits) {
      const arr = map.get(h.chat_id) ?? [];
      arr.push(h);
      map.set(h.chat_id, arr);
    }
    return Array.from(map.entries()).map(([cid, list]) => ({
      key: cid,
      label: `#${list[0].chat_name} · ${list[0].group_name}`,
      hits: list,
    }));
  }, [hits, groupBy]);

  // Saved searches
  const saved = useSavedSearchesStore((s) => s.items);
  const addSaved = useSavedSearchesStore((s) => s.add);
  const removeSaved = useSavedSearchesStore((s) => s.remove);

  const handleSave = useCallback(() => {
    const name = window.prompt(t('search.savePrompt'));
    if (!name?.trim()) return;
    // FilterState — конкретный тип, SavedSearch.filters — расширяемый Record.
    // Каст безопасен: ключи FilterState — это подмножество строк.
    addSaved({ id: crypto.randomUUID(), name: name.trim(), filters: filters as unknown as Record<string, unknown> });
  }, [filters, addSaved, t]);

  const applySaved = useCallback((s: SavedSearch) => {
    setFilters({ ...DEFAULT_FILTERS, ...(s.filters as Partial<FilterState>) });
  }, []);

  const reset = () => setFilters({ ...DEFAULT_FILTERS });

  // ── Sub-renderers ──────────────────────────────────────────────────────
  const FilterSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="flex flex-col gap-1 border-b border-[var(--border-color)] pb-3 mb-3">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{title}</span>
      {children}
    </div>
  );

  const Toggle = ({ active, onClick, icon, label }: {
    active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
        active ? 'bg-[var(--accent)] text-white' : 'bg-white/5 text-[var(--text-secondary)] hover:bg-white/10'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[6vh] bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-[min(95vw,1100px)] h-[calc(100dvh-12vh)] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-color)]">
          <Search size={18} className="text-[var(--accent)]" />
          <span className="font-semibold text-[var(--text-primary)]">{t('search.advancedTitle')}</span>
          <span className="ml-auto text-xs text-[var(--text-muted)]">
            {empty ? t('search.advancedHint') : isFetching ? t('search.searching') : t('search.foundCount', { count: String(hits.length) })}
          </span>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        {/* Body — две колонки */}
        <div className="flex-1 flex min-h-0">
          {/* ── Левая колонка: фильтры ── */}
          <div className="w-72 shrink-0 border-r border-[var(--border-color)] overflow-y-auto p-4">
            {/* Сохранённые поиски */}
            {saved.length > 0 && (
              <FilterSection title={t('search.savedSection')}>
                <div className="flex flex-col gap-1">
                  {saved.map((s) => (
                    <div key={s.id} className="flex items-center gap-1 group">
                      <button
                        onClick={() => applySaved(s)}
                        className="flex-1 text-left text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] truncate px-2 py-1 rounded hover:bg-white/5"
                      >
                        {s.name}
                      </button>
                      <button
                        onClick={() => removeSaved(s.id)}
                        className="opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--danger)] p-1 transition-opacity"
                        title={t('delete')}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </FilterSection>
            )}

            {/* Группы */}
            {scope && scope.groups.filter((g) => !g.is_dm).length > 0 && (
              <FilterSection title={t('search.filterGroups')}>
                <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                  {scope.groups.filter((g) => !g.is_dm).map((g) => (
                    <label key={g.id} className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer hover:text-[var(--text-primary)]">
                      <input
                        type="checkbox"
                        checked={filters.groupIds.includes(g.id)}
                        onChange={(e) => setFilters((f) => ({
                          ...f,
                          groupIds: e.target.checked ? [...f.groupIds, g.id] : f.groupIds.filter((x) => x !== g.id),
                          // При смене групп очищаем выбор каналов из других групп
                          chatIds: f.chatIds.filter((cid) => {
                            const c = scope.chats.find((x) => x.id === cid);
                            if (!c) return false;
                            const newGroupIds = e.target.checked ? [...f.groupIds, g.id] : f.groupIds.filter((x) => x !== g.id);
                            return newGroupIds.length === 0 || newGroupIds.includes(c.group_id);
                          }),
                        }))}
                        className="accent-[var(--accent)]"
                      />
                      <span className="truncate">{g.is_personal ? t('saved.title') : g.name}</span>
                    </label>
                  ))}
                </div>
              </FilterSection>
            )}

            {/* Каналы */}
            {visibleChats.length > 0 && (
              <FilterSection title={t('search.filterChats')}>
                <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                  {visibleChats.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer hover:text-[var(--text-primary)]">
                      <input
                        type="checkbox"
                        checked={filters.chatIds.includes(c.id)}
                        onChange={(e) => setFilters((f) => ({
                          ...f,
                          chatIds: e.target.checked ? [...f.chatIds, c.id] : f.chatIds.filter((x) => x !== c.id),
                        }))}
                        className="accent-[var(--accent)]"
                      />
                      {c.color && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: c.color }} />}
                      {c.type === 'voice' ? <Volume2 size={10} className="shrink-0" /> : <Hash size={10} className="shrink-0" />}
                      <span className="truncate">{c.name}</span>
                    </label>
                  ))}
                </div>
              </FilterSection>
            )}

            {/* Авторы */}
            {scope && scope.members.length > 0 && (
              <FilterSection title={t('search.filterAuthors')}>
                <UsersMultiSelect
                  members={scope.members}
                  selected={filters.fromUserIds}
                  currentUserId={currentUserId}
                  onChange={(ids) => setFilters((f) => ({ ...f, fromUserIds: ids }))}
                />
              </FilterSection>
            )}

            {/* Дата */}
            <FilterSection title={t('search.filterDate')}>
              <select
                value={filters.datePreset}
                onChange={(e) => setFilters((f) => ({ ...f, datePreset: e.target.value as DatePreset }))}
                className="w-full px-2 py-1 rounded bg-[var(--bg-input)] text-xs text-[var(--text-primary)] border border-[var(--border-color)] focus:outline-none focus:border-[var(--accent)]"
              >
                <option value="any">{t('search.dateAny')}</option>
                <option value="today">{t('search.dateToday')}</option>
                <option value="week">{t('search.dateWeek')}</option>
                <option value="month">{t('search.dateMonth')}</option>
                <option value="custom">{t('search.dateCustom')}</option>
              </select>
              {filters.datePreset === 'custom' && (
                <div className="flex flex-col gap-1 mt-2">
                  <label className="text-[10px] text-[var(--text-muted)]">{t('search.dateAfter')}</label>
                  <input
                    type="date"
                    value={filters.customAfter}
                    onChange={(e) => setFilters((f) => ({ ...f, customAfter: e.target.value }))}
                    className="px-2 py-1 rounded bg-[var(--bg-input)] text-xs text-[var(--text-primary)] border border-[var(--border-color)]"
                  />
                  <label className="text-[10px] text-[var(--text-muted)]">{t('search.dateBefore')}</label>
                  <input
                    type="date"
                    value={filters.customBefore}
                    onChange={(e) => setFilters((f) => ({ ...f, customBefore: e.target.value }))}
                    className="px-2 py-1 rounded bg-[var(--bg-input)] text-xs text-[var(--text-primary)] border border-[var(--border-color)]"
                  />
                </div>
              )}
            </FilterSection>

            {/* Контент */}
            <FilterSection title={t('search.filterContent')}>
              <div className="flex flex-wrap gap-1">
                <Toggle active={filters.hasImage} onClick={() => setFilters((f) => ({ ...f, hasImage: !f.hasImage }))} icon={<ImageIcon size={11} />} label={t('search.hasImage')} />
                <Toggle active={filters.hasFile} onClick={() => setFilters((f) => ({ ...f, hasFile: !f.hasFile }))} icon={<Paperclip size={11} />} label={t('search.hasFile')} />
                <Toggle active={filters.hasVoice} onClick={() => setFilters((f) => ({ ...f, hasVoice: !f.hasVoice }))} icon={<Mic size={11} />} label={t('search.hasVoice')} />
                <Toggle active={filters.hasLink} onClick={() => setFilters((f) => ({ ...f, hasLink: !f.hasLink }))} icon={<Link2 size={11} />} label={t('search.hasLink')} />
                <Toggle active={filters.hasPoll} onClick={() => setFilters((f) => ({ ...f, hasPoll: !f.hasPoll }))} icon={<BarChart2 size={11} />} label={t('search.hasPoll')} />
              </div>
            </FilterSection>

            {/* Метки */}
            <FilterSection title={t('search.filterFlags')}>
              <div className="flex flex-wrap gap-1">
                <Toggle active={filters.pinnedOnly} onClick={() => setFilters((f) => ({ ...f, pinnedOnly: !f.pinnedOnly }))} icon={<Pin size={11} />} label={t('search.pinned')} />
                <Toggle active={filters.mentionsMe} onClick={() => setFilters((f) => ({ ...f, mentionsMe: !f.mentionsMe }))} icon={<AtSign size={11} />} label={t('search.mentionsMe')} />
                <Toggle active={filters.isEdited} onClick={() => setFilters((f) => ({ ...f, isEdited: !f.isEdited }))} icon={<Edit3 size={11} />} label={t('search.edited')} />
                <Toggle active={filters.isForwarded} onClick={() => setFilters((f) => ({ ...f, isForwarded: !f.isForwarded }))} icon={<Forward size={11} />} label={t('search.forwarded')} />
              </div>
            </FilterSection>

            {/* Длина */}
            <FilterSection title={t('search.filterLength')}>
              <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.lengthEnabled}
                  onChange={(e) => setFilters((f) => ({ ...f, lengthEnabled: e.target.checked }))}
                  className="accent-[var(--accent)]"
                />
                {t('search.lengthEnabled')}
              </label>
              {filters.lengthEnabled && (
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="number" min={0} max={10000}
                    value={filters.minLength}
                    onChange={(e) => setFilters((f) => ({ ...f, minLength: Math.max(0, parseInt(e.target.value || '0', 10)) }))}
                    className="w-20 px-2 py-1 rounded bg-[var(--bg-input)] text-xs text-[var(--text-primary)] border border-[var(--border-color)]"
                  />
                  <span className="text-xs text-[var(--text-muted)]">—</span>
                  <input
                    type="number" min={0} max={10000}
                    value={filters.maxLength}
                    onChange={(e) => setFilters((f) => ({ ...f, maxLength: Math.max(0, parseInt(e.target.value || '0', 10)) }))}
                    className="w-20 px-2 py-1 rounded bg-[var(--bg-input)] text-xs text-[var(--text-primary)] border border-[var(--border-color)]"
                  />
                </div>
              )}
            </FilterSection>

            {/* Кнопки управления */}
            <div className="flex flex-col gap-1 mt-2">
              <button
                onClick={handleSave}
                disabled={empty}
                className="flex items-center justify-center gap-2 px-3 py-1.5 rounded bg-[var(--accent)]/15 text-[var(--accent)] text-xs hover:bg-[var(--accent)]/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Save size={12} />
                {t('search.saveSearch')}
              </button>
              <button
                onClick={reset}
                className="px-3 py-1.5 rounded text-xs text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors"
              >
                {t('search.resetFilters')}
              </button>
            </div>
          </div>

          {/* ── Правая колонка: запрос + результаты ── */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Поисковый инпут */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-color)]">
              <Search size={14} className="text-[var(--text-muted)]" />
              <input
                autoFocus
                value={filters.q}
                onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
                placeholder={t('search.advancedPlaceholder')}
                className="flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
              />
              <select
                value={filters.sort}
                onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as FilterState['sort'] }))}
                className="px-2 py-1 rounded bg-[var(--bg-input)] text-xs text-[var(--text-primary)] border border-[var(--border-color)] focus:outline-none"
              >
                <option value="relevance">{t('search.sortRelevance')}</option>
                <option value="newest">{t('search.sortNewest')}</option>
                <option value="oldest">{t('search.sortOldest')}</option>
              </select>
              <select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as 'none' | 'chat')}
                className="px-2 py-1 rounded bg-[var(--bg-input)] text-xs text-[var(--text-primary)] border border-[var(--border-color)] focus:outline-none"
              >
                <option value="none">{t('search.groupNone')}</option>
                <option value="chat">{t('search.groupByChat')}</option>
              </select>
            </div>

            {/* Результаты */}
            <div className="flex-1 overflow-y-auto p-3">
              {empty ? (
                <p className="text-center text-sm text-[var(--text-muted)] mt-12">{t('search.advancedHint')}</p>
              ) : isFetching && hits.length === 0 ? (
                <div className="flex justify-center mt-12">
                  <div className="w-5 h-5 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
                </div>
              ) : hits.length === 0 ? (
                <p className="text-center text-sm text-[var(--text-muted)] mt-12">{t('search.noResults')}</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {grouped.map((g) => (
                    <ResultGroup
                      key={g.key}
                      label={g.label}
                      hits={g.hits}
                      query={filters.q}
                      locale={locale}
                      onJump={onJumpToMessage}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function UsersMultiSelect({ members, selected, currentUserId, onChange }: {
  members: ScopeOut['members'];
  selected: string[];
  currentUserId?: string;
  onChange: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return members.slice(0, 30);
    return members.filter((m) =>
      m.username.toLowerCase().includes(q) || m.display_name.toLowerCase().includes(q)
    ).slice(0, 30);
  }, [members, search]);

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <div>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="@username"
        className="w-full px-2 py-1 rounded bg-[var(--bg-input)] text-xs text-[var(--text-primary)] border border-[var(--border-color)] focus:outline-none focus:border-[var(--accent)] mb-1"
      />
      <div className="max-h-40 overflow-y-auto flex flex-col gap-0.5">
        {filtered.map((m) => {
          const isSelf = m.id === currentUserId;
          return (
            <label key={m.id} className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer hover:text-[var(--text-primary)] px-1 py-0.5 rounded">
              <input
                type="checkbox"
                checked={selected.includes(m.id)}
                onChange={() => toggle(m.id)}
                className="accent-[var(--accent)]"
              />
              {m.image_path ? (
                <img src={m.image_path} alt="" className="w-4 h-4 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-4 h-4 rounded-full bg-[var(--accent)] flex items-center justify-center text-[8px] font-bold text-white shrink-0">
                  {(m.display_name || m.username).slice(0, 1).toUpperCase()}
                </div>
              )}
              <span className="truncate">{m.display_name}</span>
              {isSelf && <span className="text-[9px] text-[var(--text-muted)]">(вы)</span>}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function ResultGroup({ label, hits, query, locale, onJump }: {
  label: string;
  hits: GlobalMessageHit[];
  query: string;
  locale: string;
  onJump: (h: GlobalMessageHit) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div>
      {label && (
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-1 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors mb-1"
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          {label}
          <span className="text-[10px] text-[var(--text-muted)] font-normal">({hits.length})</span>
        </button>
      )}
      {!collapsed && (
        <div className="flex flex-col gap-1.5">
          {hits.map((h) => (
            <ResultCard key={h.id} hit={h} query={query} locale={locale} onClick={() => onJump(h)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ResultCard({ hit, query, locale, onClick }: {
  hit: GlobalMessageHit; query: string; locale: string; onClick: () => void;
}) {
  const date = useMemo(() => {
    const d = new Date(hit.created_at);
    return d.toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }, [hit.created_at, locale]);

  return (
    <button
      onClick={onClick}
      className="text-left p-3 rounded-lg bg-white/[.03] hover:bg-white/[.07] border border-[var(--border-color)] transition-colors"
    >
      <div className="flex items-center gap-2 mb-1">
        {hit.author_image_path ? (
          <img src={hit.author_image_path} alt="" className="w-5 h-5 rounded-full object-cover shrink-0" />
        ) : (
          <div className="w-5 h-5 rounded-full bg-[var(--accent)] flex items-center justify-center text-[9px] font-bold text-white shrink-0">
            {hit.author_display_name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <span className="text-sm font-medium text-[var(--text-primary)] truncate">{hit.author_display_name}</span>
        <span className="text-xs text-[var(--text-muted)] shrink-0">· {date}</span>
        <span className="ml-auto flex items-center gap-1 text-xs text-[var(--text-muted)] shrink-0">
          {hit.chat_color && <span className="w-1.5 h-1.5 rounded-full" style={{ background: hit.chat_color }} />}
          <Hash size={10} />
          <span className="truncate max-w-[140px]">{hit.chat_name}</span>
          <span className="opacity-60">/ {hit.group_name}</span>
        </span>
      </div>
      {hit.content && (
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed break-words line-clamp-3">
          {highlight(hit.content, query)}
        </p>
      )}
      <div className="flex items-center gap-1.5 mt-1.5 text-[var(--text-muted)]">
        {hit.has_image && <ImageIcon size={11} />}
        {hit.has_file && <Paperclip size={11} />}
        {hit.has_voice && <Mic size={11} />}
        {hit.has_link && <Link2 size={11} />}
        {hit.has_poll && <BarChart2 size={11} />}
        {hit.is_pinned && <Pin size={11} className="text-yellow-400" />}
        {hit.is_edited && <span className="text-[10px]">изм.</span>}
        {hit.is_forwarded && <Forward size={11} />}
      </div>
    </button>
  );
}

function highlight(text: string, query: string): React.ReactNode {
  const words = query.trim().split(/\s+/).filter((w) => w.length >= 2 && !w.includes(':'));
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

