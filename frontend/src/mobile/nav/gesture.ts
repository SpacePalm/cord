// Minimal drag recogniser shared by edge-swipe-back, pull-to-refresh and sheet drag-to-dismiss.
// Touch input uses touch events (non-passive touchmove so a claimed drag can preventDefault the
// native scroll); mouse input uses pointer events (desktop testing / narrow desktop windows).
// Only one recogniser can own a gesture at a time.

export interface DragBegin {
  x: number;
  y: number;
  target: EventTarget | null;
  mouse: boolean;
}

export interface DragEnd {
  dx: number;
  dy: number;
  /** px/ms */
  vx: number;
  vy: number;
  cancelled: boolean;
}

export interface DragSpec {
  /** May this press start the gesture? */
  begin(e: DragBegin): boolean;
  /** While undecided: 'claim' to take over, 'reject' to give up, undefined to wait. */
  decide(dx: number, dy: number): 'claim' | 'reject' | undefined;
  move(dx: number, dy: number): void;
  end(e: DragEnd): void;
}

let owner: object | null = null;
let suppressClickUntil = 0;

/**
 * Arbitration for recognisers that do not use attachDrag (SwipeRow's pointer tracking): claiming makes
 * every attachDrag recogniser drop the current gesture on its next move (a claimed drag ends cancelled).
 */
export function claimGesture(token: object): void {
  owner = token;
}
export function releaseGesture(token: object): void {
  if (owner === token) owner = null;
}
/** Another recogniser (attachDrag or claimGesture) has taken the current gesture. */
export function gestureOwnedByOther(token: object): boolean {
  return owner !== null && owner !== token;
}

function onWindowClick(e: MouseEvent) {
  if (performance.now() < suppressClickUntil) {
    e.preventDefault();
    e.stopPropagation();
    suppressClickUntil = 0;
  }
}
let clickGuardInstalled = false;
/** The click guard is global but installed lazily (first recogniser), so desktop never gets it. */
function installClickGuard() {
  if (clickGuardInstalled || typeof window === 'undefined') return;
  clickGuardInstalled = true;
  window.addEventListener('click', onWindowClick, true);
}

interface Sample {
  t: number;
  x: number;
  y: number;
}

