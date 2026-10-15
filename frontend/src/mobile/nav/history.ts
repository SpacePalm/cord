// Browser-history integration shared by the nav stack and the presentation layer.
// Every pushed screen and every presented modal owns one history entry
// (same URL, state `{ ...routerState, cordIos: { sid, pos } }`), so the browser / Android back
// button pops the top-most thing first. Programmatic closes drop their entry with history.go(-n);
// history.go() is asynchronous, so all browser operations are serialised through a queue.

export interface HistoryOwner {
  active: boolean;
}

interface HEntry {
  id: number;
  owner: HistoryOwner;
  /** Called when the USER removed this entry (back button / gesture / browser back). */
  onPop: () => void;
  /** Closed programmatically; its browser entry is skipped/removed. */
  dead: boolean;
}

type Op = { t: 'push'; pos: number } | { t: 'go'; delta: number };

const SID = Math.random().toString(36).slice(2, 10);
const entries: HEntry[] = [];
const queue: Op[] = [];
let nextId = 1;
let listening = 0; // installed (active) owners
let attached = false; // popstate listener registered
let waiting: number | null = null; // timer while our own history.go() is in flight
let rewinding = false;
/** An owner was installed on an empty registry while one of our go() was in flight: rebase on landing. */
let rebaseOnLand = false;
let lastUserPopAt = -1e9;

interface CordState {
  cordIos?: { sid: string; pos: number };
}

function readPos(state: unknown): number | null {
  const c = (state as CordState | null)?.cordIos;
  return c && c.sid === SID ? c.pos : null;
}

function stateFor(pos: number): object {
  const cur = (window.history.state ?? {}) as Record<string, unknown>;
  return { ...cur, cordIos: { sid: SID, pos } };
}

function markBase(): void {
  try {
    window.history.replaceState(stateFor(0), '');
  } catch {
    /* ignore */
  }
}

/** The popstate listener stays registered while an owner is installed or one of our go() is in flight. */
function syncListener(): void {
  const need = listening > 0 || waiting !== null;
  if (need && !attached) window.addEventListener('popstate', onPopState);
  else if (!need && attached) window.removeEventListener('popstate', onPopState);
  attached = need;
}

function startGo(delta: number): void {
  waiting = window.setTimeout(() => {
    // popstate never arrived (nothing to go back to…) — carry on.
    waiting = null;
    landed();
  }, 700);
  syncListener();
  window.history.go(delta);
}

/** One of our own history.go() traversals has landed (or timed out). */
function landed(): void {
  if (rewinding) {
    rewinding = false;
    rebaseOnLand = false;
    markBase();
  } else if (rebaseOnLand) {
    // The in-flight go() was not a rewind (e.g. a trim of the previous shell): positions of the new owner's
    // queued pushes count from the base entry, so step back to it first.
    rebaseOnLand = false;
    const pos = readPos(window.history.state) ?? 0;
    if (pos > 0) {
      rewinding = true;
      startGo(-pos);
      return;
    }
    markBase();
  }
  flush();
  if (listening === 0 && waiting === null) rewindIfIdle();
}

/**
 * No owner is installed any more (the mobile shell unmounted for good: window widened to desktop,
 * logout…). Our pushed entries would stay behind as dead same-URL entries (Back would do nothing
 * visible), so step back over them to the base entry while the browser still shows one of them. If the
 * router already moved to another entry (route change), it is left alone (a go() would fight the router);
 * stale entries of ours below it are skipped by the next mobile shell.
 */
function rewindIfIdle(): void {
  entries.length = 0;
  queue.length = 0;
  rebaseOnLand = false;
  if (waiting !== null) return; // landed() comes back here
  const pos = readPos(window.history.state) ?? 0;
  if (pos > 0) {
    rewinding = true;
    startGo(-pos);
    return;
  }
  syncListener();
}

function flush(): void {
  while (waiting === null && queue.length) {
    const op = queue.shift()!;
    if (op.t === 'push') {
      try {
        window.history.pushState(stateFor(op.pos), '');
      } catch {
        /* SecurityError when called too often — ignore */
      }
    } else if (op.delta !== 0) {
      startGo(op.delta);
    }
  }
}

