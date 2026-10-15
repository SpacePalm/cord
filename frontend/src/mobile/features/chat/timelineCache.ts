// Pure helpers for the chat timeline cache.
// The react-query cache ['messages', chatId] is the single store of every SERVER message loaded for
// a chat (latest page + older pages + jump windows), sorted by created_at. The global WS handler
// (hooks/useWebSocket.tsx) appends / edits / deletes / clears in it, so live updates reach every
// loaded message (iOS ChatStore.apply semantics) — not only the first page. Which part of the
// cache is shown (contiguous tail vs. a jump window) is decided by the timeline hook.
import type { Message } from '../../../types';

export const PAGE = 50;

const tsCache = new WeakMap<object, number>();

/** created_at → epoch ms (cached per message object; unparsable → 0). */
export function tsOf(m: Pick<Message, 'created_at'>): number {
  const hit = tsCache.get(m);
  if (hit !== undefined) return hit;
  const v = Date.parse(m.created_at);
  const ms = Number.isFinite(v) ? v : 0;
  tsCache.set(m, ms);
  return ms;
}

export function cmpMessages(a: Message, b: Message): number {
  const d = tsOf(a) - tsOf(b);
  if (d) return d;
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
}

export function isSortedAsc(list: Message[]): boolean {
  for (let i = 1; i < list.length; i++) if (cmpMessages(list[i - 1], list[i]) > 0) return false;
  return true;
}

/** Union by id (`add` wins), sorted ascending. */
export function mergeInto(prev: Message[] | undefined, add: Message[]): Message[] {
  if (!prev || prev.length === 0) return isSortedAsc(add) ? add : [...add].sort(cmpMessages);
  if (add.length === 0) return prev;
  const byId = new Map<string, Message>();
  for (const m of prev) byId.set(m.id, m);
  for (const m of add) byId.set(m.id, m);
  const out = Array.from(byId.values());
  out.sort(cmpMessages);
  return out;
}

/**
 * Merge a freshly fetched latest page into the cache.
 * Inside the page's time range the page is authoritative (drops messages deleted while offline);
 * cached messages older than the page (history pages / jump windows) and newer than it (WS events
 * that arrived while the request was in flight) are kept.
 * `contiguous` = the previously cached tail connects to the page (no hole between them).
 */
export function mergeLatest(prev: Message[] | undefined, latest: Message[]): { data: Message[]; contiguous: boolean } {
  const page = isSortedAsc(latest) ? latest : [...latest].sort(cmpMessages);
  if (!prev || prev.length === 0) return { data: page, contiguous: false };
  if (page.length === 0) {
    // empty chat: keep only messages that arrived meanwhile (none in practice)
    return { data: [], contiguous: false };
  }
  const first = tsOf(page[0]);
  const last = tsOf(page[page.length - 1]);
  const ids = new Set(page.map((m) => m.id));
  const before: Message[] = [];
  const after: Message[] = [];
  let overlap = false;
  for (const m of prev) {
    if (ids.has(m.id)) {
      overlap = true;
      continue;
    }
    const x = tsOf(m);
    if (x < first) before.push(m);
    else if (x > last) after.push(m);
  }
  const contiguous = overlap || page.length < PAGE;
  return { data: [...before, ...page, ...after], contiguous };
}

/** Replace one message (by id) wherever it is. */
export function patchMessage(list: Message[] | undefined, msg: Message): Message[] | undefined {
  if (!list) return list;
  let hit = false;
  const out = list.map((m) => {
    if (m.id !== msg.id) return m;
    hit = true;
    return msg;
  });
  return hit ? out : list;
}

/** +1 ms ISO cursor so the target itself lands in the "before" page (iOS isoPlusEpsilon). */
export function isoPlusEpsilon(iso: string): string {
  const v = Date.parse(iso);
  if (!Number.isFinite(v)) return iso;
  return new Date(v + 1).toISOString();
}

/** Same local calendar day. */
export function sameDay(a: Message, b: Message): boolean {
  const da = new Date(tsOf(a));
  const db = new Date(tsOf(b));
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}
