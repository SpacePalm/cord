// iOS 26 glass alert (+ optional text field).
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AlertAction, AlertLayer, LayerViewProps } from './PresentationProvider';
import { useKeyboardInset } from '../ui/useKeyboardInset';
import { reducedMotion, useInert } from './common';

const FONT = '400 17px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", Roboto, sans-serif';
let canvas: HTMLCanvasElement | null = null;
function textWidth(s: string): number {
  canvas ??= document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return s.length * 9;
  ctx.font = FONT;
  return ctx.measureText(s).width;
}

function panelWidth(): number {
  return Math.min(318, window.innerWidth - 84);
}

export function AlertView({ layer, z, inert, setEl, api }: LayerViewProps<AlertLayer>) {
  const { opts } = layer;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dimRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const kb = useKeyboardInset();
  const [value, setValue] = useState(opts.textField?.initial ?? '');
  const valueRef = useRef(value);
  valueRef.current = value;
  useInert(rootRef, inert);

  const { buttons, row } = useMemo(() => {
    const acts = opts.actions.length ? opts.actions : [{ label: 'OK', role: 'cancel' as const }];
    const cancel = acts.filter((a) => a.role === 'cancel');
    const rest = acts.filter((a) => a.role !== 'cancel');
    const W = panelWidth();
    const half = (W - 28 - 12) / 2;
    const sideBySide = acts.length === 2 && acts.every((a) => textWidth(a.label) + 32 <= half);
    return { buttons: sideBySide ? [...cancel, ...rest] : [...rest, ...cancel], row: sideBySide };
  }, [opts.actions]);

  // in / out animation + focus
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (!reducedMotion()) {
      panel.animate([{ transform: 'scale(1.12)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], {
        duration: 250,
        easing: 'cubic-bezier(0.2, 0.9, 0.25, 1)',
      });
    } else panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    dimRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: 'ease-out' });
    if (inputRef.current) {
      inputRef.current.focus({ preventScroll: true });
      const n = inputRef.current.value.length;
      try {
        inputRef.current.setSelectionRange(n, n);
      } catch {
        /* ignore */
      }
    } else panel.focus({ preventScroll: true });
  }, []);

  useLayoutEffect(() => {
    if (!layer.closing) return;
    const o: KeyframeAnimationOptions = { duration: 150, easing: 'ease-out', fill: 'forwards' };
    panelRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], o);
    dimRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], o);
    inputRef.current?.blur();
  }, [layer.closing]);

  const press = (a: AlertAction) => {
    if (layer.closing) return;
    void api.close(layer.id);
    try {
      a.onPress?.(valueRef.current);
    } catch (e) {
      console.error(e);
    }
  };

  const primary = buttons.find((b) => b.role !== 'cancel');
  const tf = opts.textField;

  return (
    <div
      className="ios-alert-layer"
      style={{ zIndex: z, bottom: kb }}
      ref={(el) => {
        rootRef.current = el;
        setEl(layer.id, el);
      }}
    >
      <div className="ios-alert-dim" ref={dimRef} />
      <div
        className="ios-alert"
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-label={opts.title}
        tabIndex={-1}
        style={{ width: panelWidth() }}
      >
        <div className={`ios-alert-title${tf ? ' has-field' : ''}`}>{opts.title}</div>
        {opts.message && <div className="ios-alert-message">{opts.message}</div>}
        {tf && (
          <input
            ref={inputRef}
            className="ios-alert-field"
            type={tf.secure ? 'password' : tf.inputMode === 'email' ? 'email' : 'text'}
            inputMode={tf.inputMode === 'numeric' ? 'numeric' : tf.inputMode === 'email' ? 'email' : 'text'}
            placeholder={tf.placeholder}
            maxLength={tf.maxLength}
            value={value}
            autoComplete="off"
            autoCapitalize="sentences"
            enterKeyHint="done"
            onChange={(e) => setValue(tf.maxLength ? e.target.value.slice(0, tf.maxLength) : e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && primary) {
                e.preventDefault();
                press(primary);
              }
            }}
          />
        )}
        <div className={`ios-alert-actions${row ? ' is-row' : ''}`}>
          {buttons.map((a, i) => (
            <button
              key={`${i}:${a.label}`}
              type="button"
              className={`ios-alert-btn${a.role === 'destructive' ? ' is-destructive' : ''}${a.role === 'cancel' ? ' is-cancel' : ''}`}
              onClick={() => press(a)}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
