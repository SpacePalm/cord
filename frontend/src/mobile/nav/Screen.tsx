// Screen chrome for pushed screens (Screen) and sheet roots (SheetScreen): nav bar, large title,
// scroll-edge effect, sheet bar, pull to refresh.
//
// Layout contract for children:
//  · scroll=true (default): the Screen owns the vertical scroller. Content starts below the bar
//    (+ topInset), ends with an inset of safe-area + var(--ios-floating-bar-h) + 35px (or the bottom
//    bar height). The root carries data-title-mode="large|inline" for list top-inset rules.
//  · scroll=false: children fill the whole screen (top 0 → bottom bar / keyboard) and manage their
//    own scrolling; the bar floats over them. Use padding-top: var(--ios-content-top) on the scroller.
//  · bottomBar: positioned on top of the keyboard. It should pad itself with
//    `padding-bottom: var(--ios-bottom-inset)` (= safe-area + floating voice bar when the keyboard
//    is hidden, 0 while it is open) and paint its own background.
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
  type UIEvent,
} from 'react';
import { NavInternalContext, useNav, useScreenCtx } from './NavStack';
import { NavBar } from './NavBar';
import { BackButton } from './BarButton';
import { attachDrag } from './gesture';
import { readScroll, saveScroll } from './scrollCache';
import { useKeyboardInset } from '../ui/useKeyboardInset';
import { Spinner } from '../ui/Spinner';
import { haptic } from '../ui/haptics';
import { useMT } from '../i18n';
import './nav.css';

export interface ScreenProps {
  /** Nav-bar title. */
  title: string;
  /** 'large' only for root ("cord") and the channel list; everything else 'inline' (default). */
  titleMode?: 'large' | 'inline';
  /** Replaces the automatic back button (e.g. selection-mode "Cancel" text button). */
  leading?: ReactNode;
  /** Hide the automatic back button even when depth > 0. */
  hideBack?: boolean;
  /** Trailing bar items: <BarButton/>, <BarGroup>…</BarGroup>, <BarTextButton/>, <MenuButton>. */
  trailing?: ReactNode;
  /** Pull-to-refresh (UIRefreshControl look). Resolves when loading finished. */
  onRefresh?: () => Promise<unknown>;
  /** Strip pinned directly under the nav bar (e.g. "Соединение…"). */
  topInset?: ReactNode;
  /** Pinned bottom bar that rides on top of the on-screen keyboard (chat composer). */
  bottomBar?: ReactNode;
  /**
   * true (default): the screen owns a vertical scroller (lists, forms) with large-title
   * collapse + scroll-edge effect. false: children fill the area below the bar and manage
   * their own scrolling (chat timeline) — the bar still floats over content.
   */
  scroll?: boolean;
  /** Extra style for the scroll content box (e.g. form padding 20). */
  contentStyle?: CSSProperties;
  /** Page background; default var(--bg-primary). */
  background?: string;
  scrollRef?: Ref<HTMLDivElement>;
  onScroll?: (e: UIEvent<HTMLDivElement>) => void;
  children?: ReactNode;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === 'function') ref(value);
  else (ref as { current: T | null }).current = value;
}

/** Height of an element, kept up to date. */
function useHeight(): [(el: HTMLElement | null) => void, number] {
  const [h, setH] = useState(0);
  const roRef = useRef<ResizeObserver | null>(null);
  const cb = useCallback((el: HTMLElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el) {
      setH(0);
      return;
    }
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    roRef.current = ro;
    setH(el.offsetHeight);
  }, []);
  return [cb, h];
}

const PTR_TRIGGER = 70; // displayed pull (finger travel × 0.5)
const PTR_HOLD = 60; // gap kept while refreshing

