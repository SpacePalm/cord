// Shared helpers for the message-action surfaces.
import { ApiError } from '../../../api/client';
import { graphemeCount } from '../../ui/text';

/** Context-menu quick reactions (MessageListView.swift:230). */
export const QUICK_EMOJIS = ['👍', '❤️', '😂', '🎉', '😮', '😢'];

/** Expanded reaction grid (MessageContextMenuView.allEmojis, 40). */
export const ALL_REACTION_EMOJIS = [
  '👍', '👎', '❤️', '🔥', '🎉', '😂', '😮', '😢', '😡', '🥰', '😍', '🤔',
  '👏', '🙏', '💯', '✅', '❌', '👀', '🚀', '✨', '😅', '😎', '🤯', '🥳',
  '😭', '🤗', '🙌', '💪', '👌', '🤝', '😴', '🫡', '🤩', '😇', '🥹', '😤',
  '🫶', '💔', '⭐️', '🤣',
];

/** Composer popover palette (MessageListView.swift:295, 24). */
export const COMPOSER_EMOJIS = [
  '👍', '❤️', '😂', '🎉', '😮', '😢', '🔥', '🙏', '👀', '✅',
  '😀', '😅', '😍', '🤔', '😎', '😭', '🥳', '😡', '👏', '🙌',
  '💯', '🚀', '✨', '👌',
];

/** Number of Swift `Character`s (grapheme clusters) — `String.count`. */
export const charCount = graphemeCount;

/** `localizedCaseInsensitiveContains`. */
export function containsCI(haystack: string, needle: string): boolean {
  if (!needle) return true;
  return haystack.toLocaleLowerCase().includes(needle.toLocaleLowerCase());
}

const hour24Cache = new Map<string, boolean>();
function uses24h(locale: string): boolean {
  let v = hour24Cache.get(locale);
  if (v === undefined) {
    try {
      const opts = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions() as { hourCycle?: string; hour12?: boolean };
      const hc = opts.hourCycle ?? (opts.hour12 === false ? 'h23' : opts.hour12 ? 'h12' : undefined);
      v = hc === 'h23' || hc === 'h24';
    } catch {
      v = true;
    }
    hour24Cache.set(locale, v);
  }
  return v;
}

/** `.dateTime.day().month(.abbreviated).hour().minute()` → «5 окт., 09:05» / «Oct 5, 9:05 AM». */
export function fmtDayMonthTime(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    hour: uses24h(locale) ? '2-digit' : 'numeric',
    minute: '2-digit',
  });
}

/** `.dateTime.day().month(.abbreviated).year()` → «5 окт. 2026 г.» / «Oct 5, 2026». */
export function fmtDayMonthYear(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** iOS `APIError.userMessage(default:)`: server `detail` text, else the fallback. (Security blocks log out on web.) */
export function apiErrorText(e: unknown, fallback: string): string {
  if (e instanceof ApiError && typeof e.detail === 'string' && e.detail && e.detail !== 'Unknown error') return e.detail;
  return fallback;
}

/* ───────────── MediaKind (MediaViews.swift:204-233) ───────────── */

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'bmp']);
const AUDIO_EXT = new Set(['webm', 'ogg', 'mp3', 'wav', 'm4a', 'mp4', 'aac', 'flac']);

function ext(path: string): string {
  const parts = path.split('.');
  return (parts[parts.length - 1] ?? '').toLowerCase();
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXT.has(ext(path));
}

export function isAudioPath(path: string): boolean {
  return AUDIO_EXT.has(ext(path));
}

/** Display name: last path segment without the server `{uuid8}_` / full-UUID prefix (web `stripUuid`). */
export function displayName(path: string): string {
  let raw = path.split('/').pop() ?? path;
  try {
    raw = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  return raw.replace(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}_/i, '').replace(/^[0-9a-f]{8}_/i, '');
}

const URL_RE = /https?:\/\/[^\s<>"']+/g;

/** URLs in a message text (web `extractUrls` / iOS `extractURLs`). */
export function extractUrls(text: string | null | undefined): string[] {
  if (!text) return [];
  return Array.from(text.matchAll(URL_RE), (m) => m[0]);
}
