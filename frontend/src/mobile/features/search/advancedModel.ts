// AdvancedSearchStore port (cord-ios AdvancedSearchView.swift): flat filter state, 350 ms debounced search,
// token-guarded offset pagination (25, dedup, keep previous hits), scope tree tri-state, saved-search
// snapshot/apply. One controller per presentation of the advanced-search sheet; the stacked filters sheet
// shares it.
import { createStore, type StoreApi } from 'zustand/vanilla';
import { searchApi, type GlobalMessageHit, type MessageSearchParams, type ScopeChat, type ScopeGroup, type ScopeOut } from '../../../api/search';

export type DatePreset = 'any' | 'today' | 'week' | 'month' | 'custom';
export type SearchSort = 'relevance' | 'newest' | 'oldest';
export type GroupBy = 'none' | 'chat';

/** Same shape as desktop `FilterState` / iOS `SavedSearchFilters` (camelCase, cross-device). */
export interface AdvFilters {
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
  lengthEnabled: boolean;
  minLength: number;
  maxLength: number;
  sort: SearchSort;
}

export const DEFAULT_FILTERS: AdvFilters = {
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

export interface AdvState extends AdvFilters {
  /** Client-side grouping (not part of saved searches, not sent). */
  groupBy: GroupBy;
  hits: GlobalMessageHit[];
  /** First-page fetch (field spinner). */
  isFetching: boolean;
  isFetchingNext: boolean;
  hasNext: boolean;
  /** A debounced search is scheduled (web shows the spinner instead of iOS' "Nothing found" flash). */
  pending: boolean;
}

export const PAGE_SIZE = 25;

/** react-query options for GET /search/scope (same key / staleTime as the desktop panel). */
export const scopeQuery = {
  queryKey: ['search-scope'] as const,
  queryFn: (): Promise<ScopeOut> => searchApi.scope(),
  staleTime: 5 * 60_000,
};
const DEBOUNCE_MS = 350;

// ───────────────────────────── pure helpers ─────────────────────────────

/** `yyyy-MM-dd` of (now − days) in UTC (iOS `isoDay(daysAgo:)`). */
function isoDayUTC(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

export function dateRange(f: AdvFilters): { after?: string; before?: string } {
  switch (f.datePreset) {
    case 'today':
      return { after: isoDayUTC(0) };
    case 'week':
      return { after: isoDayUTC(7) };
    case 'month':
      return { after: isoDayUTC(30) };
    case 'custom':
      return { after: f.customAfter || undefined, before: f.customBefore || undefined };
    default:
      return {};
  }
}

export function paramsOf(f: AdvFilters, offset: number): MessageSearchParams {
  const r = dateRange(f);
  return {
    q: f.q.trim() || undefined,
    limit: PAGE_SIZE,
    offset,
    group_ids: f.groupIds.length ? f.groupIds : undefined,
    chat_ids: f.chatIds.length ? f.chatIds : undefined,
    from_user_ids: f.fromUserIds.length ? f.fromUserIds : undefined,
    after: r.after,
    before: r.before,
    has_image: f.hasImage || undefined,
    has_file: f.hasFile || undefined,
    has_voice: f.hasVoice || undefined,
    has_link: f.hasLink || undefined,
    has_poll: f.hasPoll || undefined,
    pinned_only: f.pinnedOnly || undefined,
    mentions_me: f.mentionsMe || undefined,
    is_edited: f.isEdited || undefined,
    is_forwarded: f.isForwarded || undefined,
    min_length: f.lengthEnabled ? f.minLength : undefined,
    max_length: f.lengthEnabled ? f.maxLength : undefined,
    sort: f.sort,
  };
}

/** iOS `MessageSearchParams.isEmpty`: no trimmed q and no filter (custom range with both fields empty = empty). */
export function isEmptySearch(f: AdvFilters): boolean {
  const r = dateRange(f);
  return (
    !f.q.trim() &&
    !f.groupIds.length &&
    !f.chatIds.length &&
    !f.fromUserIds.length &&
    !r.after &&
    !r.before &&
    !f.hasImage &&
    !f.hasFile &&
    !f.hasVoice &&
    !f.hasLink &&
    !f.hasPoll &&
    !f.pinnedOnly &&
    !f.mentionsMe &&
    !f.isEdited &&
    !f.isForwarded &&
    !f.lengthEnabled
  );
}

/** Number of non-default filter groups (badge dot on the filters bar button). */
export function activeFilterCount(f: AdvFilters): number {
  let n = 0;
  if (f.groupIds.length || f.chatIds.length) n++;
  if (f.fromUserIds.length) n++;
  if (f.datePreset !== 'any') n++;
  if (f.hasImage || f.hasFile || f.hasVoice || f.hasLink || f.hasPoll) n++;
  if (f.pinnedOnly || f.mentionsMe || f.isEdited || f.isForwarded) n++;
  if (f.lengthEnabled) n++;
  return n;
}

/** Snapshot for a saved search (the 20 FilterState fields). */
export function snapshot(f: AdvFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(DEFAULT_FILTERS) as (keyof AdvFilters)[]) {
    const v = f[k];
    out[k] = Array.isArray(v) ? [...v] : v;
  }
  return out;
}

const DATE_PRESETS: DatePreset[] = ['any', 'today', 'week', 'month', 'custom'];
const SORTS: SearchSort[] = ['relevance', 'newest', 'oldest'];

/** Tolerant decode of a saved snapshot (missing keys → defaults; unknown datePreset/sort → any/relevance). */
export function decodeSaved(raw: Record<string, unknown> | null | undefined): AdvFilters {
  const r = raw ?? {};
  const str = (k: keyof AdvFilters): string => (typeof r[k] === 'string' ? (r[k] as string) : (DEFAULT_FILTERS[k] as string));
  const bool = (k: keyof AdvFilters): boolean => (typeof r[k] === 'boolean' ? (r[k] as boolean) : (DEFAULT_FILTERS[k] as boolean));
  const int = (k: keyof AdvFilters): number =>
    typeof r[k] === 'number' && Number.isFinite(r[k]) ? Math.trunc(r[k] as number) : (DEFAULT_FILTERS[k] as number);
  const ids = (k: keyof AdvFilters): string[] =>
    Array.isArray(r[k]) ? Array.from(new Set((r[k] as unknown[]).filter((x): x is string => typeof x === 'string'))) : [];
  const preset = str('datePreset');
  const sort = str('sort');
  return {
    q: str('q'),
    groupIds: ids('groupIds'),
    chatIds: ids('chatIds'),
    fromUserIds: ids('fromUserIds'),
    datePreset: (DATE_PRESETS as string[]).includes(preset) ? (preset as DatePreset) : 'any',
    customAfter: str('customAfter'),
    customBefore: str('customBefore'),
    hasImage: bool('hasImage'),
    hasFile: bool('hasFile'),
    hasVoice: bool('hasVoice'),
    hasLink: bool('hasLink'),
    hasPoll: bool('hasPoll'),
    pinnedOnly: bool('pinnedOnly'),
    mentionsMe: bool('mentionsMe'),
    isEdited: bool('isEdited'),
    isForwarded: bool('isForwarded'),
    lengthEnabled: bool('lengthEnabled'),
    minLength: int('minLength'),
    maxLength: int('maxLength'),
    sort: (SORTS as string[]).includes(sort) ? (sort as SearchSort) : 'relevance',
  };
}

// ───────────────────────────── scope tree ─────────────────────────────

export interface TreeGroup {
  group: ScopeGroup;
  /** Text chats only. */
  chats: ScopeChat[];
}
export type TriState = 'all' | 'some' | 'none';

/** Groups without DMs, each with its text chats (voice + DM chats excluded), API order. */
export function buildTree(scope: ScopeOut | undefined | null): TreeGroup[] {
  if (!scope) return [];
  const dmIds = new Set(scope.groups.filter((g) => g.is_dm).map((g) => g.id));
  const byGroup = new Map<string, ScopeChat[]>();
  for (const c of scope.chats) {
    if (dmIds.has(c.group_id) || c.type !== 'text') continue;
    const arr = byGroup.get(c.group_id) ?? [];
    arr.push(c);
    byGroup.set(c.group_id, arr);
  }
  return scope.groups.filter((g) => !g.is_dm).map((group) => ({ group, chats: byGroup.get(group.id) ?? [] }));
}

export function groupState(f: AdvFilters, g: TreeGroup): TriState {
  if (f.groupIds.includes(g.group.id)) return 'all';
  const sel = g.chats.filter((c) => f.chatIds.includes(c.id)).length;
  if (sel === 0) return 'none';
  return sel === g.chats.length ? 'all' : 'some';
}

export function chatChecked(f: AdvFilters, g: TreeGroup, c: ScopeChat): boolean {
  return f.groupIds.includes(g.group.id) || f.chatIds.includes(c.id);
}

// ───────────────────────────── controller ─────────────────────────────

export interface AdvController {
  store: StoreApi<AdvState>;
  /** Kick off the initial search (non-empty initial query). Idempotent. */
  start(): void;
  /** Change filters → 350 ms debounced refetch. */
  update(patch: Partial<AdvFilters>): void;
  /** Client-only grouping (no refetch). */
  setGroupBy(g: GroupBy): void;
  apply(saved: Record<string, unknown>): void;
  /** Clears everything incl. q and groupBy, refetches (→ empty → hint). */
  reset(): void;
  toggleGroup(g: TreeGroup): void;
  toggleChat(g: TreeGroup, c: ScopeChat): void;
  toggleAuthor(id: string): void;
  loadNext(): void;
  dispose(): void;
}

function dedup(arr: GlobalMessageHit[]): GlobalMessageHit[] {
  const seen = new Set<string>();
  return arr.filter((h) => (seen.has(h.id) ? false : (seen.add(h.id), true)));
}

/** Server hits with iOS' tolerant defaults (missing booleans / attachment names). */
function normalize(arr: unknown): GlobalMessageHit[] {
  if (!Array.isArray(arr)) return [];
  return (arr as GlobalMessageHit[]).map((h) => ({
    ...h,
    chat_name: h.chat_name ?? '',
    group_name: h.group_name ?? '',
    author_username: h.author_username ?? '',
    author_display_name: h.author_display_name ?? '',
    attachment_names: h.attachment_names ?? [],
    has_image: !!h.has_image,
    has_file: !!h.has_file,
    has_voice: !!h.has_voice,
    has_link: !!h.has_link,
    has_poll: !!h.has_poll,
    is_pinned: !!h.is_pinned,
    is_edited: !!h.is_edited,
    is_forwarded: !!h.is_forwarded,
  }));
}

export function createAdvController(initialQuery: string): AdvController {
  const store = createStore<AdvState>(() => ({
    ...DEFAULT_FILTERS,
    q: initialQuery,
    groupBy: 'none',
    hits: [],
    isFetching: false,
    isFetchingNext: false,
    hasNext: true,
    pending: false,
  }));
  const get = store.getState;
  const set = (p: Partial<AdvState>) => store.setState(p);

  let token = 0;
  let offset = 0;
  let timer = 0;
  let disposed = false;

  const runSearch = async () => {
    timer = 0;
    const mine = ++token;
    offset = 0;
    const f = get();
    set({ hasNext: true, pending: false });
    if (isEmptySearch(f)) {
      set({ hits: [], isFetching: false });
      return;
    }
    set({ isFetching: true });
    let res: GlobalMessageHit[] = [];
    try {
      res = normalize(await searchApi.messages(paramsOf(f, 0)));
    } catch {
      res = [];
    }
    if (mine !== token || disposed) return;
    // keepPreviousData: the old hits stay visible until now
    set({ hits: dedup(res), hasNext: res.length >= PAGE_SIZE, isFetching: false });
    offset = PAGE_SIZE;
  };

  const filtersChanged = () => {
    if (disposed) return;
    if (timer) window.clearTimeout(timer);
    set({ pending: !isEmptySearch(get()) });
    timer = window.setTimeout(() => void runSearch(), DEBOUNCE_MS);
  };

  const update = (patch: Partial<AdvFilters>) => {
    set(patch);
    filtersChanged();
  };

  return {
    store,
    start() {
      if (disposed) disposed = false;
      if (!isEmptySearch(get())) void runSearch();
    },
    update,
    setGroupBy(g) {
      set({ groupBy: g });
    },
    apply(saved) {
      set(decodeSaved(saved));
      filtersChanged();
    },
    reset() {
      set({ ...DEFAULT_FILTERS, groupBy: 'none', hits: [], hasNext: true });
      offset = 0;
      filtersChanged();
    },
    toggleGroup(g) {
      const f = get();
      const ids = new Set(g.chats.map((c) => c.id));
      const chatIds = f.chatIds.filter((id) => !ids.has(id));
      if (groupState(f, g) === 'all') update({ groupIds: f.groupIds.filter((id) => id !== g.group.id), chatIds });
      else update({ groupIds: f.groupIds.includes(g.group.id) ? f.groupIds : [...f.groupIds, g.group.id], chatIds });
    },
    toggleChat(g, c) {
      const f = get();
      if (f.groupIds.includes(g.group.id)) {
        // demote the group to its individual chats (all but this one)
        const others = g.chats.filter((x) => x.id !== c.id).map((x) => x.id);
        update({
          groupIds: f.groupIds.filter((id) => id !== g.group.id),
          chatIds: Array.from(new Set([...f.chatIds, ...others])),
        });
      } else if (f.chatIds.includes(c.id)) update({ chatIds: f.chatIds.filter((id) => id !== c.id) });
      else update({ chatIds: [...f.chatIds, c.id] });
    },
    toggleAuthor(id) {
      const f = get();
      update({ fromUserIds: f.fromUserIds.includes(id) ? f.fromUserIds.filter((x) => x !== id) : [...f.fromUserIds, id] });
    },
    loadNext() {
      const f = get();
      if (disposed || !f.hasNext || f.isFetchingNext || f.isFetching || f.pending || isEmptySearch(f)) return;
      const mine = token;
      const at = offset;
      set({ isFetchingNext: true });
      void (async () => {
        let res: GlobalMessageHit[] = [];
        try {
          res = normalize(await searchApi.messages(paramsOf(f, at)));
        } catch {
          res = []; // swallowed like iOS → hasNext = false → "End of results"
        }
        if (disposed) return;
        if (mine !== token) {
          set({ isFetchingNext: false });
          return;
        }
        const existing = new Set(get().hits.map((h) => h.id));
        const fresh = dedup(res).filter((h) => !existing.has(h.id));
        set({
          hits: fresh.length ? [...get().hits, ...fresh] : get().hits,
          hasNext: !(res.length < PAGE_SIZE || fresh.length === 0),
          isFetchingNext: false,
        });
        offset = at + PAGE_SIZE;
      })();
    },
    dispose() {
      disposed = true;
      token++;
      if (timer) window.clearTimeout(timer);
      timer = 0;
      set({ isFetching: false, isFetchingNext: false, pending: false });
    },
  };
}

/** RFC 4122 v4 id (crypto.randomUUID is missing outside secure contexts). */
export function uuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