export function attachDrag(el: HTMLElement, spec: DragSpec, opts: { capture?: boolean } = {}): () => void {
  installClickGuard();
  const me = {};
  const capture = !!opts.capture;
  let state: 'idle' | 'pending' | 'drag' = 'idle';
  let sx = 0;
  let sy = 0;
  let samples: Sample[] = [];
  let touchId: number | null = null;

  const reset = () => {
    state = 'idle';
    touchId = null;
    samples = [];
    if (owner === me) owner = null;
    unfollowTarget();
  };

  const startAt = (x: number, y: number, target: EventTarget | null, mouse: boolean) => {
    if (state !== 'idle') return false;
    if (!spec.begin({ x, y, target, mouse })) return false;
    state = 'pending';
    sx = x;
    sy = y;
    samples = [{ t: performance.now(), x, y }];
    return true;
  };

  /** Returns true when the event should be preventDefault-ed. */
  const moveTo = (x: number, y: number): boolean => {
    if (state === 'idle') return false;
    if (owner && owner !== me) {
      // another recogniser took the gesture
      if (state === 'drag') spec.end({ dx: x - sx, dy: y - sy, vx: 0, vy: 0, cancelled: true });
      reset();
      return false;
    }
    const now = performance.now();
    samples.push({ t: now, x, y });
    while (samples.length > 2 && now - samples[0].t > 100) samples.shift();
    const dx = x - sx;
    const dy = y - sy;
    if (state === 'pending') {
      const d = spec.decide(dx, dy);
      if (d === 'reject') {
        reset();
        return false;
      }
      if (d !== 'claim') return false;
      state = 'drag';
      owner = me;
    }
    spec.move(dx, dy);
    return true;
  };

  const finish = (x: number, y: number, cancelled: boolean) => {
    if (state === 'drag') {
      const now = performance.now();
      const first = samples[0] ?? { t: now, x, y };
      const dt = Math.max(1, now - first.t);
      const vx = now - first.t > 160 ? 0 : (x - first.x) / dt;
      const vy = now - first.t > 160 ? 0 : (y - first.y) / dt;
      // a real drag must not end in a click (taps with a tiny jitter still click)
      if (Math.hypot(x - sx, y - sy) > 8) suppressClickUntil = performance.now() + 400;
      spec.end({ dx: x - sx, dy: y - sy, vx, vy, cancelled });
    }
    reset();
  };

  // ── touch ──
  let lastX = 0;
  let lastY = 0;
  // Touch events keep targeting the node the touch started on. When that node is removed mid-gesture
  // (a row re-rendered by a refresh, an empty-state row replaced…), its events no longer bubble to `el`:
  // follow them on the detached target itself, otherwise the recogniser (and the global owner) would
  // stay stuck in 'drag' and block every other gesture.
  let touchTarget: EventTarget | null = null;
  const detachedOnly = (fn: (e: TouchEvent) => void) => (e: TouchEvent) => {
    const t = touchTarget;
    if (t instanceof Node && t.isConnected && el.contains(t)) return; // bubbles to `el` normally
    fn(e);
  };
  const onTargetMove = detachedOnly((e) => onTouchMove(e));
  const onTargetEnd = detachedOnly((e) => onTouchEnd(e));
  const unfollowTarget = () => {
    const t = touchTarget;
    touchTarget = null;
    if (!t) return;
    t.removeEventListener('touchmove', onTargetMove as EventListener);
    t.removeEventListener('touchend', onTargetEnd as EventListener);
    t.removeEventListener('touchcancel', onTargetEnd as EventListener);
  };
  const followTarget = (t: EventTarget | null) => {
    unfollowTarget();
    if (!t || t === el) return;
    touchTarget = t;
    t.addEventListener('touchmove', onTargetMove as EventListener, { passive: false });
    t.addEventListener('touchend', onTargetEnd as EventListener);
    t.addEventListener('touchcancel', onTargetEnd as EventListener);
  };
  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) {
      if (state === 'drag') finish(lastX, lastY, true);
      else reset();
      unfollowTarget();
      return;
    }
    // A single finger is down: every earlier gesture is over. Drop state whose touchend was lost,
    // and an owner left behind by any recogniser.
    if (state !== 'idle') {
      if (state === 'drag') finish(lastX, lastY, true);
      else reset();
    }
    unfollowTarget();
    owner = null;
    const t = e.touches[0];
    lastX = t.clientX;
    lastY = t.clientY;
    if (startAt(t.clientX, t.clientY, e.target, false)) {
      touchId = t.identifier;
      followTarget(e.target);
    }
  };
  function onTouchMove(e: TouchEvent) {
    if (touchId === null) return;
    const t = Array.from(e.touches).find((x) => x.identifier === touchId);
    if (!t) return;
    lastX = t.clientX;
    lastY = t.clientY;
    if (moveTo(t.clientX, t.clientY) && e.cancelable) e.preventDefault();
  }
  function onTouchEnd(e: TouchEvent) {
    if (touchId === null) return;
    const t = Array.from(e.changedTouches).find((x) => x.identifier === touchId);
    if (!t) return;
    unfollowTarget();
    finish(t.clientX, t.clientY, e.type === 'touchcancel');
  }

  // ── mouse ──
  const onPointerMove = (e: PointerEvent) => {
    if (moveTo(e.clientX, e.clientY)) e.preventDefault();
  };
  const onPointerUp = (e: PointerEvent) => {
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('pointercancel', onPointerUp, true);
    finish(e.clientX, e.clientY, e.type === 'pointercancel');
  };
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    if (!startAt(e.clientX, e.clientY, e.target, true)) return;
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerUp, true);
  };

  el.addEventListener('touchstart', onTouchStart, { passive: true, capture });
  el.addEventListener('touchmove', onTouchMove, { passive: false, capture });
  el.addEventListener('touchend', onTouchEnd, { capture });
  el.addEventListener('touchcancel', onTouchEnd, { capture });
  el.addEventListener('pointerdown', onPointerDown, { capture });
  return () => {
    el.removeEventListener('touchstart', onTouchStart, { capture });
    el.removeEventListener('touchmove', onTouchMove, { capture });
    el.removeEventListener('touchend', onTouchEnd, { capture });
    el.removeEventListener('touchcancel', onTouchEnd, { capture });
    el.removeEventListener('pointerdown', onPointerDown, { capture });
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('pointercancel', onPointerUp, true);
    reset();
  };
}

/** Nearest vertically-scrollable ancestor of `node` inside `root` (inclusive), or null. */
export function scrollParentWithin(node: EventTarget | null, root: HTMLElement): HTMLElement | null {
  let el = node instanceof Element ? (node as HTMLElement) : null;
  while (el && el !== root.parentElement) {
    if (el instanceof HTMLElement) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) return el;
    }
    if (el === root) break;
    el = el.parentElement;
  }
  return null;
}

/** True when the press started inside a text input/textarea (don't hijack text selection). */
export function isTextInput(node: EventTarget | null): boolean {
  return node instanceof HTMLElement && !!node.closest('input, textarea, [contenteditable="true"], [contenteditable=""]');
}
