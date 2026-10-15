// iOS NavigationStack for the mobile shell.
//  · stack of routes, root = home; push / pop / popToRoot / navigate (QuickRoute) / replace
//  · history integration: one history entry per pushed screen (browser / Android back = pop,
//    modals on top are closed first — see ./history.ts)
//  · iOS push/pop transition (500ms, cubic-bezier(0.32,0.72,0,1), previous screen −30% + shade,
//    bar items cross-fade in place), prefers-reduced-motion → cross-fade
//  · interactive edge-swipe back from the left 20px (disabled where the browser has its own)
//  · keeps the top 4 screens mounted (scroll offsets of deeper ones cached)
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { Route } from './routes';
import { routeKey } from './routes';
import { createHistoryOwner, historyPush, historyRemove, installHistory, type HistoryOwner } from './history';
import { attachDrag } from './gesture';
import { DUR_PUSH, EASE_NAV, hasNativeBackSwipe, prefersReducedMotion } from './env';
import { forgetScroll } from './scrollCache';
import { isCoveringPresented, present } from '../present/PresentationProvider';
import './nav.css';

export interface NavApi {
  /** Current stack, root first (root is always { name: 'home' }). Not reactive — see useNavStack(). */
  stack: Route[];
  push(route: Route): void;
  pop(): void;
  popToRoot(): void;
  /**
   * iOS `navigationDestination(item: quickRoute)` semantics (QuickSwitcher, banner tap,
   * "Open chat" in member menu, notification click): if the top screen was itself opened via
   * navigate(), replace it; otherwise push on top of the current stack.
   */
  navigate(route: Route): void;
  /** Replace the top screen without animation-direction change. */
  replace(route: Route): void;
}

export interface ScreenCtx {
  route: Route;
  /** 0 = root. */
  depth: number;
  /** True while this screen is the visible top of the stack. */
  isTop: boolean;
  /** Unique id of this stack entry (scroll cache key). */
  entryId?: number;
}

// ───────────────────────────── store ─────────────────────────────

interface Entry {
  id: number;
  route: Route;
  /** Opened through navigate() (QuickRoute). */
  quick: boolean;
  /** History entry id (null for the root). */
  hid: { id: number | null };
}

type Anim =
  | { type: 'push'; incoming: number; outgoing: number }
  | { type: 'pop'; incoming: number; outgoing: number }
  | { type: 'fade'; incoming: number };

const MAX_MOUNTED = 4;
const HOME: Route = { name: 'home' };

class NavStore {
  stack: Entry[] = [{ id: 0, route: HOME, quick: false, hid: { id: null } }];
  /** Entries animating out: 'pop' = slides right on top; 'under' = slides left under the incoming. */
  leaving = new Map<number, { entry: Entry; mode: 'pop' | 'under'; depth: number }>();
  anim: Anim | null = null;
  animNoMotion = false;
  backDisabled = new Set<number>();
  els = new Map<number, HTMLElement>();
  running: Animation[] = [];
  afterCommit: Array<() => void> = [];
  owner: HistoryOwner = createHistoryOwner();
  private nextId = 1;
  private listeners = new Set<() => void>();
  version = 0;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  top(): Entry {
    return this.stack[this.stack.length - 1];
  }

  /** Jump every running transition to its end (a new operation interrupts it). */
  finishRunning() {
    const r = this.running;
    this.running = [];
    for (const a of r) {
      try {
        a.finish();
      } catch {
        /* ignore */
      }
    }
    // finish events fire asynchronously — drop the leaving screens now
    this.leaving.clear();
  }

  private makeEntry(route: Route, quick: boolean): Entry {
    const entry: Entry = { id: this.nextId++, route, quick, hid: { id: null } };
    this.bindHistory(entry);
    return entry;
  }

  private bindHistory(entry: Entry) {
    const holder = entry.hid;
    holder.id = historyPush(this.owner, () => this.onUserPop(holder));
  }

