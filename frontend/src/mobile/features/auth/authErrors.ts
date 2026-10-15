// Error texts as iOS shows them: APIError.displayDetail /
// APIError.userMessage(default:) (Cord/Support/APIError+Message.swift, CordCore APIError.swift) and the
// security-block message ("Доступ временно заблокирован службой безопасности — до 8 окт., 14:30.").
// Other areas may import these (e.g. chat errors that can carry a block).
import { ApiError } from '../../../api/client';
import { LANGUAGES, useLangStore } from '../../../i18n';
import { mt } from '../../i18n';

export interface BlockInfo {
  /** 'ip' | 'account' */
  kind: string;
  /** Raw ISO expiry, or null for a permanent block. */
  expiresAt: string | null;
}

interface DetailObject {
  code?: unknown;
  kind?: unknown;
  expires_at?: unknown;
}

/** fail2ban block carried by the error (403 detail {code:'blocked_by_security', kind, expires_at}). */
export function blockInfoOf(err: unknown): BlockInfo | null {
  if (!(err instanceof ApiError)) return null;
  const d = err.detail as DetailObject | null | undefined;
  if (!d || typeof d !== 'object' || Array.isArray(d) || d.code !== 'blocked_by_security') return null;
  return {
    kind: typeof d.kind === 'string' && d.kind ? d.kind : 'ip',
    expiresAt: typeof d.expires_at === 'string' && d.expires_at ? d.expires_at : null,
  };
}

function currentLocale(): string {
  const lang = useLangStore.getState().lang;
  return LANGUAGES[lang]?.locale ?? 'en-US';
}

/** DateFormatter "d MMM, HH:mm" in the app locale ("8 окт., 14:30" / "8 Oct, 14:30"). */
export function formatBlockDate(iso: string, locale = currentLocale()): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')} ${get('month')}, ${get('hour')}:${get('minute')}`;
}

/** `block.until` / `block.permanent` with "Аккаунт"/"Доступ" as the subject. */
export function blockMessage(kind: string | null | undefined, expiresAt: string | null | undefined): string {
  const subject = mt(kind === 'account' ? 'block.account' : 'block.access');
  const until = expiresAt ? formatBlockDate(expiresAt) : null;
  return until ? mt('block.until', subject, until) : mt('block.permanent', subject);
}

/** True for transport failures (fetch rejects with a TypeError) and API errors. */
export function isApiLikeError(err: unknown): boolean {
  return err instanceof ApiError || err instanceof TypeError;
}

/**
 * APIError.displayDetail: server `detail` string, first 422 `msg`, or the transport message
 * (web substitute: login.networkError); null → caller's default. A block yields null.
 */
export function displayDetail(err: unknown): string | null {
  if (err instanceof ApiError) {
    const d = err.detail;
    if (typeof d === 'string') return d && d !== 'Unknown error' ? d : null;
    if (Array.isArray(d)) {
      const first = d.find((x) => x && typeof (x as { msg?: unknown }).msg === 'string') as { msg: string } | undefined;
      return first ? first.msg : null;
    }
    if (d && typeof d === 'object') {
      const code = (d as DetailObject).code;
      if (code === 'blocked_by_security') return null;
      return typeof code === 'string' && code ? code : null;
    }
    return null;
  }
  if (err instanceof TypeError) return mt('login.networkError');
  return null;
}

/** APIError.userMessage(default:): block text, else displayDetail, else the default. */
export function userMessage(err: unknown, fallback: string): string {
  const block = blockInfoOf(err);
  if (block) return blockMessage(block.kind, block.expiresAt);
  return displayDetail(err) ?? fallback;
}

/** iOS catch chain: APIError → userMessage(default:), anything else → "Ошибка: …". */
export function errorText(err: unknown, fallback: string): string {
  if (isApiLikeError(err)) return userMessage(err, fallback);
  const msg = err instanceof Error ? err.message : String(err);
  return mt('common.errorPrefix', msg);
}
