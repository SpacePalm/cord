// iOS 26 presentation layer.
//  · large sheets (card stack, drag-to-dismiss), partial detents (medium / {height}), nested sheets
//  · fullScreenCover, glass alerts (+ text field), anchored confirmation popovers (fallback bottom
//    panel with Cancel), glass Menus, arrow popovers
//  · every layer owns a history entry (browser / Android back closes the top one first), Escape
//    closes, focus is trapped/restored, the content below is inert
//  · portals render INSIDE .ios-root (this provider is mounted by MobileRoot)
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { SFSymbol } from '../ui/Icon';
import { createHistoryOwner, historyForget, historyPush, historyRemove, installHistory } from '../nav/history';
import { SheetView, FullScreenView } from './Sheet';
import { AlertView } from './Alert';
import { ConfirmView } from './Confirm';
import { MenuView } from './Menu';
import { PopoverView } from './Popover';
import './present.css';

export type Detent = 'large' | 'medium' | { height: number };

export interface SheetCtx {
  /** Animates out; resolves after the out-animation (iOS waits ~350ms before the next sheet). */
  dismiss: () => Promise<void>;
}

export interface SheetOptions {
  /** Default ['large']. */
  detents?: Detent[];
  /** Called after the sheet is gone (any dismissal path). */
  onDismiss?: () => void;
  /** false → swipe-down / backdrop / back button do not close it. Default true. */
  dismissible?: boolean;
}

export interface AlertAction {
  label: string;
  role?: 'default' | 'cancel' | 'destructive';
  /** Receives the text-field value when the alert has one. */
  onPress?: (text: string) => void;
}

export interface AlertOptions {
  title: string;
  message?: string;
  textField?: {
    placeholder?: string;
    initial?: string;
    maxLength?: number;
    secure?: boolean;
    inputMode?: 'text' | 'numeric' | 'email';
  };
  actions: AlertAction[];
}