  /** Number of queued routes consumed by seed() (removed from pendingRoutes once mounted). */
  seeded = 0;

  /** Initial routes (queued before mount) are rendered at once; their history entries follow. */
  seed(routes: Route[]) {
    this.seeded = routes.length;
    for (const route of routes) this.stack.push({ id: this.nextId++, route, quick: pendingQuick.has(route), hid: { id: null } });
  }

  /** Create history entries for seeded screens (after the history listener is installed). */
  bindSeeded() {
    for (let i = 1; i < this.stack.length; i++) if (this.stack[i].hid.id === null) this.bindHistory(this.stack[i]);
  }

  /** The user went back in browser history over a screen entry. */
  private onUserPop(holder: { id: number | null }) {
    const idx = this.stack.findIndex((e) => e.hid === holder);
    if (idx <= 0) return;
    // iOS Safari tab: the browser already animated its own snapshot → no second animation.
    this.popTo(idx, { animate: !hasNativeBackSwipe(), history: false });
  }

  push(route: Route, quick = false, animate = true) {
    this.finishRunning();
    const prev = this.top();
    const entry = this.makeEntry(route, quick);
    this.stack = [...this.stack, entry];
    this.anim = animate ? { type: 'push', incoming: entry.id, outgoing: prev.id } : null;
    this.emit();
  }

  popTo(len: number, opts: { animate: boolean; history: boolean }) {
    len = Math.max(1, len);
    if (len >= this.stack.length) return;
    this.finishRunning();
    const removed = this.stack.slice(len);
    this.stack = this.stack.slice(0, len);
    if (opts.history) for (let i = removed.length - 1; i >= 0; i--) historyRemove(removed[i].hid.id);
    for (const r of removed) {
      forgetScroll(r.id);
      this.backDisabled.delete(r.id);
    }
    const outgoing = removed[removed.length - 1];
    if (opts.animate) {
      this.leaving.set(outgoing.id, { entry: outgoing, mode: 'pop', depth: len + removed.length - 1 });
      this.anim = { type: 'pop', incoming: this.top().id, outgoing: outgoing.id };
    } else {
      this.anim = null;
    }
    this.emit();
  }

  /** QuickRoute: drop the previous quick-routed screen (and everything above it), then push. */
  navigate(route: Route, animate = true) {
    const q = this.stack.findIndex((e, i) => i > 0 && e.quick);
    if (q === -1) {
      this.push(route, true, animate);
      return;
    }
    this.finishRunning();
    const removed = this.stack.slice(q);
    this.stack = this.stack.slice(0, q);
    for (let i = removed.length - 1; i >= 0; i--) historyRemove(removed[i].hid.id);
    for (const r of removed) {
      forgetScroll(r.id);
      this.backDisabled.delete(r.id);
    }
    const outgoing = removed[removed.length - 1];
    const entry = this.makeEntry(route, true);
    this.stack = [...this.stack, entry];
    if (animate) {
      this.leaving.set(outgoing.id, { entry: outgoing, mode: 'under', depth: q + removed.length - 1 });
      this.anim = { type: 'push', incoming: entry.id, outgoing: outgoing.id };
    } else this.anim = null;
    this.emit();
  }

  replace(route: Route) {
    if (this.stack.length === 1) {
      this.push(route);
      return;
    }
    this.finishRunning();
    const old = this.top();
    const entry: Entry = { id: this.nextId++, route, quick: old.quick, hid: old.hid };
    forgetScroll(old.id);
    this.backDisabled.delete(old.id);
    this.stack = [...this.stack.slice(0, -1), entry];
    this.anim = { type: 'fade', incoming: entry.id };
    this.emit();
  }
}

// ───────────────────────────── contexts & imperative API ─────────────────────────────

let current: NavStore | null = null;

