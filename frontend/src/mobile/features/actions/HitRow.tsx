// Row body shared by the pinned sheet and in-chat search results.
// VStack(spacing 3) { HStack(spacing 6) { name 15/500, date 12 muted }, text 15 secondary ≤3 lines, 📎 12 muted },
// .padding(.vertical, 2).
import type { ReactNode } from 'react';
import type { Message } from '../../../types';
import { withEmoji } from '../message/format';
import { fmtDayMonthTime } from './shared';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive occurrences of `q` on an accent @35% background (ChatSearchView.highlighted). */
export function highlight(text: string, q: string): ReactNode[] {
  if (!q) return [withEmoji(text)];
  let re: RegExp;
  try {
    re = new RegExp(escapeRe(q), 'gi');
  } catch {
    return [withEmoji(text)];
  }
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (!m[0]) break;
    if (i > last) out.push(<span key={k++}>{withEmoji(text.slice(last, i))}</span>);
    out.push(<mark key={k++}>{withEmoji(m[0])}</mark>);
    last = i + m[0].length;
  }
  if (last < text.length) out.push(<span key={k++}>{withEmoji(text.slice(last))}</span>);
  return out;
}

export function HitRowBody({
  msg,
  locale,
  query,
  attachmentsText,
}: {
  msg: Message;
  locale: string;
  /** Search query to highlight (search sheet only). */
  query?: string;
  /** "📎 N" (pinned) or "📎 N вложение(й)" (search). */
  attachmentsText?: string;
}) {
  const name = msg.author_display_name || msg.author_username;
  const content = msg.content ?? '';
  return (
    <div className="m-act-hit">
      <div className="m-act-hit-head">
        <span className="m-act-hit-name">{name}</span>
        <span className="m-act-hit-date">{fmtDayMonthTime(msg.created_at, locale)}</span>
      </div>
      {content !== '' && <div className="m-act-hit-text">{query ? highlight(content, query) : withEmoji(content)}</div>}
      {msg.attachments.length > 0 && attachmentsText && <div className="m-act-hit-att">{withEmoji(attachmentsText)}</div>}
    </div>
  );
}
