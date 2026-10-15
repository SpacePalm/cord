// Positioning for anchored panels (Menu, confirmation popover, arrow popover).
import { clamp, safeAreaTop } from './common';

export interface Placement {
  left: number;
  top: number;
  maxHeight?: number;
  /** transform-origin for the scale-in animation */
  origin: string;
  /** popovers: which side the arrow is on + its x within the panel */
  arrow?: { side: 'top' | 'bottom'; x: number };
}

/**
 * Anchor rect (viewport coordinates, from getBoundingClientRect) → coordinates of the layer `host`
 * (absolute, inset 0 inside `.ios-root`) + the host's visible size above the keyboard. Usually the
 * identity; differs while iOS Safari pans the visual viewport for a focused input (MobileRoot then
 * shifts `.ios-root` down by `--ios-vv-top`), where viewport coordinates would misplace the panel.
 */
export function localFrame(rect: DOMRect, host: HTMLElement | null, kbInset: number): { rect: DOMRect; vw: number; vh: number } {
  const h = host?.getBoundingClientRect();
  const ox = h ? h.left : 0;
  const oy = h ? h.top : 0;
  const vw = h && h.width ? h.width : window.innerWidth;
  const fullH = h && h.height ? h.height : window.innerHeight;
  return { rect: new DOMRect(rect.left - ox, rect.top - oy, rect.width, rect.height), vw, vh: Math.max(0, fullH - kbInset) };
}

/**
 * iOS 26 Menu: the panel's top-right corner sits on the source's top-right corner (sources in the
 * left half: top-left on top-left). Flips upward when there is no room below.
 */
export function placeMenu(rect: DOMRect, w: number, h: number, vw: number, vh: number): Placement {
  const margin = 8;
  const rightAligned = rect.left + rect.width / 2 > vw / 2;
  let left = rightAligned ? rect.right - w : rect.left;
  left = clamp(left, margin, Math.max(margin, vw - margin - w));
  const minTop = Math.max(0, safeAreaTop());
  let top = rect.top;
  let fromBottom = false;
  if (top + h > vh - margin) {
    // flip upward: bottom edge on the source's bottom edge
    const up = rect.bottom - h;
    if (up >= minTop) {
      top = up;
      fromBottom = true;
    } else {
      top = Math.max(minTop, vh - margin - h);
    }
  }
  top = Math.max(minTop, top);
  const maxHeight = vh - margin - top;
  return {
    left,
    top,
    maxHeight: h > maxHeight ? maxHeight : undefined,
    origin: `${rightAligned ? 'right' : 'left'} ${fromBottom ? 'bottom' : 'top'}`,
  };
}

/**
 * Arrow popover pointing at `tipY` (y of the arrow tip) above or below. Prefers `prefer` when it fits.
 */
export function placePopover(
  rect: DOMRect,
  w: number,
  h: number,
  vw: number,
  vh: number,
  opts: { arrowH: number; prefer: 'above' | 'below'; tipAbove: number; tipBelow: number; margin?: number },
): Placement {
  const margin = opts.margin ?? 12;
  const cx = rect.left + rect.width / 2;
  const left = clamp(cx - w / 2, margin, Math.max(margin, vw - margin - w));
  const minTop = Math.max(margin, safeAreaTop() + 4);
  const aboveTop = opts.tipAbove - opts.arrowH - h;
  const belowTop = opts.tipBelow + opts.arrowH;
  const fitsAbove = aboveTop >= minTop;
  const fitsBelow = belowTop + h <= vh - margin;
  let side: 'above' | 'below' = opts.prefer;
  if (side === 'above' && !fitsAbove && fitsBelow) side = 'below';
  if (side === 'below' && !fitsBelow && fitsAbove) side = 'above';
  let top = side === 'above' ? aboveTop : belowTop;
  top = clamp(top, minTop, Math.max(minTop, vh - margin - h));
  const ax = clamp(cx - left, 28, w - 28);
  return {
    left,
    top,
    origin: `${ax}px ${side === 'above' ? '100%' : '0%'}`,
    arrow: { side: side === 'above' ? 'bottom' : 'top', x: ax },
  };
}