export interface ConfirmAction {
  label: string;
  role?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

export interface ConfirmOptions {
  /** Only shown when set (iOS `titleVisibility: .visible`). */
  title?: string;
  message?: string;
  /** Element (usually the tapped list ROW) the popover points at; none → bottom panel with Cancel. */
  anchor?: HTMLElement | DOMRect | null;
  actions: ConfirmAction[];
}

export type MenuItem =
  | {
      label: string;
      icon?: SFSymbol;
      role?: 'default' | 'destructive';
      /** Picker-style menus: checkmark on the selected value. */
      checked?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }
  | 'divider';

export interface PresentApi {
  presentSheet(render: (ctx: SheetCtx) => ReactNode, opts?: SheetOptions): SheetCtx;
  presentFullScreen(render: (ctx: SheetCtx) => ReactNode, opts?: { onDismiss?: () => void }): SheetCtx;
  alert(opts: AlertOptions): void;
  confirm(opts: ConfirmOptions): void;
  /** Anchored glass menu (iOS 26 Menu). */
  showMenu(anchor: HTMLElement, items: MenuItem[]): void;
  /** Small anchored glass popover with arrow (emoji grid). Stays open until tap outside. */
  showPopover(anchor: HTMLElement, render: (ctx: SheetCtx) => ReactNode): SheetCtx;
  /** Close every presented layer (used before navigating from inside a sheet). */
  dismissAll(): Promise<void>;
}

// ───────────────────────────── layer store ─────────────────────────────

interface LayerBase {
  id: number;
  closing: boolean;
  /** Set when the layer finished its out-animation and was removed. */
  closed: boolean;
  hid: number | null;
  dismissible: boolean;
  ctx: SheetCtx;
  waiters: Array<() => void>;
  onClosed?: () => void;
  restoreFocus: Element | null;
  /** Called when the user cancels (tap outside / back / Escape). */
  onCancel?: () => void;
}
export interface SheetLayer extends LayerBase {
  kind: 'sheet';
  render: (ctx: SheetCtx) => ReactNode;
  detents: Detent[];
  detent: number;
}
export interface FullLayer extends LayerBase {
  kind: 'full';
  render: (ctx: SheetCtx) => ReactNode;
}
export interface AlertLayer extends LayerBase {
  kind: 'alert';
  opts: AlertOptions;
}
export interface ConfirmLayer extends LayerBase {
  kind: 'confirm';
  opts: ConfirmOptions;
  rect: DOMRect | null;
}
export interface MenuLayer extends LayerBase {
  kind: 'menu';
  rect: DOMRect;
  items: MenuItem[];
}
export interface PopoverLayer extends LayerBase {
  kind: 'popover';
  rect: DOMRect;
  render: (ctx: SheetCtx) => ReactNode;
}
export type Layer = SheetLayer | FullLayer | AlertLayer | ConfirmLayer | MenuLayer | PopoverLayer;

const OUT_MS: Record<Layer['kind'], number> = {
  sheet: 350,
  full: 350,
  alert: 150,
  confirm: 200,
  menu: 200,
  popover: 200,
};

/** Kinds that make everything below them inert and receive focus. */
const MODAL_KINDS = new Set<Layer['kind']>(['sheet', 'full', 'alert', 'confirm']);

class LayerStore {
  layers: Layer[] = [];
  owner = createHistoryOwner();
  mounted = 0;
  els = new Map<number, HTMLElement>();
  baseEl: HTMLElement | null = null;
  focusProxy: HTMLInputElement | null = null;
  /** Element focused right before primeKeyboard() moved focus to the proxy. */
  primedFrom: Element | null = null;
  /** 'in' while a sheet is being presented, 'out' while one is leaving (recede transition timing). */
  lastChange: 'in' | 'out' = 'in';
  private nextId = 1;
  private listeners = new Set<() => void>();
  private version = 0;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  add<L extends Layer>(partial: Omit<L, keyof LayerBase> & Partial<Pick<LayerBase, 'dismissible' | 'onClosed' | 'onCancel'>>): SheetCtx {
    if (!this.mounted) return noopCtx;
    const id = this.nextId++;
    const ctx: SheetCtx = { dismiss: () => this.close(id) };
    // never restore focus to the keyboard primer (it would re-open the keyboard after the alert)
    let active: Element | null = typeof document !== 'undefined' ? document.activeElement : null;
    if (active && active === this.focusProxy) active = this.primedFrom;
    const layer = {
      closing: false,
      closed: false,
      hid: null,
      dismissible: true,
      waiters: [],
      restoreFocus: active,
      ...partial,
      id,
      ctx,
    } as unknown as Layer;
    layer.hid = historyPush(this.owner, () => this.onHistoryBack(id));
    this.layers = [...this.layers, layer];
    if (layer.kind === 'sheet') this.lastChange = 'in';
    this.emit();
    return ctx;
  }

  get(id: number): Layer | undefined {
    return this.layers.find((l) => l.id === id);
  }

  /** Programmatic or UI close. Resolves after the out-animation. */
  close(id: number, fromHistory = false): Promise<void> {
    const layer = this.get(id);
    if (!layer) return Promise.resolve();
    if (layer.closing) return new Promise((res) => layer.waiters.push(res));
    layer.closing = true;
    if (!fromHistory) historyRemove(layer.hid);
    if (layer.kind === 'sheet' || layer.kind === 'full') this.lastChange = 'out';
    this.layers = [...this.layers];
    this.emit();
    const p = new Promise<void>((res) => layer.waiters.push(res));
    window.setTimeout(() => this.finalize(id), OUT_MS[layer.kind] + 20);
    return p;
  }

