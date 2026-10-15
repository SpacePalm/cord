// Text helpers shared by the quick switcher and advanced search (iOS QuickSwitcherView / AdvancedSearchView).
import type { ReactNode } from 'react';
import { graphemeCount } from '../../ui/text';

/** Swift `query.split(separator: " ").filter { $0.count >= 2 }` (+ optional `!$0.contains(":")`). */
export function queryWords(query: string, skipColonWords = false): string[] {
  return query
    .split(' ')
    .filter((w) => w.length > 0 && graphemeCount(w) >= 2 && !(skipColonWords && w.includes(':')));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * iOS `highlighted(_:query:)`: every case-insensitive match of a query word (≥ 2 chars) gets an accent @30%
 * background, no padding / radius, text colour unchanged.
 */
export function highlight(text: string, query: string, skipColonWords = false): ReactNode {
  const words = queryWords(query, skipColonWords);
  if (!words.length || !text) return text;
  let re: RegExp;
  try {
    re = new RegExp(words.map(escapeRe).join('|'), 'gi');
  } catch {
    return text;
  }
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!m[0]) {
      re.lastIndex++;
      continue;
    }
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <mark key={k++} className="m-srch-hl">
        {m[0]}
      </mark>,
    );
    last = m.index + m[0].length;
  }
  if (!out.length) return text;
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * `QuickSwitcherStore.snippet(_:around:width:)` (= web `_snippetAround`): a window of `width` characters
 * around the first match; the centring uses the length of the FIRST word (not the matched one).
 */
export function snippetAround(text: string, query: string, width = 80): string {
  const words = queryWords(query);
  if (!words.length || text.length <= width) return text.slice(0, width);
  const lower = text.toLowerCase();
  let first = -1;
  for (const w of words) {
    const i = lower.indexOf(w.toLowerCase());
    if (i >= 0 && (first < 0 || i < first)) first = i;
  }
  if (first < 0) return text.slice(0, width);
  const start = Math.max(0, first - Math.max(0, Math.trunc((width - words[0].length) / 2)));
  const end = Math.min(start + width, text.length);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

// ───────────────────────────── recent searches (device-local) ─────────────────────────────
// Same key / format as the desktop CommandPalette history (localStorage["cord:search-history"]).

const RECENT_KEY = 'cord:search-history';
const RECENT_MAX = 10;

export function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr: unknown = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** `persistRecent()`: newest first, de-duplicated, ≥ 2 chars, max 10. Returns the new list. */
export function persistRecent(query: string): string[] {
  const q = query.trim();
  if (graphemeCount(q) < 2) return loadRecent();
  const next = [q, ...loadRecent().filter((x) => x !== q)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
  return next;
}

export function clearRecent(): void {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    /* ignore */
  }
}
