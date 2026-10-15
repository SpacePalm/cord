// Advanced-search result card (cord-ios AdvancedSearchView.swift `ResultCard`).
import { Icon, type SFSymbol } from '../../ui';
import { useMT } from '../../i18n';
import type { GlobalMessageHit } from '../../../api/search';
import { highlight } from './searchText';

const IMAGE_RE = /\.(jpg|jpeg|png|gif|webp|svg|heic|heif|bmp|avif)$/;

function attachmentIcon(name: string): SFSymbol {
  const l = name.toLowerCase();
  if (l.startsWith('voice_')) return 'mic.fill';
  if (IMAGE_RE.test(l)) return 'photo';
  return 'paperclip';
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
/** `.dateTime.day().month(.abbreviated).hour().minute()` → "8 окт., 14:05" / "Oct 8, 2:05 PM". */
function formatDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  let f = fmtCache.get(locale);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    fmtCache.set(locale, f);
  }
  return f.format(d);
}

const isHexColor = (s: string | null | undefined): s is string => !!s && /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s.trim());

export function ResultCard({ hit, query, locale }: { hit: GlobalMessageHit; query: string; locale: string }) {
  const t = useMT();
  const author = hit.author_display_name || hit.author_username;
  const names = hit.attachment_names ?? [];
  const flags: { on: boolean; icon: SFSymbol; color?: string }[] = [
    { on: hit.has_link, icon: 'link' },
    { on: hit.has_poll, icon: 'chart.bar' },
    { on: hit.is_pinned, icon: 'pin.fill', color: 'var(--ios-yellow)' },
    { on: hit.is_forwarded, icon: 'arrowshape.turn.up.right' },
  ];
  return (
    <div className="m-srch-card">
      <div className="m-srch-card-head">
        <span className="m-srch-card-author">{author}</span>
        <span className="m-srch-card-date">· {formatDate(hit.created_at, locale)}</span>
        <span className="m-srch-card-spacer" />
        {isHexColor(hit.chat_color) && <span className="m-srch-card-dot" style={{ background: hit.chat_color }} />}
        <span className="m-srch-card-chat">#{hit.chat_name}</span>
      </div>
      {hit.content ? <div className="m-srch-card-text">{highlight(hit.content, query, true)}</div> : null}
      {names.map((n, i) => (
        <div key={`${i}:${n}`} className="m-srch-card-att">
          <Icon name={attachmentIcon(n)} size={14} />
          <span>{n}</span>
        </div>
      ))}
      <div className="m-srch-card-flags">
        {flags
          .filter((f) => f.on)
          .map((f) => (
            <Icon key={f.icon} name={f.icon} size={13} color={f.color} />
          ))}
        {hit.is_edited && <span>{t('chat.edited')}</span>}
      </div>
    </div>
  );
}