  private finalize(id: number) {
    const layer = this.get(id);
    if (!layer || layer.closed) return;
    layer.closed = true;
    this.layers = this.layers.filter((l) => l.id !== id);
    this.els.delete(id);
    this.emit();
    // Restore focus (only if it was lost into the closed layer / body). Deferred: the layer below is
    // still `inert` until React commits this removal, and focus() on an inert element is a no-op.
    if (MODAL_KINDS.has(layer.kind)) {
      const rf = layer.restoreFocus;
      window.setTimeout(() => {
        const ae = document.activeElement;
        const proxy = this.focusProxy;
        const lost = !ae || ae === document.body || ae === proxy;
        if (!lost) return;
        if (rf instanceof HTMLElement && rf !== proxy && rf.isConnected && !rf.closest('[inert]')) {
          try {
            rf.focus({ preventScroll: true });
          } catch {
            /* ignore */
          }
        }
        // never leave the keyboard primer focused (keyboard would stay up)
        if (proxy && document.activeElement === proxy) proxy.blur();
      }, 0);
    }
    try {
      layer.onClosed?.();
    } catch (e) {
      console.error(e);
    }
    layer.waiters.splice(0).forEach((w) => w());
  }

  /** User dismissal (tap outside, drag down, Escape). Runs the cancel action. */
  cancel(id: number, fromHistory = false) {
    const layer = this.get(id);
    if (!layer || layer.closing) return;
    if (!layer.dismissible) {
      if (fromHistory) layer.hid = historyPush(this.owner, () => this.onHistoryBack(id));
      return;
    }
    void this.close(id, fromHistory);
    try {
      layer.onCancel?.();
    } catch (e) {
      console.error(e);
    }
  }

  private onHistoryBack(id: number) {
    this.cancel(id, true);
  }

  topOpen(): Layer | undefined {
    for (let i = this.layers.length - 1; i >= 0; i--) if (!this.layers[i].closing) return this.layers[i];
    return undefined;
  }

  dismissAll(): Promise<void> {
    return Promise.all([...this.layers].reverse().map((l) => this.close(l.id))).then(() => undefined);
  }

  setDetent(id: number, index: number) {
    const l = this.get(id);
    if (!l || l.kind !== 'sheet') return;
    l.detent = Math.max(0, Math.min(l.detents.length - 1, index));
    this.layers = [...this.layers];
    this.emit();
  }

