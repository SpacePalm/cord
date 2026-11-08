// The iOS root container: `.ios-root` scope, the
// PresentationProvider (sheets/alerts/menus portal INSIDE .ios-root) and theme bridges —
// data-scheme for light palettes, <meta theme-color> and body background follow
// --bg-primary while mounted. Used by MobileApp and by the standalone mobile pages
// (login / invite / blocked).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import './ios.css';
import { PresentationProvider } from './present/PresentationProvider';
import { useThemeStore } from '../store/themeStore';
import { isMobileNow } from '../hooks/useIsMobile';

/** Parse a CSS colour (hex / rgb[a]) into 0–255 channels. */
function parseColor(input: string): [number, number, number] | null {
  const s = input.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function readBgPrimary(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim() || '#111113';
}

/**
 * Add / remove `viewport-fit=cover`, touching the meta only when the value really changes.
 * Every change makes iOS re-inset the page; in a home-screen web app that leaves the page
 * scrolled by the status-bar height, so taps land below what is drawn (see the effect below).
 */
function setViewportFit(cover: boolean) {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) return;
  const current = meta.getAttribute('content') ?? '';
  const parts = current
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && !/^viewport-fit\s*=/.test(s));
  if (cover) parts.push('viewport-fit=cover');
  const next = parts.join(', ');
  if (next !== current) meta.setAttribute('content', next);
}

// Ref-counted: two roots may overlap (a page hand-off). index.html already turns cover on before
// the first layout on phone widths, so normally this changes nothing. Cover stays on while the
// width is still mobile (a page hand-off, or a lazy chunk loading in between) and goes away only
// when the desktop layout takes over (e.g. a phone rotated to landscape).
let fitUsers = 0;
function acquireViewportFit(): () => void {
  if (fitUsers++ === 0) setViewportFit(true);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--fitUsers > 0) return;
    if (!isMobileNow()) setViewportFit(false);
  };
}

export interface MobileRootProps {
  children?: ReactNode;
  /**
   * Global overlays rendered outside the card-stack base, in the same stacking context as the
   * presentation layers (InAppBanner z 500 above sheets, floating voice bar z 50 below them).
   */
  overlays?: ReactNode;
}

export function MobileRoot({ children, overlays }: MobileRootProps) {
  const [scheme, setScheme] = useState<'light' | 'dark'>('dark');
  const rootRef = useRef<HTMLDivElement | null>(null);

  // iOS Safari pans the visual viewport (offsetTop > 0) to reveal a focused input instead of resizing
  // the layout viewport, which would push the nav bar off-screen. Keep the shell's top edge on the
  // visible top; the bottom stays put — bottom bars already lift by useKeyboardInset(), which subtracts
  // offsetTop, so both edges match the visible area.
  useEffect(() => {
    const vv = window.visualViewport;
    const el = rootRef.current;
    if (!vv || !el) return;
    let raf = 0;
    const apply = () => {
      const off = vv.scale > 1.01 ? 0 : Math.max(0, Math.round(vv.offsetTop));
      el.style.setProperty('--ios-vv-top', `${off}px`);
    };
    const sync = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(apply);
    };
    apply();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      el.style.removeProperty('--ios-vv-top');
    };
  }, []);

  // When viewport-fit changes at runtime (e.g. rotating back from the desktop layout), an iOS
  // home-screen web app can keep the old status-bar inset as a negative document scroll: the page
  // is drawn in place, but taps land one status-bar height lower until the keyboard next opens.
  // html/body are fixed, so the document never scrolls above 0 legitimately — snap it back.
  useEffect(() => {
    const vv = window.visualViewport;
    let raf = 0;
    const check = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (window.scrollY < 0 || window.scrollX < 0) window.scrollTo(0, 0);
      });
    };
    check();
    window.addEventListener('resize', check);
    window.addEventListener('scroll', check);
    vv?.addEventListener('resize', check);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', check);
      window.removeEventListener('scroll', check);
      vv?.removeEventListener('resize', check);
    };
  }, []);

  // body background → --bg-primary while mounted (index.css paints it --bg-tertiary)
  useLayoutEffect(() => {
    const body = document.body;
    const prev = body.style.background;
    body.style.background = 'var(--bg-primary)';
    return () => {
      body.style.background = prev;
    };
  }, []);

  // viewport-fit=cover only while the iOS shell is mounted: it draws its own safe-area insets
  // (env(safe-area-inset-*)); the desktop layout (e.g. a phone in landscape) must stay inside them.
  useLayoutEffect(() => acquireViewportFit(), []);

  // theme-color meta + data-scheme follow the palette
  useEffect(() => {
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    let created = false;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
      created = true;
    }
    const original = meta.content;
    let raf = 0;
    const sync = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const bg = readBgPrimary();
        if (meta) meta.content = bg;
        const rgb = parseColor(bg);
        setScheme(rgb && luminance(rgb) > 0.4 ? 'light' : 'dark');
      });
    };
    sync();
    const unsub = useThemeStore.subscribe(sync);
    return () => {
      unsub();
      cancelAnimationFrame(raf);
      if (created) meta?.remove();
      else if (meta) meta.content = original;
    };
  }, []);

  return (
    <div
      className="ios-root"
      ref={rootRef}
      data-scheme={scheme}
      style={{ position: 'fixed', top: 'var(--ios-vv-top, 0px)', left: 0, right: 0, bottom: 0, background: 'var(--bg-primary)', overflow: 'hidden' }}
    >
      <PresentationProvider overlays={overlays}>{children}</PresentationProvider>
    </div>
  );
}