function enqueueGo(delta: number): void {
  // A not-yet-executed push followed by go(-1) cancels out.
  while (delta < 0 && queue.length && queue[queue.length - 1].t === 'push') {
    queue.pop();
    delta += 1;
  }
  if (delta === 0) return;
  const last = queue[queue.length - 1];
  if (last && last.t === 'go') last.delta += delta;
  else queue.push({ t: 'go', delta });
}

/** Drop trailing dead entries (programmatically closed) from the browser history. */
function trim(): void {
  let k = 0;
  while (entries.length && entries[entries.length - 1].dead) {
    entries.pop();
    k += 1;
  }
  if (k) enqueueGo(-k);
}

function onPopState(e: PopStateEvent): void {
  if (waiting !== null) {
    // Result of our own history.go().
    window.clearTimeout(waiting);
    waiting = null;
    landed();
    return;
  }
  if (listening === 0) return;
  const target = readPos(e.state) ?? 0;
  if (target > entries.length) {
    // Landed on a stale entry (forward button, or entries of an unmounted owner): skip back.
    startGo(entries.length - target);
    return;
  }
  if (target === entries.length) return;
  lastUserPopAt = performance.now();
  const popped = entries.splice(target);
  for (let i = popped.length - 1; i >= 0; i--) {
    const p = popped[i];
    if (!p.dead && p.owner.active) {
      try {
        p.onPop();
      } catch (err) {
        console.error(err);
      }
    }
  }
  trim();
  flush();
}

export function createHistoryOwner(): HistoryOwner {
  return { active: false };
}

/**
 * Start using history for `owner` (NavStackProvider / PresentationProvider). Returns the cleanup.
 * StrictMode-safe: a cleanup immediately followed by a re-install keeps the owner's entries.
 */
export function installHistory(owner: HistoryOwner): () => void {
  owner.active = true;
  listening++;
  syncListener();
  if (entries.length === 0 && queue.length === 0 && waiting !== null) {
    if (!rewinding) rebaseOnLand = true;
  } else if (entries.length === 0 && queue.length === 0) {
    const pos = (window.history.state as CordState | null)?.cordIos?.pos ?? 0;
    if (pos > 0) {
      // Reload / remount while deep inside stale entries of ours: rewind to the base entry.
      rewinding = true;
      startGo(-pos);
    } else {
      markBase();
    }
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    owner.active = false;
    listening--;
    window.setTimeout(() => {
      if (owner.active) return; // StrictMode re-mount
      // The owner is gone for good: forget its entries (their browser entries become stale and are
      // skipped by onPopState).
      for (let i = entries.length - 1; i >= 0; i--) if (entries[i].owner === owner) entries.splice(i, 1);
      // …and when it was the last one, rewind the browser history over what we pushed.
      if (listening === 0) rewindIfIdle();
    }, 0);
  };
}

/** Add a history entry above everything. `onPop` runs when the user navigates back over it. */
export function historyPush(owner: HistoryOwner, onPop: () => void): number {
  const id = nextId++;
  entries.push({ id, owner, onPop, dead: false });
  queue.push({ t: 'push', pos: entries.length });
  flush();
  return id;
}

/** Programmatic close: forget the entry (and drop it from the browser history when on top). */
export function historyRemove(id: number | null | undefined): void {
  if (id == null) return;
  const e = entries.find((x) => x.id === id);
  if (!e || e.dead) return;
  e.dead = true;
  trim();
  flush();
}

/**
 * Forget an entry WITHOUT touching the browser history (its owner is being torn down together with a
 * route change, where a history.go() would fight the router). The stale browser entry is skipped later.
 */
export function historyForget(id: number | null | undefined): void {
  if (id == null) return;
  const i = entries.findIndex((x) => x.id === id);
  if (i >= 0) entries.splice(i, 1);
}

/** Is the entry still live (not popped by the user / not removed)? */
export function historyAlive(id: number | null | undefined): boolean {
  if (id == null) return false;
  const e = entries.find((x) => x.id === id);
  return !!e && !e.dead;
}

/** ms since the last user-initiated history pop (browser back / Android back / native swipe). */
export function msSinceUserPop(): number {
  return performance.now() - lastUserPopAt;
}
