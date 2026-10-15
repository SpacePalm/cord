// Message list scroll container (iOS MessageListContent ScrollView + LazyVStack).
//  · opens at the very bottom (even with an unread separator), keeps the bottom pinned while the user
//    is there (new messages, images loading, composer / keyboard resizes)
//  · top auto-load of older pages (armed trigger, iOS semantics) with position preservation
//  · jump: scroll the target to the centre (animated) + accent@15% highlight cleared after 1.8s
//  · window mode: inline "К последним сообщениям" link at the end
//  · dragging the list downward dismisses the keyboard (.scrollDismissesKeyboard(.interactively))
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Message } from '../../../types';
import { useMT } from '../../i18n';
import { Spinner } from '../../ui/Spinner';
import { DaySeparator, MessageRow, UnreadSeparator, needsHeader } from '../message/MessageRow';
import type { ChatTimelineApi } from './useChatTimeline';
import { sameDay, tsOf } from './timelineCache';

export interface ChatTimelineHandle {
  /** Scroll to the bottom anchor (composer focus → animated). */
  scrollToBottom(smooth: boolean): void;
  /** The scroll container element (context-menu bounds). */
  element(): HTMLDivElement | null;
}

export interface ChatTimelineProps {
  chatId: string;
  tl: ChatTimelineApi;
  selecting: boolean;
  selectedIds: ReadonlySet<string>;
  onToggleSelect: (msg: Message) => void;
  onLongPress: (msg: Message, rowEl: HTMLElement) => void;
  onSwipeReply: (msg: Message) => void;
  onAuthorPress: (msg: Message, anchor: HTMLElement) => void;
  onReact: (msg: Message, emoji: string) => void;
  onReplyJump: (messageId: string) => void;
  onRetry: (localId: string) => void;
  /** Blur the composer (scroll-dismisses-keyboard). */
  onDismissKeyboard: () => void;
}

