// iOS 26 navigation bar (no background, glass items, inline title with the collision rule).
// Used by Screen (44px bar under the status bar) and SheetScreen (56px sheet bar, 10px below the
// sheet top).
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export interface NavBarProps {
  title?: string;
  /** Inline title visible (false while a large title is shown). */
  showTitle: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  sheet?: boolean;
}

interface TitleLayout {
  left: number;
  width: number;
  centered: boolean;
}

const EDGE = 16;
const GAP_CENTER = 16; // min distance of a centred title to a group
const GAP_LEADING = 12; // leading-aligned title: distance after the leading group / before trailing

export function NavBar({ title, showTitle, leading, trailing, sheet }: NavBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const leadRef = useRef<HTMLDivElement>(null);
  const trailRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [layout, setLayout] = useState<TitleLayout | null>(null);

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const compute = () => {
      const B = bar.clientWidth;
      if (!B) return;
      const lw = leadRef.current && leadRef.current.childElementCount ? leadRef.current.offsetWidth : 0;
      const tw = trailRef.current && trailRef.current.childElementCount ? trailRef.current.offsetWidth : 0;
      const W = Math.ceil(measureRef.current?.offsetWidth ?? 0);
      const leadRight = lw ? EDGE + lw : 0;
      const trailLeft = tw ? B - EDGE - tw : B;
      const x0 = (B - W) / 2;
      const x1 = x0 + W;
      const fitsCentered = x0 >= (lw ? leadRight + GAP_CENTER : EDGE) && x1 <= (tw ? trailLeft - GAP_CENTER : B - EDGE);
      let next: TitleLayout;
      if (fitsCentered) next = { left: x0, width: W, centered: true };
      else {
        const left = lw ? leadRight + GAP_LEADING : EDGE;
        const right = tw ? trailLeft - GAP_LEADING : B - EDGE;
        next = { left, width: Math.max(0, Math.min(W, right - left)), centered: false };
      }
      setLayout((prev) =>
        prev && Math.abs(prev.left - next.left) < 0.5 && Math.abs(prev.width - next.width) < 0.5 && prev.centered === next.centered
          ? prev
          : next,
      );
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(bar);
    if (leadRef.current) ro.observe(leadRef.current);
    if (trailRef.current) ro.observe(trailRef.current);
    if (measureRef.current) ro.observe(measureRef.current);
    return () => ro.disconnect();
  }, [title]);

  return (
    <div className={`ios-nav-bar${sheet ? ' is-sheet' : ''}`} ref={barRef}>
      <div className="ios-nav-bar-side is-leading" ref={leadRef}>
        {leading}
      </div>
      {title ? (
        <>
          <span className="ios-nav-title-measure" ref={measureRef} aria-hidden>
            {title}
          </span>
          <div
            className={`ios-nav-title${showTitle && layout ? '' : ' is-hidden'}`}
            role="heading"
            aria-level={1}
            style={layout ? { left: layout.left, width: layout.width + 1 } : { left: 0, right: 0, justifyContent: 'center' }}
          >
            <span>{title}</span>
          </div>
        </>
      ) : null}
      <div className="ios-nav-bar-side is-trailing" ref={trailRef}>
        {trailing}
      </div>
    </div>
  );
}
