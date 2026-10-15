// iOS `MessageRowView` (Features/Chat/MessageListView.swift 940-1150) + `DaySeparator` / `UnreadSeparator` and
// the feed grouping rules (`rows`, 902-938). Flat Discord-style rows: no bubbles, own = others.
//   row (full width; jump highlight + selection tint)
//   └─ [selection glyph]  ZStack(trailing)
//                          ├─ reply arrow (behind, opacity -dx/56)
//                          └─ content (translateX(dx); .6 while sending)
//                             padding 8|1 / 22 / 1 / 12 · [avatar 36 | 36px blank] 10 [column, VStack(2)]
//   column: header · pin (compact) · reply · forwarded (+ its content) · text · attachments · embeds · poll ·
//           (edited) · reactions · send state
import './message.css';
import { memo, useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { Message, Poll } from '../../../types';
import { useAuthStore } from '../../../store/authStore';
import { Avatar, Icon, ProgressRing, Spinner, haptic, useLongPress } from '../../ui';
import { attachDrag } from '../../nav/gesture';
import { useMT, useMobileLocale } from '../../i18n';
import { MessageBody, withEmoji } from './format';
import { AuthedImage } from './AuthedImage';
import { FileAttachmentChip } from './FileAttachmentChip';
import { VoiceNotePlayer } from './VoiceNotePlayer';
import { EmbedCard } from './EmbedCard';
import { PollCard } from './PollCard';
import { openImageViewer } from './ImageViewer';
import { classifyAttachment, toAuthedUrl } from './media';
import { formatDayLabel, formatMessageTime, parseDate, sameCalendarDay } from './time';

export interface PendingState {
  state: 'sending' | 'failed';
  /** 0…1 upload progress (ProgressRing) when attachments are uploading. */
  progress?: number;
}

export interface MessageRowProps {
  msg: Message;
  /** Header row (avatar + name + time) vs compact continuation row. See needsHeader(). */
  showHeader: boolean;
  isMine: boolean;
  chatId: string;
  /** Optimistic row state (sending / failed with retry). */
  pending?: PendingState;
  /** Jump highlight: accent @15%, fades in 300ms, out after 1.8s (parent toggles it). */
  highlighted?: boolean;
  /** Selection mode: leading circle / checkmark.circle.fill, tap toggles. */
  selecting?: boolean;
  selected?: boolean;
  onToggleSelect?: (msg: Message) => void;
  /** Long press (400ms) → parent opens the context menu for this row element. */
  onLongPress?: (msg: Message, rowEl: HTMLElement) => void;
  /** Swipe left ≥56px → reply. */
  onSwipeReply?: (msg: Message) => void;
  /** Tap on avatar / author name → user actions menu (not for yourself). */
  onAuthorPress?: (msg: Message, anchor: HTMLElement) => void;
  /** Tap on a reaction chip (toggle). */
  onReact?: (msg: Message, emoji: string) => void;
  /** Tap on the reply line → scroll/jump to the original. */
  onJumpTo?: (messageId: string) => void;
  /** Failed optimistic row: tap to retry. */
  onRetry?: () => void;
  /**
   * After a poll vote / retract the row patches `['messages', chatId]` itself (invalidating when the message is
   * not in that first page). Owners of other copies (older pages kept in local state) get the new message here.
   */
  onMessageChange?: (msg: Message) => void;
}

interface RowViewProps extends MessageRowProps {
  interactive: boolean;
}

/** SF `arrowshape.turn.up.left.fill` (lucide has no filled variant). */
function ReplyArrowFill({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable={false}>
      <path
        fill="currentColor"
        d="M10.2 3.5 2.5 10.1a1.1 1.1 0 0 0 0 1.7l7.7 6.6a.75.75 0 0 0 1.24-.57V14h2.2c3 0 5.1 1.6 6.2 4.7l.3.8c.2.5.95.4.95-.15C21.1 12.4 18 8.4 13.6 8.4h-2.15V4.07a.75.75 0 0 0-1.24-.57z"
      />
    </svg>
  );
}

/** True when the touch started inside a horizontally scrollable code body (its own scroller wins). */
function inHorizontalScroller(target: EventTarget | null): boolean {
  let el = target instanceof Element ? (target as HTMLElement) : null;
  while (el) {
    if (el.hasAttribute('data-hscroll') && el.scrollWidth > el.clientWidth + 1) return true;
    if (el.classList.contains('m-msg-row')) return false;
    el = el.parentElement;
  }
  return false;
}

function replyLineText(name: string, content: string | null): string {
  const full = `↩︎ ${name}: ${content ?? ''}`;
  const nl = full.indexOf('\n');
  return nl < 0 ? full : full.slice(0, nl) + '…';
}

function RowView(p: RowViewProps) {
  const { msg, showHeader, isMine, pending, highlighted, interactive } = p;
  const selecting = !!p.selecting && interactive;
  const selectable = !pending;
  const t = useMT();
  const locale = useMobileLocale();
  const me = useAuthStore((s) => s.user?.id);
  const [reveal, setReveal] = useState(false);
  const toggleSpoiler = useCallback(() => setReveal((v) => !v), []);

  const rowRef = useRef<HTMLDivElement | null>(null);
  const slideRef = useRef<HTMLDivElement | null>(null);
  const arrowRef = useRef<HTMLSpanElement | null>(null);
  const live = useRef(p);
  live.current = p;

  // ── long press (0.4s, medium haptic) ──
  const longPress = useLongPress(
    (el) => {
      const cur = live.current;
      if (!cur.onLongPress || cur.selecting) return;
      haptic('medium');
      cur.onLongPress(cur.msg, el);
    },
    { disabled: !interactive || selecting || !p.onLongPress },
  );

  // native text selection / callout suppressed while a finger is down
  const pressing = (on: boolean) => rowRef.current?.classList.toggle('is-pressing', on);
  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'mouse') pressing(true);
    longPress.onPointerDown(e);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    pressing(false);
    longPress.onPointerUp(e);
  };
  const onPointerCancel = (e: ReactPointerEvent<HTMLElement>) => {
    pressing(false);
    longPress.onPointerCancel(e);
  };

  // ── swipe left to reply (DragGesture(minimumDistance: 18); ≥56 commits; max 72; spring back) ──
  useEffect(() => {
    if (!interactive) return;
    const row = rowRef.current;
    if (!row) return;
    let offset = 0;
    const paint = (v: number, animate: boolean) => {
      offset = v;
      const slide = slideRef.current;
      const arrow = arrowRef.current;
      const tr = animate ? 'transform 350ms cubic-bezier(0.34, 1.36, 0.64, 1)' : 'none';
      if (slide) {
        slide.style.transition = tr;
        slide.style.transform = v ? `translate3d(${v}px, 0, 0)` : '';
      }
      if (arrow) {
        arrow.style.transition = animate ? 'opacity 300ms ease-out' : 'none';
        arrow.style.opacity = String(Math.max(0, Math.min(1, -v / 56)));
      }
    };
    return attachDrag(row, {
      begin: (e) => {
        const cur = live.current;
        if (cur.selecting || !cur.onSwipeReply) return false;
        return !inHorizontalScroller(e.target);
      },
      decide: (dx, dy) => {
        if (Math.hypot(dx, dy) < 18) return undefined;
        return dx < 0 && Math.abs(dx) > Math.abs(dy) ? 'claim' : 'reject';
      },
      move: (dx, dy) => {
        // iOS only writes the offset while the drag is leftward-dominant (otherwise it freezes)
        if (dx < 0 && Math.abs(dx) > Math.abs(dy)) paint(Math.max(dx, -72), false);
      },
      end: ({ cancelled }) => {
        const cur = live.current;
        if (!cancelled && offset <= -56 && cur.onSwipeReply && !cur.selecting) {
          cur.onSwipeReply(cur.msg);
          haptic('medium');
        }
        pressing(false);
        paint(0, true);
      },
    });
  }, [interactive]);

  const name = msg.author_display_name || msg.author_username || '';
  const authorTappable = interactive && !selecting && !isMine && !!p.onAuthorPress;
  const onAuthor = (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    live.current.onAuthorPress?.(live.current.msg, e.currentTarget);
  };
  const time = showHeader ? formatMessageTime(msg.created_at, locale) : null;

  const avatar = <Avatar src={msg.author_image_path || null} name={name} size={36} />;
  const lead = showHeader ? (
    authorTappable ? (
      <button type="button" className="m-msg-author" onClick={onAuthor} aria-label={name}>
        {avatar}
      </button>
    ) : (
      <span className="m-msg-author">{avatar}</span>
    )
  ) : null;

  const fwd = msg.forwarded_from;
  const nodes: ReactNode[] = [];

  if (showHeader) {
    nodes.push(
      <div key="head" className="m-msg-head">
        {authorTappable ? (
          <button type="button" className="m-msg-name" onClick={onAuthor}>
            {name}
          </button>
        ) : (
          <span className="m-msg-name">{name}</span>
        )}
        {time ? <span className="m-msg-time">{time}</span> : null}
        {msg.is_pinned ? <Icon name="pin.fill" size={13} strokeWidth={1.5} className="m-msg-pin" /> : null}
      </div>,
    );
  } else if (msg.is_pinned) {
    nodes.push(
      <span key="pin" className="m-msg-pinline">
        <Icon name="pin.fill" size={13} strokeWidth={1.5} />
      </span>,
    );
  }

  if (msg.reply_to) {
    const reply = msg.reply_to;
    const label = replyLineText(reply.author_display_name, reply.content);
    nodes.push(
      interactive && p.onJumpTo ? (
        <button
          key="reply"
          type="button"
          className="m-msg-reply"
          onClick={(e) => {
            e.stopPropagation();
            live.current.onJumpTo?.(reply.message_id);
          }}
        >
          {withEmoji(label)}
        </button>
      ) : (
        <div key="reply" className="m-msg-reply">
          {withEmoji(label)}
        </div>
      ),
    );
  }

  if (fwd) {
    nodes.push(
      <div key="fwd" className="m-msg-meta">
        {t('chat.forwardedFrom', fwd.author_display_name)}
      </div>,
    );
    // Deliberate deviation: iOS drops the forwarded text (backend stores it only here).
    if (fwd.content && !msg.content) {
      nodes.push(<MessageBody key="fwdbody" content={fwd.content} revealSpoilers={reveal} onToggleSpoiler={interactive ? toggleSpoiler : undefined} />);
    }
  }

  if (msg.content) {
    nodes.push(<MessageBody key="body" content={msg.content} revealSpoilers={reveal} onToggleSpoiler={interactive ? toggleSpoiler : undefined} />);
  }

  (msg.attachments ?? []).forEach((path, i) => {
    const kind = classifyAttachment(path);
    const url = toAuthedUrl(path);
    if (kind === 'image') {
      nodes.push(
        <AuthedImage
          key={`a${i}`}
          url={url}
          alt={t('chat.attachment')}
          className="m-msg-att-img"
          onPress={interactive ? () => openImageViewer(url) : undefined}
        />,
      );
    } else if (kind === 'voice') {
      nodes.push(<VoiceNotePlayer key={`a${i}`} url={url} />);
    } else {
      nodes.push(<FileAttachmentChip key={`a${i}`} url={url} />);
    }
  });

  (msg.embeds ?? []).forEach((embed, i) => nodes.push(<EmbedCard key={`e${i}`} embed={embed} />));

  if (msg.poll) {
    nodes.push(
      <PollCard
        key="poll"
        poll={msg.poll}
        chatId={p.chatId}
        messageId={msg.id}
        onPollChange={(poll: Poll) => live.current.onMessageChange?.({ ...live.current.msg, poll })}
      />,
    );
  }

  if (msg.is_edited) {
    nodes.push(
      <div key="edited" className="m-msg-meta">
        {t('chat.edited')}
      </div>,
    );
  }

  if (msg.reactions?.length) {
    nodes.push(
      <div key="reacts" className="m-msg-reacts">
        {msg.reactions.map((g) => {
          const mine = !!me && g.users.some((u) => u.user_id === me);
          return (
            <button
              key={g.emoji}
              type="button"
              className={'m-msg-react' + (mine ? ' is-mine' : '')}
              onClick={(e) => {
                e.stopPropagation();
                live.current.onReact?.(live.current.msg, g.emoji);
              }}
            >
              <span className="m-msg-react-emoji">{g.emoji}</span>
              <span className="m-msg-react-count">{g.users.length}</span>
            </button>
          );
        })}
      </div>,
    );
  }

  if (pending?.state === 'sending') {
    nodes.push(
      <div key="state" className="m-msg-sending">
        {pending.progress != null ? <ProgressRing value={pending.progress} size={22} /> : <Spinner />}
        <span>{t('chat.sending')}</span>
      </div>,
    );
  } else if (pending?.state === 'failed') {
    nodes.push(
      <button
        key="state"
        type="button"
        className="m-msg-failed"
        onClick={(e) => {
          e.stopPropagation();
          live.current.onRetry?.();
        }}
      >
        <Icon name="arrow.clockwise" size={12} strokeWidth={2.2} />
        <span>{t('chat.failedRetry')}</span>
      </button>,
    );
  }

  const cls =
    'm-msg-row' +
    (highlighted ? ' is-highlight' : '') +
    (selecting ? ' is-selecting' : '') +
    (selecting && p.selected ? ' is-selected' : '');

  return (
    <div
      ref={rowRef}
      className={cls}
      data-message-id={msg.id}
      onPointerDown={interactive ? onPointerDown : undefined}
      onPointerMove={interactive ? longPress.onPointerMove : undefined}
      onPointerUp={interactive ? onPointerUp : undefined}
      onPointerCancel={interactive ? onPointerCancel : undefined}
      onContextMenu={interactive ? longPress.onContextMenu : undefined}
      onClick={
        selecting && selectable
          ? () => {
              live.current.onToggleSelect?.(live.current.msg);
            }
          : undefined
      }
      aria-selected={selecting && selectable ? !!p.selected : undefined}
    >
      {selecting && selectable ? (
        <span className="m-msg-check" aria-hidden>
          {p.selected ? (
            <Icon name="checkmark.circle.fill" size={25} color="var(--accent)" />
          ) : (
            <Icon name="circle" size={25} strokeWidth={1.5} color="var(--text-muted)" />
          )}
        </span>
      ) : null}
      <div className="m-msg-zs">
        {interactive ? (
          <span ref={arrowRef} className="m-msg-arrow" aria-hidden>
            <ReplyArrowFill />
          </span>
        ) : null}
        <div ref={slideRef} className={'m-msg-slide' + (selecting && !selectable ? ' is-dimmed' : '')}>
          <div className={'m-msg-content' + (showHeader ? '' : ' is-compact') + (pending?.state === 'sending' ? ' is-sending' : '')}>
            <div className="m-msg-lead">{lead}</div>
            <div className="m-msg-col">{nodes}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** One message of the feed (flat iOS row). */
export const MessageRow = memo(function MessageRow(props: MessageRowProps) {
  return <RowView {...props} interactive />;
});

/** Non-interactive fresh copy of a row (header always shown) for the long-press menu card. */
export function MessagePreview({ msg, pending, chatId }: { msg: Message; pending?: PendingState; chatId?: string }) {
  return (
    <div className="m-msg-preview" aria-hidden>
      <RowView msg={msg} showHeader isMine={false} chatId={chatId ?? msg.chat_id} pending={pending} interactive={false} />
    </div>
  );
}

// ───────────────────────────── grouping ─────────────────────────────

/** iOS `newDay`: first message with a date, or a different calendar day than the previous message. */
export function isNewDay(prev: Message | undefined, msg: Message): boolean {
  const date = parseDate(msg.created_at);
  if (!date) return !prev;
  const prevDate = prev ? parseDate(prev.created_at) : null;
  if (!prevDate) return true;
  return !sameCalendarDay(date, prevDate);
}

/** iOS grouping: new header for a different author, gap > 300s, or a new calendar day. */
export function needsHeader(prev: Message | undefined, msg: Message): boolean {
  if (isNewDay(prev, msg)) return true;
  if (!prev) return true;
  if (prev.author_id !== msg.author_id) return true;
  const date = parseDate(msg.created_at);
  const prevDate = parseDate(prev.created_at);
  return !!date && !!prevDate && date.getTime() - prevDate.getTime() > 300_000;
}

export type FeedRow =
  | { kind: 'day'; key: string; date: string }
  | { kind: 'unread'; key: string }
  | { kind: 'message'; key: string; msg: Message; showHeader: boolean };

/**
 * Port of `MessageListContent.rows`: day separator (new calendar day) → unread separator (first message from
 * someone else newer than the anchor captured at open; nothing when the anchor is null) → message rows.
 * The unread separator does not break grouping.
 */
export function buildFeedRows(messages: Message[], opts: { unreadAnchor?: string | null; currentUserId?: string | null }): FeedRow[] {
  const anchor = parseDate(opts.unreadAnchor ?? null);
  const rows: FeedRow[] = [];
  let prev: Message | undefined;
  let unreadInserted = false;
  for (const m of messages) {
    const date = parseDate(m.created_at);
    if (isNewDay(prev, m) && date) rows.push({ kind: 'day', key: `day-${m.id}`, date: m.created_at });
    if (!unreadInserted && anchor && date && date.getTime() > anchor.getTime() && m.author_id !== opts.currentUserId) {
      rows.push({ kind: 'unread', key: `unread-${m.id}` });
      unreadInserted = true;
    }
    rows.push({ kind: 'message', key: m.id, msg: m, showHeader: needsHeader(prev, m) });
    prev = m;
  }
  return rows;
}

// ───────────────────────────── separators ─────────────────────────────

/** `DaySeparator`: 1px --border-color lines + caption2 muted "8 октября" / "October 8", padding 10×16. */
export function DaySeparator({ date, label }: { date: string; label?: string }) {
  const locale = useMobileLocale();
  return (
    <div className="m-msg-day" role="separator">
      <span className="m-msg-sep-line" />
      <span className="m-msg-sep-label">{label ?? formatDayLabel(date, locale)}</span>
      <span className="m-msg-sep-line" />
    </div>
  );
}

/** `UnreadSeparator`: accent@50% lines + caption2 semibold accent "Новые сообщения", padding 8×16. */
export function UnreadSeparator({ id }: { id?: string } = {}) {
  const t = useMT();
  return (
    <div className="m-msg-unread" role="separator" id={id} data-unread-divider="">
      <span className="m-msg-sep-line" />
      <span className="m-msg-sep-label">{t('chat.newMessages')}</span>
      <span className="m-msg-sep-line" />
    </div>
  );
}
