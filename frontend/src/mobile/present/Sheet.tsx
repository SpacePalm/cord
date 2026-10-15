// Sheets (large / partial detents, nested, card stack, drag-to-dismiss) and full-screen covers.
import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import type { Detent, FullLayer, LayerViewProps, SheetLayer } from './PresentationProvider';
import { attachDrag, isTextInput, scrollParentWithin } from '../nav/gesture';
import { DUR_SHEET_IN, DUR_SHEET_OUT, EASE_NAV, EASE_SPRING } from '../nav/env';
import { clamp, reducedMotion, useInert, useInitialFocus } from './common';

const OFF = '0 calc(100% + 24px)';

function frameGeometry(d: Detent): CSSProperties {
  if (d === 'large') return { top: 'var(--ios-sheet-top)', left: 0, right: 0, bottom: 0 };
  if (d === 'medium') return { top: '50%', left: 8, right: 8, bottom: 8 };
  return { top: `calc(100% - ${d.height + 8}px)`, left: 8, right: 8, bottom: 8 };
}

export function SheetView({
  layer,
  z,
  inert,
  setEl,
  api,
  receded,
  recedeDur,
}: LayerViewProps<SheetLayer> & { receded: boolean; recedeDur: string }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const dimRef = useRef<HTMLDivElement | null>(null);
  const detent = layer.detents[layer.detent] ?? 'large';
  const large = detent === 'large';
  const multi = layer.detents.length > 1;
  const content = useMemo(() => layer.render(layer.ctx), [layer]);
  const layerRef = useRef(layer);
  layerRef.current = layer;

  useInert(rootRef, inert);
  useInitialFocus(cardRef);

  // enter
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    if (reducedMotion()) {
      frame.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
    } else {
      frame.animate([{ translate: OFF }, { translate: '0 0' }], { duration: DUR_SHEET_IN, easing: EASE_NAV });
    }
    dimRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' });
  }, []);

  // exit
  useLayoutEffect(() => {
    if (!layer.closing) return;
    const frame = frameRef.current;
    if (!frame) return;
    const from = getComputedStyle(frame).translate;
    frame.style.translate = '';
    if (reducedMotion()) {
      frame.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-out', fill: 'forwards' });
    } else {
      frame.animate([{ translate: from && from !== 'none' ? from : '0 0' }, { translate: OFF }], {
        duration: DUR_SHEET_OUT,
        easing: EASE_NAV,
        fill: 'forwards',
      });
    }
    dimRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DUR_SHEET_OUT, easing: 'ease-out', fill: 'forwards' });
  }, [layer.closing]);

  // drag to dismiss / between detents
  useEffect(() => {
    const frame = frameRef.current;
    const card = cardRef.current;
    if (!frame || !card) return;
    let scroller: HTMLElement | null = null;
    let H = 0;
    let lower: HTMLElement | null = null;
    const springBack = () => {
      const cur = frame.style.translate || '0 0';
      frame.style.translate = '';
      frame.animate([{ translate: cur }, { translate: '0 0' }], { duration: 380, easing: EASE_SPRING });
    };
    const shadeOf = (l: HTMLElement) => l.querySelector<HTMLElement>(':scope > .ios-recede-shade');
    const releaseLower = (toZero: boolean) => {
      const l = lower;
      lower = null;
      if (!l) return;
      l.style.transition = '';
      const sh = shadeOf(l);
      if (sh) sh.style.transition = '';
      if (toZero) {
        l.style.setProperty('--recede', '0');
        window.setTimeout(() => l.style.removeProperty('--recede'), 450);
      } else l.style.removeProperty('--recede');
    };
    return attachDrag(frame, {
      begin: ({ target, mouse }) => {
        const L = layerRef.current;
        if (L.closing) return false;
        if (mouse && isTextInput(target)) return false;
        if (target instanceof Element && target.closest('input[type="range"], [data-no-sheet-drag]')) return false;
        scroller = scrollParentWithin(target, card);
        H = frame.offsetHeight || window.innerHeight;
        return true;
      },
      decide: (dx, dy) => {
        if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) + 4) return 'reject';
        const L = layerRef.current;
        const atTop = !scroller || scroller.scrollTop <= 0;
        // claim on the first downward move at the top (before the native scroll/bounce starts); an exact
        // diagonal stays undecided (it may be the start of a row swipe inside the sheet)
        if (dy > 0 && dy > Math.abs(dx)) return atTop ? 'claim' : 'reject';
        if (dy < -4) return atTop && L.detent < L.detents.length - 1 ? 'claim' : 'reject';
        return undefined;
      },
      move: (_dx, dy) => {
        const L = layerRef.current;
        let y = dy;
        if (y < 0) y = -Math.pow(-y, 0.72);
        else if (!L.dismissible && L.detent === 0) y = Math.pow(y, 0.75);
        frame.style.translate = `0 ${y}px`;
        if ((L.detents[L.detent] ?? 'large') === 'large') {
          if (!lower) lower = api.lowerEl(L.id);
          if (lower) {
            lower.style.transition = 'none';
            // the darkening shade follows the finger too (it has its own transition)
            const sh = shadeOf(lower);
            if (sh) sh.style.transition = 'none';
            lower.style.setProperty('--recede', String(1 - clamp(y / H, 0, 1)));
          }
        }
      },
      end: ({ dy, vy, cancelled }) => {
        const L = layerRef.current;
        if (!cancelled && dy > 0 && (dy > 0.25 * H || vy > 0.6)) {
          if (L.detent > 0) {
            releaseLower(false);
            api.setDetent(L.id, L.detent - 1);
            springBack();
            return;
          }
          if (L.dismissible) {
            releaseLower(true);
            api.cancel(L.id);
            return;
          }
        } else if (!cancelled && dy < 0 && (dy < -50 || vy < -0.5) && L.detent < L.detents.length - 1) {
          releaseLower(false);
          api.setDetent(L.id, L.detent + 1);
          springBack();
          return;
        }
        releaseLower(false);
        springBack();
      },
    });
  }, [api]);

  return (
    <div
      className="ios-sheet-layer"
      style={{ zIndex: z }}
      ref={(el) => {
        rootRef.current = el;
        setEl(layer.id, el);
      }}
    >
      {!large && (
        <div
          className="ios-sheet-dim"
          ref={dimRef}
          onClick={() => {
            if (!layer.closing) api.cancel(layer.id);
          }}
        />
      )}
      <div
        className={`ios-sheet-frame${large ? ' is-large' : ' is-partial'}`}
        ref={frameRef}
        style={frameGeometry(detent)}
        role="dialog"
        aria-modal="true"
      >
        <div
          className="ios-sheet-card"
          ref={cardRef}
          tabIndex={-1}
          data-receded={receded ? 'true' : 'false'}
          style={{ '--ios-recede-dur': recedeDur } as CSSProperties}
        >
          {content}
          {multi && <div className="ios-sheet-grabber" aria-hidden />}
          <div className="ios-recede-shade" aria-hidden />
        </div>
      </div>
    </div>
  );
}

export function FullScreenView({ layer, z, inert, setEl }: LayerViewProps<FullLayer>) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const content = useMemo(() => layer.render(layer.ctx), [layer]);
  useInert(rootRef, inert);
  useInitialFocus(rootRef);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (reducedMotion()) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
    else el.animate([{ translate: '0 100%' }, { translate: '0 0' }], { duration: DUR_SHEET_IN, easing: EASE_NAV });
  }, []);

  useLayoutEffect(() => {
    if (!layer.closing) return;
    const el = rootRef.current;
    if (!el) return;
    if (reducedMotion()) el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-out', fill: 'forwards' });
    else el.animate([{ translate: '0 0' }, { translate: '0 100%' }], { duration: DUR_SHEET_OUT, easing: EASE_NAV, fill: 'forwards' });
  }, [layer.closing]);

  return (
    <div
      className="ios-fullscreen"
      style={{ zIndex: z }}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      ref={(el) => {
        rootRef.current = el;
        setEl(layer.id, el);
      }}
    >
      {content}
    </div>
  );
}
