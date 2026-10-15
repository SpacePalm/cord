// iOS 26 confirmationDialog: anchored glass popover with an arrow and no Cancel button (tap outside
// cancels); without an anchor → bottom glass panel + separate Cancel capsule.
import { useLayoutEffect, useRef, useState } from 'react';
import type { ConfirmAction, ConfirmLayer, LayerViewProps } from './PresentationProvider';
import { localFrame, placePopover, type Placement } from './anchor';
import { ARROW_H, PopoverArrow } from './Arrow';
import { reducedMotion, useInert, useInitialFocus } from './common';
import { useKeyboardInset } from '../ui/useKeyboardInset';
import { useMT } from '../i18n';

const WIDTH = 238;

export function ConfirmView({ layer, z, inert, setEl, api }: LayerViewProps<ConfirmLayer>) {
  const t = useMT();
  const { opts, rect } = layer;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dimRef = useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = useState<Placement | null>(null);
  const kb = useKeyboardInset();
  const anchored = !!rect;
  useInert(rootRef, inert);
  useInitialFocus(wrapRef);

  const actions = opts.actions.filter((a) => a.role !== 'cancel');
  const cancel = opts.actions.find((a) => a.role === 'cancel');

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    if (anchored && rect) {
      const h = wrap.offsetHeight;
      const { rect: r, vw, vh } = localFrame(rect, rootRef.current, kb);
      setPlace(
        placePopover(r, WIDTH, h, vw, vh, {
          arrowH: ARROW_H,
          prefer: 'above',
          tipAbove: r.top + r.height * 0.75,
          tipBelow: r.top + r.height * 0.25,
          margin: 16,
        }),
      );
    }
  }, [anchored, rect, kb]);

  // in-animation once positioned
  const animated = useRef(false);
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || animated.current || (anchored && !place)) return;
    animated.current = true;
    if (reducedMotion()) wrap.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    else if (anchored)
      wrap.animate([{ transform: 'scale(0.6)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], {
        duration: 320,
        easing: 'cubic-bezier(0.2, 0.9, 0.25, 1)',
      });
    else wrap.animate([{ translate: '0 100%', opacity: 0.6 }, { translate: '0 0', opacity: 1 }], { duration: 400, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' });
    dimRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250 });
  }, [anchored, place]);

  useLayoutEffect(() => {
    if (!layer.closing) return;
    const o: KeyframeAnimationOptions = { duration: 200, easing: 'ease-out', fill: 'forwards' };
    if (anchored || reducedMotion()) wrapRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], o);
    else wrapRef.current?.animate([{ translate: '0 0' }, { translate: '0 100%' }], { ...o, easing: 'ease-in' });
    dimRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], o);
  }, [layer.closing, anchored]);

  const press = (a: ConfirmAction) => {
    if (layer.closing) return;
    void api.close(layer.id);
    try {
      a.onPress?.();
    } catch (e) {
      console.error(e);
    }
  };

  const body = (
    <div className="ios-confirm-panel ios-pr-panel">
      {(opts.title || opts.message) && (
        <div className="ios-confirm-text">
          {opts.title && <div className="ios-confirm-title">{opts.title}</div>}
          {opts.message && (
            <div className="ios-confirm-message" lang={document.documentElement.lang || 'ru'}>
              {opts.message}
            </div>
          )}
        </div>
      )}
      <div className="ios-confirm-actions">
        {actions.map((a, i) => (
          <button
            key={`${i}:${a.label}`}
            type="button"
            className={`ios-pr-pill${a.role === 'destructive' ? ' is-destructive' : ''}`}
            onClick={() => press(a)}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div
      className={`ios-confirm-layer${anchored ? ' is-anchored' : ' is-sheet'}`}
      style={{ zIndex: z, bottom: anchored ? 0 : kb }}
      ref={(el) => {
        rootRef.current = el;
        setEl(layer.id, el);
      }}
    >
      <div
        className="ios-confirm-backdrop"
        ref={dimRef}
        onPointerDown={(e) => {
          e.preventDefault();
          api.cancel(layer.id);
        }}
      />
      {anchored ? (
        <div
          className="ios-popover-wrap"
          ref={wrapRef}
          role="alertdialog"
          aria-modal="true"
          tabIndex={-1}
          style={{
            width: WIDTH,
            left: place?.left ?? 0,
            top: place?.top ?? 0,
            visibility: place ? 'visible' : 'hidden',
            transformOrigin: place?.origin,
          }}
        >
          {body}
          {place?.arrow && <PopoverArrow side={place.arrow.side} x={place.arrow.x} />}
        </div>
      ) : (
        <div className="ios-confirm-sheet" ref={wrapRef} role="alertdialog" aria-modal="true" tabIndex={-1}>
          {body}
          <button type="button" className="ios-pr-pill ios-confirm-cancel ios-pr-panel" onClick={() => api.cancel(layer.id)}>
            {cancel?.label ?? t('common.cancel')}
          </button>
        </div>
      )}
    </div>
  );
}
