// HUD: `ProgressView().padding(20).background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))`
// centred over the presenting view (ForwardPicker "sending").
import './ui.css';
import type { ReactNode } from 'react';
import { Spinner } from './Spinner';

/** Centered material box (ProgressView().padding(20).background(.ultraThinMaterial, r12)). */
export function HUD({ children, fixed }: { children?: ReactNode; /** cover the viewport instead of the positioned parent */ fixed?: boolean }) {
  return (
    <div className={fixed ? 'ios-hud-layer is-fixed' : 'ios-hud-layer'} role="status" aria-live="polite">
      <div className="ios-hud">{children ?? <Spinner />}</div>
    </div>
  );
}