function whenUncovered(fn: () => void) {
  // Pushing behind a sheet would hide the new screen: close modals first (iOS waits for it too).
  if (isCoveringPresented()) void present.dismissAll().then(fn);
  else fn();
}

/**
 * push()/navigate() before the stack is mounted (e.g. from a screen's mount effect — child effects run
 * before NavStackProvider's — or from a notification click while logged out) are queued and applied
 * without animation once the stack mounts, instead of being dropped.
 */
function pushOrQueue(r: Route, quick: boolean) {
  const s = current;
  if (s) {
    if (quick) s.navigate(r);
    else s.push(r);
    return;
  }
  if (quick) pendingQuick.add(r);
  pendingRoutes.push(r);
}

/** Forwarding NavApi — works from anywhere (sheets, store bridges) once a NavStack is mounted. */
const navProxy: NavApi = {
  get stack() {
    return current ? current.stack.map((e) => e.route) : [HOME, ...pendingRoutes];
  },
  push: (r) => whenUncovered(() => pushOrQueue(r, false)),
  pop: () => {
    const s = current;
    if (s && s.stack.length > 1) s.popTo(s.stack.length - 1, { animate: true, history: true });
  },
  popToRoot: () => {
    const s = current;
    if (s && s.stack.length > 1) s.popTo(1, { animate: true, history: true });
  },
  navigate: (r) => whenUncovered(() => pushOrQueue(r, true)),
  replace: (r) => current?.replace(r),
};

export const NavContext = createContext<NavApi>(navProxy);
/** The mounted store (lets useNavStack subscribe during the provider's first render). */
const StoreContext = createContext<NavStore | null>(null);
export const ScreenContext = createContext<ScreenCtx>({ route: HOME, depth: 0, isTop: true });

/** Internal: Screen ↔ NavStack (edge-swipe availability). */
interface NavInternal {
  setBackEnabled(entryId: number, enabled: boolean): void;
}
export const NavInternalContext = createContext<NavInternal | null>(null);

export function useNav(): NavApi {
  return useContext(NavContext);
}

export function useScreenCtx(): ScreenCtx {
  return useContext(ScreenContext);
}

/** Reactive snapshot of the stack (re-renders on every push/pop). */
export function useNavStack(): Route[] {
  const store = useContext(StoreContext) ?? current;
  useSyncExternalStore(store ? store.subscribe : noopSubscribe, store ? store.getVersion : zero);
  return store ? store.stack.map((e) => e.route) : navProxy.stack;
}
const noopSubscribe = () => () => {};
const zero = () => 0;

/** Imperative access for code outside React render (notification clicks, store bridges). */
export const mobileNav: NavApi = navProxy;

/** Routes to push once the stack mounts (e.g. /admin on a phone → settings → admin). */
export function queueMobileRoutes(routes: Route[]): void {
  if (current) {
    const s = current;
    routes.forEach((r, i) => s.push(r, false, i === routes.length - 1));
    return;
  }
  pendingRoutes.push(...routes);
}
export const pendingRoutes: Route[] = [];
/** Queued routes that came from navigate() (QuickRoute semantics). */
const pendingQuick = new WeakSet<Route>();

// ───────────────────────────── provider ─────────────────────────────

export interface NavStackProviderProps {
  /** Renders a route's screen component (see registry.tsx). */
  renderRoute: (route: Route) => ReactNode;
}

interface ItemProps {
  entry: Entry;
  depth: number;
  isTop: boolean;
  cls: string;
  renderRoute: (route: Route) => ReactNode;
  setEl: (id: number, el: HTMLElement | null) => void;
}