const NEAR_BOTTOM = 48;
const HIGHLIGHT_MS = 1800;

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function cssEscape(id: string): string {
  try {
    return CSS.escape(id);
  } catch {
    return id.replace(/["\\]/g, '\\$&');
  }
}

/** Stable callback identity (MessageRow memoisation) that always calls the latest closure. */
function useEvent<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}

export const ChatTimeline = forwardRef<ChatTimelineHandle, ChatTimelineProps>(function ChatTimeline(props, ref) {
  const { chatId, tl, selecting, selectedIds } = props;
  const t = useMT();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // state (not a ref): the trigger mounts only once the first page arrived → the observer must re-attach
  const [topEl, setTopEl] = useState<HTMLDivElement | null>(null);

  const didInitialRef = useRef(false);
  const pinnedRef = useRef(true);
  const stickUntilRef = useRef(0);
  const jumpUntilRef = useRef(0);
  const armedRef = useRef(true);
  const firstRowRef = useRef<{ id: string; top: number } | null>(null);
  const lastHeightRef = useRef(0);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimer = useRef<number>(0);
  const jumpSettleTimer = useRef<number>(0);

  const rowEl = useCallback((id: string): HTMLElement | null => {
    return listRef.current?.querySelector<HTMLElement>(`[data-mid="${cssEscape(id)}"]`) ?? null;
  }, []);

  const toBottom = useCallback((smooth: boolean) => {
    const sc = scrollerRef.current;
    if (!sc) return;
    pinnedRef.current = true;
    if (smooth && !reducedMotion()) {
      stickUntilRef.current = performance.now() + 700;
      sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' });
    } else sc.scrollTop = sc.scrollHeight;
  }, []);

  useImperativeHandle(ref, () => ({ scrollToBottom: toBottom, element: () => scrollerRef.current }), [toBottom]);

  const itemsCount = tl.messages.length + tl.pending.length;

  // ── positioning after every commit: prepend compensation, initial scroll, bottom pinning ──
  useLayoutEffect(() => {
    const sc = scrollerRef.current;
    if (!sc) return;
    if (tl.messages.length === 0) {
      // no server rows (first load, jumpToLatest reset, cleared chat) → the next batch opens at the bottom.
      // Keyed on the server rows, not itemsCount: optimistic / failed rows survive a reset and would
      // otherwise keep the list "initialised" so the reloaded page could land mid-list.
      didInitialRef.current = false;
      pinnedRef.current = true;
      firstRowRef.current = null;
      if (itemsCount > 0) sc.scrollTop = sc.scrollHeight;
      lastHeightRef.current = sc.scrollHeight;
      return;
    }
    const first = tl.messages[0];
    const prev = firstRowRef.current;
    if (prev && first && prev.id !== first.id && didInitialRef.current && !pinnedRef.current) {
      const el = rowEl(prev.id);
      if (el) {
        // iOS loadOlder: the former first message is scrolled to the TOP of the visible area
        // (scrollTo(id, anchor: .top) without animation) — right under the floating nav bar
        const scRect = sc.getBoundingClientRect();
        const bar = sc.closest('.ios-screen')?.querySelector<HTMLElement>('.ios-nav-bar');
        const topInset = bar ? Math.max(0, bar.getBoundingClientRect().bottom - scRect.top) : 0;
        const y = sc.scrollTop + (el.getBoundingClientRect().top - scRect.top) - topInset;
        sc.scrollTop = Math.max(0, y);
      }
    }
    if (first) {
      const el = rowEl(first.id);
      firstRowRef.current = el ? { id: first.id, top: el.offsetTop } : null;
    } else firstRowRef.current = null;

    if (!didInitialRef.current) {
      if (itemsCount > 0) {
        sc.scrollTop = sc.scrollHeight;
        didInitialRef.current = true;
        pinnedRef.current = true;
      }
    } else if (pinnedRef.current && sc.scrollHeight !== lastHeightRef.current) {
      sc.scrollTop = sc.scrollHeight;
    }
    lastHeightRef.current = sc.scrollHeight;
  });

  // content / viewport size changes (images, composer growth, keyboard) keep the bottom pinned
  useEffect(() => {
    const sc = scrollerRef.current;
    const list = listRef.current;
    if (!sc || !list || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (didInitialRef.current && pinnedRef.current) sc.scrollTop = sc.scrollHeight;
      lastHeightRef.current = sc.scrollHeight;
    });
    ro.observe(sc);
    ro.observe(list);
    return () => ro.disconnect();
  }, []);

  const onScroll = useCallback(() => {
    const sc = scrollerRef.current;
    if (!sc) return;
    // an animated jump starts near the bottom: don't let its first frames re-pin the list
    if (performance.now() < jumpUntilRef.current) return;
    const dist = sc.scrollHeight - sc.scrollTop - sc.clientHeight;
    if (dist <= NEAR_BOTTOM) pinnedRef.current = true;
    else if (performance.now() > stickUntilRef.current) pinnedRef.current = false;
  }, []);

  // ── top trigger: fires when it appears (after the initial scroll), re-arms when it leaves ──
  const loadOlder = tl.loadOlder;
  useEffect(() => {
    const sc = scrollerRef.current;
    const top = topEl;
    if (!sc || !top || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[entries.length - 1];
        if (!e) return;
        if (!e.isIntersecting) {
          armedRef.current = true;
          return;
        }
        if (!didInitialRef.current || !armedRef.current) return;
        armedRef.current = false;
        void loadOlder();
      },
      { root: sc, threshold: 0 },
    );
    io.observe(top);
    return () => io.disconnect();
  }, [topEl, loadOlder]);

  // ── jump target → animated centre scroll + highlight ──
  const { scrollTarget, consumeScrollTarget } = tl;
  useEffect(() => {
    if (!scrollTarget) return;
    consumeScrollTarget();
    const sc = scrollerRef.current;
    const el = rowEl(scrollTarget.id);
    didInitialRef.current = true;
    if (!sc || !el) return;
    const scRect = sc.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const bar = sc.closest('.ios-screen')?.querySelector<HTMLElement>('.ios-nav-bar');
    const topInset = bar ? Math.max(0, bar.getBoundingClientRect().bottom - scRect.top) : 0;
    const visibleH = sc.clientHeight - topInset;
    const elTop = sc.scrollTop + (elRect.top - scRect.top);
    const target = elTop + elRect.height / 2 - (topInset + visibleH / 2);
    const max = sc.scrollHeight - sc.clientHeight;
    pinnedRef.current = false;
    stickUntilRef.current = 0;
    const smooth = !reducedMotion();
    jumpUntilRef.current = smooth ? performance.now() + 800 : 0;
    sc.scrollTo({ top: Math.max(0, Math.min(max, target)), behavior: smooth ? 'smooth' : 'auto' });
    // re-evaluate "near bottom" once the animated scroll settled (a jump to the last rows re-pins)
    window.clearTimeout(jumpSettleTimer.current);
    jumpSettleTimer.current = window.setTimeout(() => {
      const el2 = scrollerRef.current;
      if (el2 && el2.scrollHeight - el2.scrollTop - el2.clientHeight <= NEAR_BOTTOM) pinnedRef.current = true;
    }, smooth ? 850 : 0);
    setHighlightId(scrollTarget.id);
    window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
  }, [scrollTarget, consumeScrollTarget, rowEl]);
  useEffect(
    () => () => {
      window.clearTimeout(highlightTimer.current);
      window.clearTimeout(jumpSettleTimer.current);
    },
    [],
  );

  // ── dragging the list downward dismisses the keyboard ──
  const touchY = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchY.current = e.touches.length === 1 ? e.touches[0].clientY : null;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchY.current == null || e.touches.length !== 1) return;
    if (e.touches[0].clientY - touchY.current > 10) {
      touchY.current = null;
      props.onDismissKeyboard();
    }
  };

  // ── rows (iOS MessageListContent.rows) ──
  const onToggleSelect = useEvent(props.onToggleSelect);
  const onLongPress = useEvent(props.onLongPress);
  const onSwipeReply = useEvent(props.onSwipeReply);
  const onAuthorPress = useEvent(props.onAuthorPress);
  const onReact = useEvent(props.onReact);
  const onReplyJump = useEvent(props.onReplyJump);
  const onRetry = useEvent(props.onRetry);

  const myId = tl.myId;
  const rows = useMemo(() => {
    const out: ReactNode[] = [];
    const anchorMs = tl.unreadAnchor ? Date.parse(tl.unreadAnchor) : NaN;
    let unreadInserted = !Number.isFinite(anchorMs);
    let prev: Message | undefined;
    const push = (msg: Message, pendingState?: { state: 'sending' | 'failed'; progress?: number }) => {
      const newDay = !prev || !sameDay(prev, msg);
      if (newDay) out.push(<DaySeparator key={`day-${msg.id}`} date={msg.created_at} />);
      if (!unreadInserted && !pendingState && msg.author_id !== myId && tsOf(msg) > anchorMs) {
        out.push(<UnreadSeparator key="unread" />);
        unreadInserted = true;
      }
      const showHeader = newDay || needsHeader(prev, msg);
      const isMine = !!myId && msg.author_id === myId;
      const retry = pendingState?.state === 'failed' ? () => onRetry(msg.id) : undefined;
      out.push(
        <div className="m-chat-row" data-mid={msg.id} key={msg.id}>
          <MessageRow
            msg={msg}
            chatId={chatId}
            showHeader={showHeader}
            isMine={isMine}
            pending={pendingState}
            highlighted={highlightId === msg.id}
            selecting={selecting}
            selected={selectedIds.has(msg.id)}
            onToggleSelect={onToggleSelect}
            onLongPress={onLongPress}
            onSwipeReply={onSwipeReply}
            onAuthorPress={isMine ? undefined : onAuthorPress}
            onReact={onReact}
            onJumpTo={onReplyJump}
            onRetry={retry}
          />
        </div>,
      );
      prev = msg;
    };
    for (const m of tl.messages) push(m);
    for (const p of tl.pending) push(p.msg, { state: p.state, progress: p.progress });
    return out;
  }, [
    tl.messages,
    tl.pending,
    tl.unreadAnchor,
    myId,
    chatId,
    highlightId,
    selecting,
    selectedIds,
    onToggleSelect,
    onLongPress,
    onSwipeReply,
    onAuthorPress,
    onReact,
    onReplyJump,
    onRetry,
  ]);

  return (
    <div
      className="m-chat-scroller"
      ref={scrollerRef}
      onScroll={onScroll}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      data-selecting={selecting || undefined}
    >
      <div className="m-chat-list" ref={listRef}>
        {tl.hasMoreOlder && itemsCount > 0 && (
          <div className={`m-chat-top${tl.loadingOlder ? ' is-loading' : ''}`} ref={setTopEl} aria-hidden={!tl.loadingOlder}>
            {tl.loadingOlder && <Spinner size="regular" />}
          </div>
        )}
        {rows}
        {tl.hasMoreNewer && itemsCount > 0 && (
          <button type="button" className="m-chat-latest ios-t-footnote" onClick={() => void tl.jumpToLatest()}>
            {t('chat.jumpToLatest')}
          </button>
        )}
        <div className="m-chat-bottom-anchor" aria-hidden />
      </div>
    </div>
  );
});