/** Custom UIRefreshControl: pulls the content down with 0.5 resistance; spinner under the bar. */
function usePullToRefresh(
  scroller: HTMLDivElement | null,
  content: HTMLDivElement | null,
  indicator: HTMLDivElement | null,
  onRefresh: (() => Promise<unknown>) | undefined,
) {
  const [refreshing, setRefreshing] = useState(false);
  const busy = useRef(false);
  const offset = useRef(0);
  const cbRef = useRef(onRefresh);
  cbRef.current = onRefresh;

  const enabled = !!onRefresh;
  useEffect(() => {
    if (!scroller || !content || !indicator || !enabled) return;
    const setOffset = (y: number, animate: boolean) => {
      offset.current = y;
      const t = animate ? 'transform 350ms cubic-bezier(0.2, 0.9, 0.25, 1)' : 'none';
      content.style.transition = t;
      content.style.transform = y > 0 ? `translateY(${y}px)` : '';
      indicator.style.transition = animate ? 'height 350ms cubic-bezier(0.2, 0.9, 0.25, 1), opacity 200ms' : 'none';
      indicator.style.height = `${y}px`;
      indicator.style.opacity = busy.current ? '1' : String(Math.min(1, y / PTR_TRIGGER));
    };
    const trigger = () => {
      if (busy.current) return;
      busy.current = true;
      setRefreshing(true);
      haptic('light');
      let p: Promise<unknown>;
      try {
        p = Promise.resolve(cbRef.current?.());
      } catch (e) {
        p = Promise.reject(e);
      }
      void p
        .catch(() => undefined)
        .then(() => {
          busy.current = false;
          setRefreshing(false);
          setOffset(0, true);
        });
    };
    let base = 0;
    return attachDrag(scroller, {
      begin: () => scroller.scrollTop <= 0,
      decide: (dx, dy) => {
        // claim on the very first downward move so iOS never starts its own rubber-band (an exact
        // diagonal stays undecided: it may be the start of a row swipe / edge swipe)
        if (dy < 0 || Math.abs(dx) > Math.abs(dy) + 4) return 'reject';
        if (dy > 0 && dy > Math.abs(dx)) {
          base = offset.current;
          return 'claim';
        }
        return undefined;
      },
      move: (_dx, dy) => {
        const y = Math.max(0, base + dy * 0.5);
        setOffset(y, false);
        if (!busy.current && y >= PTR_TRIGGER) trigger();
      },
      end: () => {
        setOffset(busy.current ? PTR_HOLD : 0, true);
      },
    });
  }, [scroller, content, indicator, enabled]);

  return refreshing;
}