  /** Element that recedes behind sheet `id` (the sheet card below, or the base). */
  lowerEl(id: number): HTMLElement | null {
    const idx = this.layers.findIndex((l) => l.id === id);
    for (let i = idx - 1; i >= 0; i--) {
      const l = this.layers[i];
      if (l.kind === 'sheet' && !l.closing) return this.els.get(l.id)?.querySelector<HTMLElement>('.ios-sheet-card') ?? null;
      if (l.kind === 'full') return null;
    }
    return this.baseEl;
  }
}

const store = new LayerStore();
const resolved = Promise.resolve();
const noopCtx: SheetCtx = { dismiss: () => resolved };

export function isLargeDetent(d: Detent | undefined): boolean {
  return d === undefined || d === 'large';
}

function rectOf(anchor: HTMLElement | DOMRect | null | undefined): DOMRect | null {
  if (!anchor) return null;
  if (anchor instanceof DOMRect) return anchor;
  if (typeof (anchor as HTMLElement).getBoundingClientRect === 'function') {
    if (!(anchor as HTMLElement).isConnected) return null;
    return (anchor as HTMLElement).getBoundingClientRect();
  }
  const r = anchor as unknown as { x: number; y: number; width: number; height: number };
  return new DOMRect(r.x, r.y, r.width, r.height);
}

/**
 * Focus a hidden input synchronously inside the user gesture so that iOS Safari opens the keyboard;
 * a text field that mounts right after can then take focus (alert text fields, autofocus sheets).
 */
let primerTimer = 0;
export function primeKeyboard(): void {
  const p = store.focusProxy;
  if (!p || !p.isConnected) return;
  const ae = document.activeElement;
  if (ae !== p) store.primedFrom = ae;
  try {
    p.focus({ preventScroll: true });
  } catch {
    /* ignore */
  }
  // Safety net: nothing took the focus over (single-instance sheet already open, inline field that never
  // mounted…) → never leave the primer focused (the keyboard would stay up with nowhere to type).
  window.clearTimeout(primerTimer);
  primerTimer = window.setTimeout(() => {
    if (document.activeElement === p) p.blur();
  }, 1500);
}

/** Is any sheet / alert / menu / popover currently shown (or animating out)? */
export function isAnythingPresented(): boolean {
  return store.layers.length > 0;
}

/**
 * Would a screen pushed now be hidden behind a presented layer? True while any layer is open, or a
 * sheet / full-screen cover is still animating out. Menus, popovers, alerts and confirmation dialogs
 * that are already fading out do not cover the stack (an item action may push right away).
 */
export function isCoveringPresented(): boolean {
  return store.layers.some((l) => !l.closing || l.kind === 'sheet' || l.kind === 'full');
}

export const present: PresentApi = {
  presentSheet(render, opts = {}) {
    const detents = opts.detents && opts.detents.length ? opts.detents : (['large'] as Detent[]);
    // SwiftUI starts at the smallest detent
    const order = (d: Detent) => (d === 'large' ? 1e6 : d === 'medium' ? window.innerHeight * 0.5 : d.height);
    const sorted = [...detents].sort((a, b) => order(a) - order(b));
    return store.add<SheetLayer>({
      kind: 'sheet',
      render,
      detents: sorted,
      detent: 0,
      dismissible: opts.dismissible !== false,
      onClosed: opts.onDismiss,
    });
  },
  presentFullScreen(render, opts = {}) {
    return store.add<FullLayer>({ kind: 'full', render, onClosed: opts.onDismiss });
  },
  alert(opts) {
    if (opts.textField) primeKeyboard();
    const cancel = opts.actions.find((a) => a.role === 'cancel');
    store.add<AlertLayer>({
      kind: 'alert',
      opts,
      onCancel: () => cancel?.onPress?.(''),
    });
  },
  confirm(opts) {
    const cancel = opts.actions.find((a) => a.role === 'cancel');
    store.add<ConfirmLayer>({
      kind: 'confirm',
      opts,
      rect: rectOf(opts.anchor),
      onCancel: () => cancel?.onPress?.(),
    });
  },
  showMenu(anchor, items) {
    const rect = rectOf(anchor);
    if (!rect) return;
    store.add<MenuLayer>({ kind: 'menu', rect, items });
  },
  showPopover(anchor, render) {
    const rect = rectOf(anchor);
    if (!rect) return noopCtx;
    return store.add<PopoverLayer>({ kind: 'popover', rect, render });
  },
  dismissAll() {
    return store.dismissAll();
  },
};

export function usePresent(): PresentApi {
  return present;
}

// ───────────────────────────── provider ─────────────────────────────

const Z_BASE: Record<Layer['kind'], number> = {
  sheet: 100,
  full: 100,
  confirm: 200,
  menu: 200,
  popover: 200,
  alert: 300,
};

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => !el.closest('[inert]') && el.offsetParent !== null);
}

