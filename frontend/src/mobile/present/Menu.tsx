// iOS 26 glass Menu: ≈250px panel anchored by its top-right corner to the trigger (flips), leading
// tinted icons, destructive red, picker checkmarks, dividers, text-only items, morph-like scale-in.
import { useLayoutEffect, useRef, useState } from 'react';
import type { LayerViewProps, MenuItem, MenuLayer } from './PresentationProvider';
import { localFrame, placeMenu, type Placement } from './anchor';
import { reducedMotion, useInert } from './common';
import { Icon } from '../ui/Icon';
import { useKeyboardInset } from '../ui/useKeyboardInset';

/** Measured 248–248.6 on iOS 26; with the 26.5px trailing inset this reproduces iOS line wraps. */
const WIDTH = 249;

type Item = Exclude<MenuItem, 'divider'>;

export function MenuView({ layer, z, inert, setEl, api }: LayerViewProps<MenuLayer>) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dimRef = useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = useState<Placement | null>(null);
  const kb = useKeyboardInset();
  useInert(rootRef, inert);

  const items = layer.items;
  const hasIconCol = items.some((i) => i !== 'divider' && (i.icon || i.checked !== undefined));

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const { rect, vw, vh } = localFrame(layer.rect, rootRef.current, kb);
    setPlace(placeMenu(rect, Math.min(WIDTH, vw - 16), panel.scrollHeight, vw, vh));
  }, [layer.rect, kb]);

  const animated = useRef(false);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !place || animated.current) return;
    animated.current = true;
    if (reducedMotion()) panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150 });
    else
      panel.animate(
        [
          { transform: 'scale(0.4)', opacity: 0, filter: 'blur(6px)' },
          { transform: 'scale(1.02)', opacity: 1, filter: 'blur(0px)', offset: 0.7 },
          { transform: 'scale(1)', opacity: 1, filter: 'blur(0px)' },
        ],
        { duration: 350, easing: 'cubic-bezier(0.2, 0.9, 0.25, 1)' },
      );
    dimRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
  }, [place]);

  useLayoutEffect(() => {
    if (!layer.closing) return;
    const o: KeyframeAnimationOptions = { duration: 200, easing: 'ease-out', fill: 'forwards' };
    panelRef.current?.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0.85)', opacity: 0 }], o);
    dimRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], o);
  }, [layer.closing]);

  const select = (it: Item) => {
    if (layer.closing || it.disabled) return;
    void api.close(layer.id);
    try {
      it.onSelect();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div
      className="ios-menu-layer"
      style={{ zIndex: z }}
      ref={(el) => {
        rootRef.current = el;
        setEl(layer.id, el);
      }}
    >
      <div
        className="ios-menu-dim"
        ref={dimRef}
        onPointerDown={(e) => {
          e.preventDefault();
          api.cancel(layer.id);
        }}
      />
      <div
        className="ios-menu ios-pr-panel"
        ref={panelRef}
        role="menu"
        style={{
          width: Math.min(WIDTH, window.innerWidth - 16),
          left: place?.left ?? 0,
          top: place?.top ?? 0,
          maxHeight: place?.maxHeight,
          visibility: place ? 'visible' : 'hidden',
          transformOrigin: place?.origin,
        }}
      >
        {items.map((it, i) =>
          it === 'divider' ? (
            <div key={`d${i}`} className="ios-menu-divider" role="separator" />
          ) : (
            <button
              key={`${i}:${it.label}`}
              type="button"
              role={it.checked !== undefined ? 'menuitemradio' : 'menuitem'}
              aria-checked={it.checked !== undefined ? !!it.checked : undefined}
              className={`ios-menu-item${it.role === 'destructive' ? ' is-destructive' : ''}${hasIconCol ? '' : ' no-icon'}`}
              disabled={it.disabled}
              onClick={() => select(it)}
            >
              {hasIconCol && (
                // glyphs at 20: ink 16.5×18 ≈ iOS (plus.square 15.7, paperclip 16.2×18.3, bell 15.7×17.5)
                <span className="ios-menu-icon" aria-hidden>
                  {it.checked ? <Icon name="checkmark" size={18} color="var(--ios-label)" /> : it.icon ? <Icon name={it.icon} size={20} /> : null}
                </span>
              )}
              <span className="ios-menu-label">{it.label}</span>
            </button>
          ),
        )}
      </div>
    </div>
  );
}