export function Screen({
  title,
  titleMode = 'inline',
  leading,
  hideBack,
  trailing,
  onRefresh,
  topInset,
  bottomBar,
  scroll = true,
  contentStyle,
  background,
  scrollRef,
  onScroll,
  children,
}: ScreenProps) {
  const t = useMT();
  const ctx = useScreenCtx();
  const nav = useNav();
  const internal = useContext(NavInternalContext);
  const kb = useKeyboardInset();
  const large = titleMode === 'large';
  const showBack = ctx.depth > 0 && !hideBack && !leading;

  const [scrolled, setScrolled] = useState(false);
  const [collapsed, setCollapsed] = useState(!large);
  const [topRef, topH] = useHeight();
  // iOS places a `.safeAreaInset(edge: .top)` strip below the expanded large title (it is part of the
  // bar); on inline screens it is pinned right under the 44px bar.
  const hasTopInset = topInset != null && topInset !== false;
  const inlineTopInset = hasTopInset && large && scroll;
  const [bottomRef, bottomH] = useHeight();
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const [indicator, setIndicator] = useState<HTMLDivElement | null>(null);
  const refreshing = usePullToRefresh(scroll ? scroller : null, content, indicator, onRefresh);

  // edge-swipe-back is only offered when the automatic back button is
  useEffect(() => {
    if (ctx.entryId != null) internal?.setBackEnabled(ctx.entryId, showBack);
  }, [internal, ctx.entryId, showBack]);

  const update = useCallback(
    (top: number) => {
      setScrolled(top > 0.5);
      if (large) setCollapsed(top >= 40);
    },
    [large],
  );

  // restore the scroll offset when a deep screen is re-mounted
  useLayoutEffect(() => {
    if (!scroller) return;
    const saved = readScroll(ctx.entryId);
    if (saved) {
      scroller.scrollTop = saved;
      update(scroller.scrollTop);
    }
  }, [scroller, ctx.entryId, update]);

  useEffect(() => {
    if (!large) setCollapsed(true);
  }, [large]);

  const handleScroll = (e: UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop;
    update(top);
    saveScroll(ctx.entryId, top);
    onScroll?.(e);
  };

  const handleChildScroll = (e: UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (!(target instanceof HTMLElement)) return;
    // only vertical scrollers that span the screen width count (not chip rows)
    if (target.scrollHeight <= target.clientHeight + 1) return;
    setScrolled(target.scrollTop > 0.5);
  };

  const barTop = 'var(--ios-safe-top, env(safe-area-inset-top, 0px))';
  const contentTop = `calc(${barTop} + ${44 + topH}px)`;
  const bottomInset = kb > 0 ? '0px' : 'calc(var(--ios-safe-bottom, env(safe-area-inset-bottom, 0px)) + var(--ios-floating-bar-h, 0px))';
  const rootStyle = {
    '--ios-content-top': contentTop,
    '--ios-content-bottom': bottomBar ? `${bottomH}px` : bottomInset,
    '--ios-keyboard-inset': `${kb}px`,
    ...(background ? { '--ios-screen-bg': background } : null),
  } as CSSProperties;

  const scrollerRef = useCallback(
    (el: HTMLDivElement | null) => {
      setScroller(el);
      assignRef(scrollRef, el);
    },
    [scrollRef],
  );

  const back = showBack ? <BackButton ariaLabel={t('back')} onPress={() => nav.pop()} /> : null;

  // Scroll-edge effect: inline titles show it as soon as content is under the bar; with a large
  // title the title itself is bar chrome (stays crisp) — the effect starts once it has collapsed.
  const edge = large ? scrolled && collapsed : scrolled;

  return (
    <div className="ios-screen" data-title-mode={titleMode} data-scrolled={edge ? 'true' : 'false'} style={rootStyle}>
      {scroll ? (
        <div
          className="ios-screen-scroller"
          style={{ bottom: kb }}
          ref={scrollerRef}
          onScroll={handleScroll}
        >
          <div className="ios-screen-content" ref={setContent} style={{ paddingTop: contentTop }} data-refreshing={refreshing || undefined}>
            {large && <div className="ios-screen-large-title" role="heading" aria-level={1}>{title}</div>}
            {inlineTopInset && <div className="ios-screen-topinset-inline">{topInset}</div>}
            <div style={contentStyle}>{children}</div>
            <div
              className="ios-screen-bottom-spacer"
              style={{ height: bottomBar ? `${bottomH + 35}px` : kb > 0 ? '35px' : `calc(${bottomInset} + 35px)` }}
            />
          </div>
        </div>
      ) : (
        <div
          className="ios-screen-fill"
          style={{ bottom: (bottomBar ? bottomH : 0) + kb, ...contentStyle }}
          ref={(el) => assignRef(scrollRef, el)}
          onScrollCapture={handleChildScroll}
          onScroll={onScroll}
        >
          {children}
        </div>
      )}
      {scroll && onRefresh && (
        <div className="ios-screen-ptr" ref={setIndicator} style={{ top: contentTop }} aria-hidden={!refreshing}>
          <Spinner size="regular" color="var(--ios-label-2)" />
        </div>
      )}
      <div className="ios-screen-edge" aria-hidden />
      {hasTopInset && !inlineTopInset && (
        <div className="ios-screen-topinset" ref={topRef}>
          {topInset}
        </div>
      )}
      <NavBar title={title} showTitle={!large || collapsed} leading={leading ?? back} trailing={trailing} />
      {bottomBar != null && bottomBar !== false && (
        <div
          className="ios-screen-bottombar"
          ref={bottomRef}
          style={
            {
              bottom: kb,
              '--ios-bottom-inset': bottomInset,
              ...(kb > 0 ? { '--ios-floating-bar-h': '0px' } : null),
            } as CSSProperties
          }
        >
          {bottomBar}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── SheetScreen ─────────────────────────────

export interface SheetScreenProps {
  /** Inline title of the sheet's own nav bar (56px sheet variant). */
  title?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** No nav bar at all (VoiceChannelView, Register). */
  noBar?: boolean;
  bottomBar?: ReactNode;
  scroll?: boolean;
  contentStyle?: CSSProperties;
  background?: string;
  scrollRef?: Ref<HTMLDivElement>;
  onScroll?: (e: UIEvent<HTMLDivElement>) => void;
  children?: ReactNode;
}

/** Sheet bar: 10px below the sheet top, 56 tall (items centred 38px below the top); content at 66. */
const SHEET_BAR_BOTTOM = 66;

export function SheetScreen({
  title,
  leading,
  trailing,
  noBar,
  bottomBar,
  scroll = true,
  contentStyle,
  background,
  scrollRef,
  onScroll,
  children,
}: SheetScreenProps) {
  const kb = useKeyboardInset();
  const [scrolled, setScrolled] = useState(false);
  const [bottomRef, bottomH] = useHeight();
  const top = noBar ? 0 : SHEET_BAR_BOTTOM;
  const bottomInset = kb > 0 ? '0px' : 'var(--ios-safe-bottom, env(safe-area-inset-bottom, 0px))';
  const rootStyle = {
    '--ios-content-top': `${top}px`,
    '--ios-content-bottom': bottomBar ? `${bottomH}px` : bottomInset,
    '--ios-keyboard-inset': `${kb}px`,
    '--ios-bar-top': '0px',
    ...(background ? { '--ios-screen-bg': background } : null),
  } as CSSProperties;

  return (
    <div className="ios-screen ios-sheet-screen" data-title-mode="inline" data-sheet="true" data-scrolled={scrolled ? 'true' : 'false'} style={rootStyle}>
      {scroll ? (
        <div
          className="ios-screen-scroller"
          style={{ bottom: kb }}
          ref={(el) => assignRef(scrollRef, el)}
          onScroll={(e) => {
            setScrolled(e.currentTarget.scrollTop > 0.5);
            onScroll?.(e);
          }}
        >
          <div className="ios-screen-content" style={{ paddingTop: top }}>
            <div style={contentStyle}>{children}</div>
            <div className="ios-screen-bottom-spacer" style={{ height: bottomBar ? `${bottomH + 16}px` : kb > 0 ? '16px' : `calc(${bottomInset} + 16px)` }} />
          </div>
        </div>
      ) : (
        <div
          className="ios-screen-fill"
          style={{ bottom: (bottomBar ? bottomH : 0) + kb, ...contentStyle }}
          ref={(el) => assignRef(scrollRef, el)}
          onScrollCapture={(e) => {
            const target = e.target as HTMLElement;
            if (target instanceof HTMLElement && target.scrollHeight > target.clientHeight + 1) setScrolled(target.scrollTop > 0.5);
          }}
          onScroll={onScroll}
        >
          {children}
        </div>
      )}
      {!noBar && (
        <>
          <div className="ios-screen-edge is-sheet" aria-hidden />
          <NavBar title={title} showTitle leading={leading} trailing={trailing} sheet />
        </>
      )}
      {bottomBar != null && bottomBar !== false && (
        <div className="ios-screen-bottombar" ref={bottomRef} style={{ bottom: kb, '--ios-bottom-inset': bottomInset } as CSSProperties}>
          {bottomBar}
        </div>
      )}
    </div>
  );
}