export function PresentationProvider({ children, overlays }: { children?: ReactNode; overlays?: ReactNode }) {
  useSyncExternalStore(store.subscribe, store.getVersion);
  const baseRef = useRef<HTMLDivElement | null>(null);
  const proxyRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    store.mounted++;
    const uninstall = installHistory(store.owner);
    return () => {
      store.mounted--;
      uninstall();
      if (!store.mounted) {
        // shell unmounted (route change: login → app, logout…): drop every layer without animation.
        // The owner object is module-global and is re-activated by the next MobileRoot, so the dropped
        // layers' history entries must be forgotten explicitly (no history.go(): the router is moving).
        const dropped = store.layers;
        dropped.forEach((l) => {
          historyForget(l.hid);
          l.closed = true;
          l.waiters.splice(0).forEach((w) => w());
        });
        store.layers = [];
        store.els.clear();
        // `onDismiss` promises "any dismissal path": callers reset their state there (e.g. the quick
        // switcher's single-instance flag — left set, the search button would stay dead after the shell
        // comes back). Deferred so that it runs after the route change that unmounted the shell.
        const closers = dropped.map((l) => l.onClosed).filter((f): f is () => void => !!f);
        if (closers.length) {
          window.setTimeout(() => {
            closers.forEach((f) => {
              try {
                f();
              } catch (e) {
                console.error(e);
              }
            });
          }, 0);
        }
      }
    };
  }, []);

  useLayoutEffect(() => {
    store.baseEl = baseRef.current;
    store.focusProxy = proxyRef.current;
  });

  // Escape closes the top layer; Tab is trapped inside the top modal layer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const top = store.topOpen();
      if (!top) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        store.cancel(top.id);
        return;
      }
      if (e.key === 'Tab' && MODAL_KINDS.has(top.kind)) {
        const el = store.els.get(top.id);
        if (!el) return;
        const f = focusables(el);
        if (!f.length) {
          e.preventDefault();
          return;
        }
        const first = f[0];
        const last = f[f.length - 1];
        const ae = document.activeElement;
        if (e.shiftKey && (ae === first || !el.contains(ae))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (ae === last || !el.contains(ae))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const setEl = useCallback((id: number, el: HTMLElement | null) => {
    if (el) store.els.set(id, el);
  }, []);

  const layers = store.layers;
  // card stack: which sheets are covered by an open large sheet
  const recededIds = new Set<number>();
  let baseReceded = false;
  let modalAbove = false; // a modal layer exists above (→ inert)
  const inertIds = new Set<number>();
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (modalAbove) inertIds.add(l.id);
    if (!l.closing && MODAL_KINDS.has(l.kind)) modalAbove = true;
  }
  {
    let largeAbove = false;
    let fullAbove = false;
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (l.kind === 'sheet') {
        if (largeAbove && !fullAbove) recededIds.add(l.id);
        if (!l.closing && isLargeDetent(l.detents[l.detent])) largeAbove = true;
      } else if (l.kind === 'full' && !l.closing) fullAbove = true;
    }
    baseReceded = largeAbove;
  }
  const baseInert = layers.some((l) => !l.closing && MODAL_KINDS.has(l.kind));

  useLayoutEffect(() => {
    baseRef.current?.toggleAttribute('inert', baseInert);
    if (baseInert) baseRef.current?.setAttribute('aria-hidden', 'true');
    else baseRef.current?.removeAttribute('aria-hidden');
  }, [baseInert]);

  const dur = store.lastChange === 'in' ? '500ms' : '350ms';

  return (
    <div className="ios-present">
      <div
        className="ios-present-base"
        ref={baseRef}
        data-receded={baseReceded ? 'true' : 'false'}
        style={{ '--ios-recede-dur': dur } as CSSProperties}
      >
        {children}
        <div className="ios-recede-shade" aria-hidden />
      </div>
      {overlays}
      {layers.map((l, i) => {
        const common = { z: Z_BASE[l.kind] + i, inert: inertIds.has(l.id), setEl, api: store as LayerApi };
        switch (l.kind) {
          case 'sheet':
            return <SheetView key={l.id} {...common} layer={l} receded={recededIds.has(l.id)} recedeDur={dur} />;
          case 'full':
            return <FullScreenView key={l.id} {...common} layer={l} />;
          case 'alert':
            return <AlertView key={l.id} {...common} layer={l} />;
          case 'confirm':
            return <ConfirmView key={l.id} {...common} layer={l} />;
          case 'menu':
            return <MenuView key={l.id} {...common} layer={l} />;
          case 'popover':
            return <PopoverView key={l.id} {...common} layer={l} />;
        }
      })}
      <input
        ref={proxyRef}
        className="ios-focus-proxy"
        aria-hidden
        tabIndex={-1}
        readOnly={false}
        autoComplete="off"
        onBlur={(e) => {
          e.currentTarget.value = '';
        }}
      />
    </div>
  );
}

/** What layer views may do with the store. */
export interface LayerApi {
  close(id: number): Promise<void>;
  /** User dismissal: runs the cancel action (if any) and closes, unless not dismissible. */
  cancel(id: number): void;
  setDetent(id: number, index: number): void;
  /** Element that recedes behind sheet `id`. */
  lowerEl(id: number): HTMLElement | null;
}

/** Props every layer view receives. */
export interface LayerViewProps<L extends Layer> {
  layer: L;
  z: number;
  inert: boolean;
  setEl: (id: number, el: HTMLElement | null) => void;
  api: LayerApi;
}