const StackItem = memo(function StackItem({ entry, depth, isTop, cls, renderRoute, setEl }: ItemProps) {
  const ctx = useMemo<ScreenCtx>(() => ({ route: entry.route, depth, isTop, entryId: entry.id }), [entry, depth, isTop]);
  const content = useMemo(() => renderRoute(entry.route), [renderRoute, entry.route]);
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.toggleAttribute('inert', !isTop);
    if (isTop) el.removeAttribute('aria-hidden');
    else el.setAttribute('aria-hidden', 'true');
  }, [isTop]);
  return (
    <div
      className={`ios-nav-item ${cls}`}
      data-route={routeKey(entry.route)}
      ref={(el) => {
        ref.current = el;
        setEl(entry.id, el);
      }}
    >
      <ScreenContext.Provider value={ctx}>{content}</ScreenContext.Provider>
      <div className="ios-nav-shade" aria-hidden />
    </div>
  );
});

function barOf(el: HTMLElement | undefined): HTMLElement | null {
  return el ? el.querySelector<HTMLElement>('.ios-nav-bar') : null;
}
function shadeOf(el: HTMLElement | undefined): HTMLElement | null {
  return el ? el.querySelector<HTMLElement>(':scope > .ios-nav-shade') : null;
}

export function NavStackProvider({ renderRoute }: NavStackProviderProps) {
  const storeRef = useRef<NavStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = new NavStore();
    // render must stay pure (StrictMode renders twice): copy now, consume in the effect
    if (pendingRoutes.length) storeRef.current.seed(pendingRoutes.slice());
  }
  const store = storeRef.current;
  useSyncExternalStore(store.subscribe, store.getVersion);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // history + imperative API + queued routes
  useEffect(() => {
    const uninstall = installHistory(store.owner);
    current = store;
    pendingRoutes.splice(0, store.seeded);
    store.seeded = 0;
    store.bindSeeded();
    if (pendingRoutes.length) {
      const routes = pendingRoutes.splice(0);
      routes.forEach((r) => (pendingQuick.has(r) ? store.navigate(r, false) : store.push(r, false, false)));
    }
    return () => {
      uninstall();
      if (current === store) current = null;
    };
  }, [store]);

  const setEl = useCallback(
    (id: number, el: HTMLElement | null) => {
      if (el) store.els.set(id, el);
      else store.els.delete(id);
    },
    [store],
  );

  const internal = useMemo<NavInternal>(
    () => ({
      setBackEnabled(entryId, enabled) {
        if (enabled) store.backDisabled.delete(entryId);
        else store.backDisabled.add(entryId);
      },
    }),
    [store],
  );

  // run transitions after the DOM reflects the new stack
  useLayoutEffect(() => {
    const after = store.afterCommit.splice(0);
    after.forEach((f) => f());
    const anim = store.anim;
    if (!anim) return;
    store.anim = null;
    const leavingIds = [...store.leaving.keys()];
    const reduce = prefersReducedMotion();
    const opts: KeyframeAnimationOptions = { duration: DUR_PUSH, easing: EASE_NAV };
    const anims: Animation[] = [];
    const run = (el: Element | null | undefined, frames: Keyframe[], o: KeyframeAnimationOptions = opts) => {
      if (!el) return;
      anims.push(el.animate(frames, o));
    };
    const vis = 'visible';
    if (anim.type === 'fade') {
      run(store.els.get(anim.incoming), [{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
    } else if (reduce) {
      if (anim.type === 'push') run(store.els.get(anim.incoming), [{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: 'ease-out' });
      else run(store.els.get(anim.outgoing), [{ opacity: 1, transform: 'none', visibility: vis }, { opacity: 0, transform: 'none', visibility: vis }], { duration: 250, easing: 'ease-out' });
    } else if (anim.type === 'push') {
      const inc = store.els.get(anim.incoming);
      const out = store.els.get(anim.outgoing);
      run(inc, [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }]);
      run(out, [
        { transform: 'translateX(0)', visibility: vis },
        { transform: 'translateX(-30%)', visibility: vis },
      ]);
      run(shadeOf(out), [{ opacity: 0 }, { opacity: 1 }]);
      // bar items stay in place and cross-fade (iOS 26 shared bar)
      run(barOf(inc), [{ transform: 'translateX(-100%)', opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }]);
      run(barOf(out), [{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(30%)', opacity: 0 }]);
    } else {
      const inc = store.els.get(anim.incoming);
      const out = store.els.get(anim.outgoing);
      run(out, [
        { transform: 'translateX(0)', visibility: vis },
        { transform: 'translateX(100%)', visibility: vis },
      ]);
      run(inc, [{ transform: 'translateX(-30%)' }, { transform: 'translateX(0)' }]);
      run(shadeOf(inc), [{ opacity: 1 }, { opacity: 0 }]);
      run(barOf(out), [{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(-100%)', opacity: 0 }]);
      run(barOf(inc), [{ transform: 'translateX(30%)', opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }]);
    }
    store.running.push(...anims);
    const done = () => {
      store.running = store.running.filter((a) => !anims.includes(a));
      let changed = false;
      for (const id of leavingIds) changed = store.leaving.delete(id) || changed;
      if (changed) store.emit();
    };
    if (anims.length) {
      let left = anims.length;
      let finished = false;
      const once = () => {
        if (finished) return;
        finished = true;
        done();
      };
      anims.forEach((a) => {
        const fin = () => {
          if (--left === 0) once();
        };
        a.onfinish = fin;
        a.oncancel = fin;
      });
      // animations stall while the page is not rendering (background tab) — clean up anyway
      window.setTimeout(once, DUR_PUSH + 150);
    } else done();
  });

  // interactive edge-swipe back
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    let topEl: HTMLElement | undefined;
    let prevEl: HTMLElement | undefined;
    let topId = -1;
    let W = 0;
    const parts = () => ({
      top: topEl,
      prev: prevEl,
      topBar: barOf(topEl),
      prevBar: barOf(prevEl),
      prevShade: shadeOf(prevEl),
    });
    const apply = (d: number) => {
      const p = parts();
      const f = Math.min(1, Math.max(0, d / W));
      if (p.top) p.top.style.transform = `translateX(${d}px)`;
      if (p.prev) {
        p.prev.style.visibility = 'visible';
        p.prev.style.transform = `translateX(${-0.3 * W + 0.3 * d}px)`;
      }
      if (p.prevShade) p.prevShade.style.opacity = String(1 - f);
      if (p.topBar) {
        p.topBar.style.transform = `translateX(${-d}px)`;
        p.topBar.style.opacity = String(Math.max(0, 1 - f * 1.6));
      }
      if (p.prevBar) {
        p.prevBar.style.transform = `translateX(${0.3 * W - 0.3 * d}px)`;
        p.prevBar.style.opacity = String(Math.min(1, f * 1.4));
      }
    };
    const clear = () => {
      const p = parts();
      for (const el of [p.top, p.prev, p.topBar, p.prevBar, p.prevShade]) {
        if (!el) continue;
        el.style.removeProperty('transform');
        el.style.removeProperty('visibility');
        el.style.removeProperty('opacity');
        el.getAnimations().forEach((a) => a.cancel());
      }
    };
    const detach = attachDrag(
      root,
      {
        begin: ({ x }) => {
          if (hasNativeBackSwipe()) return false;
          if (store.stack.length < 2 || store.running.length) return false;
          const top = store.top();
          if (store.backDisabled.has(top.id)) return false;
          const r = root.getBoundingClientRect();
          if (x - r.left > 20) return false;
          W = r.width;
          topId = top.id;
          topEl = store.els.get(top.id);
          prevEl = store.els.get(store.stack[store.stack.length - 2].id);
          return !!topEl;
        },
        decide: (dx, dy) => {
          if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) return 'reject';
          if (dx < -8) return 'reject';
          if (dx > 8 && dx > Math.abs(dy) * 1.2) return 'claim';
          return undefined;
        },
        move: (dx) => apply(Math.max(0, dx)),
        end: ({ dx, vx, cancelled }) => {
          const d = Math.max(0, dx);
          const complete = !cancelled && (d > 0.35 * W || vx > 0.5) && vx > -0.3;
          const p = parts();
          const remaining = complete ? (W - d) / W : d / W;
          const o: KeyframeAnimationOptions = {
            duration: Math.max(140, Math.min(DUR_PUSH, 420 * remaining + 80)),
            easing: 'cubic-bezier(0.2, 0.8, 0.25, 1)',
            fill: 'forwards',
          };
          const anims: Animation[] = [];
          const to = (el: HTMLElement | null | undefined, frame: Keyframe) => {
            if (!el) return;
            const cs = el.style;
            const from: Keyframe = { transform: cs.transform || 'none', opacity: cs.opacity || '1' };
            if (cs.visibility) {
              from.visibility = cs.visibility;
              frame = { ...frame, visibility: cs.visibility };
            }
            anims.push(el.animate([from, frame], o));
          };
          if (complete) {
            to(p.top, { transform: `translateX(${W}px)` });
            to(p.prev, { transform: 'translateX(0px)' });
            to(p.prevShade, { opacity: '0' });
            to(p.topBar, { transform: `translateX(${-W}px)`, opacity: '0' });
            to(p.prevBar, { transform: 'translateX(0px)', opacity: '1' });
          } else {
            to(p.top, { transform: 'translateX(0px)' });
            to(p.prev, { transform: `translateX(${-0.3 * W}px)` });
            to(p.prevShade, { opacity: '1' });
            to(p.topBar, { transform: 'translateX(0px)', opacity: '1' });
            to(p.prevBar, { transform: `translateX(${0.3 * W}px)`, opacity: '0' });
          }
          let left = anims.length;
          let settled = false;
          const fin = () => {
            if (--left > 0 || settled) return;
            settled = true;
            // the stack changed under the finger (programmatic push/pop): just drop the styles
            if (complete && store.top().id === topId) {
              const len = store.stack.length - 1;
              store.afterCommit.push(clear);
              store.popTo(len, { animate: false, history: true });
            } else clear();
          };
          if (!left) {
            left = 1;
            fin();
          }
          anims.forEach((a) => {
            a.onfinish = fin;
          });
          // animations stall while the page is not rendering — settle anyway
          window.setTimeout(() => {
            left = 1;
            fin();
          }, (o.duration as number) + 120);
        },
      },
      { capture: true },
    );
    return detach;
  }, [store]);

  // ── render ──
  const stack = store.stack;
  const topIdx = stack.length - 1;
  const items: Array<{ entry: Entry; depth: number; isTop: boolean; cls: string }> = [];
  stack.forEach((entry, i) => {
    if (i < topIdx - (MAX_MOUNTED - 1)) return;
    const cls = i === topIdx ? 'is-top' : i === topIdx - 1 ? 'is-under' : 'is-hidden';
    items.push({ entry, depth: i, isTop: i === topIdx, cls });
  });
  store.leaving.forEach(({ entry, mode, depth }) => {
    if (stack.some((e) => e.id === entry.id)) return;
    items.push({ entry, depth, isTop: false, cls: mode === 'pop' ? 'is-leaving' : 'is-under' });
  });
  items.sort((a, b) => a.entry.id - b.entry.id);

  return (
    <NavContext.Provider value={navProxy}>
      <StoreContext.Provider value={store}>
      <NavInternalContext.Provider value={internal}>
        <div className="ios-nav-stack" ref={containerRef}>
          {items.map((it) => (
            <StackItem
              key={it.entry.id}
              entry={it.entry}
              depth={it.depth}
              isTop={it.isTop}
              cls={it.cls}
              renderRoute={renderRoute}
              setEl={setEl}
            />
          ))}
        </div>
      </NavInternalContext.Provider>
      </StoreContext.Provider>
    </NavContext.Provider>
  );
}
