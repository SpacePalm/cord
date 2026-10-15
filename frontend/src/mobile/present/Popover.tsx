// Small anchored glass popover with an arrow (emoji grid). Stays open until a tap
// outside (or ctx.dismiss()).
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LayerViewProps, PopoverLayer } from './PresentationProvider';
import { localFrame, placePopover, type Placement } from './anchor';
import { ARROW_H, PopoverArrow } from './Arrow';
import { reducedMotion, useInert } from './common';
import { useKeyboardInset } from '../ui/useKeyboardInset';

export function PopoverView({ layer, z, inert, setEl, api }: LayerViewProps<PopoverLayer>) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = useState<Placement | null>(null);
  const kb = useKeyboardInset();
  const content = useMemo(() => layer.render(layer.ctx), [layer]);
  useInert(rootRef, inert);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const { rect: r, vw, vh } = localFrame(layer.rect, rootRef.current, kb);
    const w = wrap.offsetWidth;
    const h = wrap.offsetHeight;
    // prefer the side with more room (composer buttons at the bottom → above)
    const prefer = r.top + r.height / 2 > vh / 2 ? 'above' : 'below';
    setPlace(placePopover(r, w, h, vw, vh, { arrowH: ARROW_H, prefer, tipAbove: r.top - 4, tipBelow: r.bottom + 4, margin: 8 }));
  }, [layer.rect, kb]);

  const animated = useRef(false);
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !place || animated.current) return;
    animated.current = true;
    if (reducedMotion()) wrap.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150 });
    else
      wrap.animate([{ transform: 'scale(0.5)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], {
        duration: 320,
        easing: 'cubic-bezier(0.2, 0.9, 0.25, 1)',
      });
  }, [place]);

  useLayoutEffect(() => {
    if (!layer.closing) return;
    wrapRef.current?.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.9)' }], {
      duration: 200,
      easing: 'ease-out',
      fill: 'forwards',
    });
  }, [layer.closing]);

  return (
    <div
      className="ios-popover-layer"
      style={{ zIndex: z }}
      ref={(el) => {
        rootRef.current = el;
        setEl(layer.id, el);
      }}
    >
      <div
        className="ios-popover-backdrop"
        onPointerDown={(e) => {
          e.preventDefault();
          api.cancel(layer.id);
        }}
      />
      <div
        className="ios-popover-wrap"
        ref={wrapRef}
        role="dialog"
        style={{
          left: place?.left ?? 0,
          top: place?.top ?? 0,
          visibility: place ? 'visible' : 'hidden',
          transformOrigin: place?.origin,
        }}
      >
        <div className="ios-popover-panel ios-pr-panel">{content}</div>
        {place?.arrow && <PopoverArrow side={place.arrow.side} x={place.arrow.x} />}
      </div>
    </div>
  );
}
