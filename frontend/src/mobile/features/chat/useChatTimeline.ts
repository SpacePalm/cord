// Chat timeline data hook — port of iOS ChatStore (Cord/Stores/ChatStore.swift).
// Data model (see timelineCache.ts): every loaded server message lives in react-query
// ['messages', chatId] (first page fetched by this hook, older pages / jump windows merged in, WS keeps
// it live). The hook decides which slice is shown:
//   · normal mode — the contiguous tail: messages with created_at ≥ tail.startMs;
//   · jump-window mode (iOS hasMoreNewer) — messages inside [win.fromMs, win.toMs] (+ own messages
//     sent while in the window, like iOS appending them at the end of the window).
// Optimistic messages (sending / failed / retry, upload progress) live in local state only.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Message } from '../../../types';
import { messagesApi } from '../../../api/messages';
import { ApiError } from '../../../api/client';
import { useAuthStore } from '../../../store/authStore';
import { PAGE, cmpMessages, isoPlusEpsilon, isSortedAsc, mergeInto, mergeLatest, patchMessage, tsOf } from './timelineCache';

export interface PendingItem {
  localId: string;
  /** Optimistic placeholder: me as author, trimmed text (or null), device time, nothing else. */
  msg: Message;
  state: 'sending' | 'failed';
  /** 0…1 upload progress when the message carries attachments. */
  progress?: number;
  payload: { text: string; files: File[]; replyToId?: string };
  /** Newest server message (ms) when the send started — used to recognise the WS echo. */
  sinceMs: number;
}

/** Error line above the composer: an iOS string key or a server-provided detail. */
export type TimelineError = { key: string; text?: undefined; source: string } | { text: string; key?: undefined; source: string };

export interface ScrollTarget {
  id: string;
  seq: number;
}

export interface JumpTarget {
  id: string;
  createdAt: string;
  /** Full message when known (chat search / pinned) — inserted into the window directly. */
  msg?: Message;
}

interface TailState {
  /** Lower bound of the contiguous tail; null = everything cached (before the first load). */
  startMs: number | null;
  hasMoreOlder: boolean;
}

interface WindowState {
  fromMs: number;
  toMs: number;
  hasMoreOlder: boolean;
}

const EMPTY_SET: ReadonlySet<string> = new Set();
const mountedCount = new Map<string, number>();
let seqCounter = 0;

function messagesKey(chatId: string) {
  return ['messages', chatId] as const;
}

/** iOS `APIError.displayDetail ?? default` (server detail string when there is one). */
export function errorLine(e: unknown, fallbackKey: string, source: string): TimelineError {
  if (e instanceof ApiError) {
    const d = e.detail;
    if (typeof d === 'string' && d.trim() && d !== 'Unknown error' && d !== 'Request failed') return { text: d, source };
  }
  return { key: fallbackKey, source };
}

function initTail(data: Message[] | undefined): TailState {
  if (data && data.length) return { startMs: tsOf(data[0]), hasMoreOlder: data.length >= PAGE };
  return { startMs: null, hasMoreOlder: true };
}

function uuid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    /* insecure context */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function dedupe(list: Message[]): Message[] {
  const seen = new Set<string>();
  const out: Message[] = [];
  for (const m of list) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

export function useChatTimeline(chatId: string, opts?: { onSent?: () => void }) {
  const qc = useQueryClient();
  const myId = useAuthStore((s) => s.user?.id);
  const key = useMemo(() => messagesKey(chatId), [chatId]);

  const [tail, setTail] = useState<TailState>(() => initTail(qc.getQueryData<Message[]>(messagesKey(chatId))));
  const [win, setWin] = useState<WindowState | null>(null);
  const [extraIds, setExtraIds] = useState<ReadonlySet<string>>(EMPTY_SET);
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetSeq, setResetSeq] = useState(0);
  const [unreadAnchor, setUnreadAnchor] = useState<string | null>(null);
  const [stateLoaded, setStateLoaded] = useState(false);
  const [error, setError] = useState<TimelineError | null>(null);
  const [scrollTarget, setScrollTarget] = useState<ScrollTarget | null>(null);

  const aliveRef = useRef(true);
  const onSentRef = useRef(opts?.onSent);
  onSentRef.current = opts?.onSent;

  // ── mount bookkeeping: trim the cache back to the latest page when the last screen leaves ──
  useEffect(() => {
    aliveRef.current = true;
    mountedCount.set(chatId, (mountedCount.get(chatId) ?? 0) + 1);
    return () => {
      aliveRef.current = false;
      const n = (mountedCount.get(chatId) ?? 1) - 1;
      if (n > 0) {
        mountedCount.set(chatId, n);
        return;
      }
      mountedCount.delete(chatId);
      const k = messagesKey(chatId);
      const st = qc.getQueryState(k);
      const data = qc.getQueryData<Message[]>(k);
      if (data && data.length > PAGE) qc.setQueryData(k, data.slice(-PAGE), { updatedAt: st?.dataUpdatedAt });
    };
  }, [qc, chatId]);

  // ── first page (WS keeps it live; refetches merge instead of replacing history) ──
  const onGapRef = useRef<(latest: Message[]) => void>(() => undefined);
  onGapRef.current = (latest) => {
    if (!aliveRef.current) return;
    let min = Infinity;
    for (const m of latest) min = Math.min(min, tsOf(m));
    setTail({ startMs: latest.length ? min : null, hasMoreOlder: latest.length >= PAGE });
  };
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const latest = await messagesApi.list(chatId, undefined, undefined, PAGE);
      const prev = qc.getQueryData<Message[]>(messagesKey(chatId));
      const r = mergeLatest(prev, latest);
      if (!r.contiguous) onGapRef.current(latest);
      return r.data;
    },
    staleTime: 30_000,
  });
  const data = query.data;

  // load error → error line (cleared by the next successful load)
  useEffect(() => {
    if (query.isError && !query.data) setError(errorLine(query.error, 'chat.loadFailed', 'load'));
  }, [query.isError, query.error, query.data]);
  useEffect(() => {
    if (query.isSuccess) setError((e) => (e && e.source === 'load' ? null : e));
  }, [query.isSuccess, query.dataUpdatedAt]);

  // ── unread anchor: last_read_at captured once at open (never cleared while the screen lives) ──
  useEffect(() => {
    let cancelled = false;
    setStateLoaded(false);
    messagesApi
      .state(chatId)
      .then((s) => {
        if (!cancelled) setUnreadAnchor(s?.last_read_at ?? null);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setStateLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [chatId]);

  // ── what is shown ──
  const shown = useMemo<Message[]>(() => {
    if (!data || resetting) return [];
    let list: Message[];
    if (win) {
      list = data.filter((m) => {
        const x = tsOf(m);
        return (x >= win.fromMs && x <= win.toMs) || extraIds.has(m.id);
      });
    } else if (tail.startMs != null) {
      const s = tail.startMs;
      list = data.filter((m) => tsOf(m) >= s);
    } else list = data;
    return isSortedAsc(list) ? list : [...list].sort(cmpMessages);
  }, [data, win, extraIds, tail.startMs, resetting]);

  // optimistic rows; a "sending" row hides as soon as its WS echo is on screen (iOS shows both — glitch)
  const visiblePending = useMemo<PendingItem[]>(() => {
    if (!pending.length) return pending;
    const claimed = new Set<string>();
    return pending.filter((p) => {
      if (p.state !== 'sending') return true;
      for (let i = shown.length - 1; i >= 0; i--) {
        const m = shown[i];
        if (tsOf(m) <= p.sinceMs) break;
        if (claimed.has(m.id) || m.author_id !== p.msg.author_id) continue;
        if ((m.content ?? '').trim() !== p.payload.text) continue;
        if ((m.attachments?.length ?? 0) !== p.payload.files.length) continue;
        claimed.add(m.id);
        return false;
      }
      return true;
    });
  }, [pending, shown]);

  const shownRef = useRef(shown);
  shownRef.current = shown;
  const winRef = useRef(win);
  winRef.current = win;
  const tailRef = useRef(tail);
  tailRef.current = tail;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const loadingOlderRef = useRef(false);
  /** Bumped whenever the shown slice is re-based (jump window / back to latest): late responses of an
   *  earlier view must not extend the new one (they would splice a hole into the tail / window). */
  const viewGen = useRef(0);

  const hasMoreOlder = win ? win.hasMoreOlder : tail.hasMoreOlder;
  const hasMoreNewer = !!win;

  // ── history (top pagination) ──
  const loadOlder = useCallback(async () => {
    if (loadingOlderRef.current) return;
    const first = shownRef.current[0];
    const more = winRef.current ? winRef.current.hasMoreOlder : tailRef.current.hasMoreOlder;
    if (!first || !more) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const gen = viewGen.current;
    try {
      const older = await messagesApi.list(chatId, first.created_at, undefined, PAGE);
      if (!aliveRef.current || gen !== viewGen.current) return;
      let start = tsOf(first);
      for (const m of older) start = Math.min(start, tsOf(m));
      qc.setQueryData<Message[]>(key, (prev) => mergeInto(prev, older));
      const more2 = older.length >= PAGE;
      if (winRef.current) setWin((w) => (w ? { ...w, fromMs: Math.min(w.fromMs, start), hasMoreOlder: more2 } : w));
      else setTail((t) => ({ startMs: t.startMs == null ? start : Math.min(t.startMs, start), hasMoreOlder: more2 }));
    } catch {
      // silent (iOS: no noise for history pages)
    } finally {
      loadingOlderRef.current = false;
      if (aliveRef.current) setLoadingOlder(false);
    }
  }, [chatId, key, qc]);

  // ── jump to a message (search / pinned / route / reply line) ──
  const jumpTo = useCallback(
    async (target: JumpTarget) => {
      if (shownRef.current.some((m) => m.id === target.id)) {
        setScrollTarget({ id: target.id, seq: ++seqCounter });
        return true;
      }
      const beforeCursor = target.msg ? target.createdAt : isoPlusEpsilon(target.createdAt);
      const gen = ++viewGen.current;
      try {
        const [b, a] = await Promise.all([
          messagesApi.list(chatId, beforeCursor, undefined, PAGE),
          messagesApi.list(chatId, undefined, target.createdAt, PAGE),
        ]);
        if (!aliveRef.current || gen !== viewGen.current) return false;
        const windowMsgs = dedupe([...b, ...(target.msg ? [target.msg] : []), ...a]).sort(cmpMessages);
        if (!windowMsgs.length) return false;
        qc.setQueryData<Message[]>(key, (prev) => mergeInto(prev, windowMsgs));
        const fromMs = tsOf(windowMsgs[0]);
        const toMs = tsOf(windowMsgs[windowMsgs.length - 1]);
        const olderMore = b.length >= PAGE;
        setExtraIds(EMPTY_SET);
        if (a.length >= PAGE) setWin({ fromMs, toMs, hasMoreOlder: olderMore });
        else {
          // the window reaches the newest message → it IS the tail
          setWin(null);
          setTail({ startMs: fromMs, hasMoreOlder: olderMore });
        }
      } catch {
        return false; // silent (iOS)
      }
      await sleep(60);
      if (aliveRef.current && gen === viewGen.current) setScrollTarget({ id: target.id, seq: ++seqCounter });
      return true;
    },
    [chatId, key, qc],
  );

  /** Scroll to an already loaded message (reply-line tap). False when it is not loaded. */
  const revealLoaded = useCallback((id: string) => {
    if (!shownRef.current.some((m) => m.id === id)) return false;
    setScrollTarget({ id, seq: ++seqCounter });
    return true;
  }, []);

  const consumeScrollTarget = useCallback(() => setScrollTarget(null), []);

  // ── back to the latest page (iOS jumpToLatest: clear → spinner → loadInitial) ──
  const jumpToLatest = useCallback(async () => {
    const gen = ++viewGen.current;
    setWin(null);
    setExtraIds(EMPTY_SET);
    setResetting(true);
    try {
      const [latest, st] = await Promise.all([
        messagesApi.list(chatId, undefined, undefined, PAGE),
        messagesApi.state(chatId).catch(() => null),
      ]);
      if (!aliveRef.current || gen !== viewGen.current) return;
      const page = [...latest].sort(cmpMessages);
      const last = page.length ? tsOf(page[page.length - 1]) : -Infinity;
      const ids = new Set(page.map((m) => m.id));
      qc.setQueryData<Message[]>(key, (prev) => [...page, ...(prev ?? []).filter((m) => !ids.has(m.id) && tsOf(m) > last)]);
      setTail({ startMs: page.length ? tsOf(page[0]) : null, hasMoreOlder: page.length >= PAGE });
      setUnreadAnchor(st?.last_read_at ?? null);
      setError(null);
    } catch (e) {
      if (aliveRef.current && gen === viewGen.current) setError(errorLine(e, 'chat.loadFailed', 'load'));
    } finally {
      if (aliveRef.current) {
        setResetting(false);
        setResetSeq((s) => s + 1);
      }
    }
  }, [chatId, key, qc]);

  // ── optimistic send ──
  const send = useCallback(
    async (text: string, files: File[], replyToId?: string) => {
      const trimmed = text.trim();
      if (!trimmed && files.length === 0) return;
      const me = useAuthStore.getState().user;
      const localId = `local-${uuid()}`;
      const cached = qc.getQueryData<Message[]>(key) ?? [];
      let sinceMs = 0;
      for (const m of cached) sinceMs = Math.max(sinceMs, tsOf(m));
      if (me) {
        const now = new Date().toISOString();
        const msg: Message = {
          id: localId,
          content: trimmed || null,
          author_id: me.id,
          author_username: me.username,
          author_display_name: me.display_name,
          author_image_path: me.image_path,
          chat_id: chatId,
          is_edited: false,
          is_pinned: false,
          created_at: now,
          updated_at: now,
          attachments: [],
          embeds: [],
          forwarded_from: null,
          reply_to: null,
          poll: null,
          reactions: [],
        };
        const item: PendingItem = {
          localId,
          msg,
          state: 'sending',
          progress: files.length ? 0 : undefined,
          payload: { text: trimmed, files, replyToId },
          sinceMs,
        };
        setPending((p) => [...p, item]);
      }
      const onProgress = files.length
        ? (pct: number) => {
            const v = Math.max(0, Math.min(1, pct / 100));
            setPending((p) => p.map((x) => (x.localId === localId ? { ...x, progress: Math.max(x.progress ?? 0, v) } : x)));
          }
        : undefined;
      try {
        const sent = await messagesApi.send(chatId, trimmed, files, replyToId, undefined, onProgress);
        qc.setQueryData<Message[]>(key, (prev) => mergeInto(prev, [sent]));
        if (aliveRef.current) {
          if (winRef.current) setExtraIds((s) => new Set(s).add(sent.id));
          setPending((p) => p.filter((x) => x.localId !== localId));
        }
        onSentRef.current?.();
      } catch {
        if (aliveRef.current) setPending((p) => p.map((x) => (x.localId === localId ? { ...x, state: 'failed' } : x)));
      }
    },
    [chatId, key, qc],
  );

  /** Failed row → resend (web keeps the attachments / reply target; iOS resends text only). */
  const retry = useCallback(
    (localId: string) => {
      const item = pendingRef.current.find((p) => p.localId === localId && p.state === 'failed');
      if (!item) return;
      setPending((p) => p.filter((x) => x.localId !== localId));
      void send(item.payload.text, item.payload.files, item.payload.replyToId);
    },
    [send],
  );

  const patch = useCallback((msg: Message) => qc.setQueryData<Message[]>(key, (prev) => patchMessage(prev, msg)), [key, qc]);
  const dropIds = useCallback(
    (ids: Iterable<string>) => {
      const set = new Set(ids);
      qc.setQueryData<Message[]>(key, (prev) => (prev ? prev.filter((m) => !set.has(m.id)) : prev));
    },
    [key, qc],
  );

  const edit = useCallback(
    async (messageId: string, content: string) => {
      const text = content.trim();
      if (!text) return;
      try {
        patch(await messagesApi.edit(chatId, messageId, text));
      } catch (e) {
        if (aliveRef.current) setError(errorLine(e, 'chat.editFailed', 'edit'));
      }
    },
    [chatId, patch],
  );

  /** Single delete: no confirmation (iOS); optimistic rows are simply dropped. Errors silent. */
  const remove = useCallback(
    async (messageId: string) => {
      if (messageId.startsWith('local-')) {
        setPending((p) => p.filter((x) => x.localId !== messageId));
        return;
      }
      try {
        await messagesApi.delete(chatId, messageId);
        dropIds([messageId]);
      } catch {
        // WS message_deleted cleans up if it went through
      }
    },
    [chatId, dropIds],
  );

  const bulkDelete = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return false;
      try {
        await messagesApi.deleteBulk(chatId, ids);
        dropIds(ids);
        return true;
      } catch (e) {
        if (aliveRef.current) setError(errorLine(e, 'chat.deleteFailed', 'delete'));
        return false;
      }
    },
    [chatId, dropIds],
  );

  const react = useCallback(
    async (messageId: string, emoji: string) => {
      if (messageId.startsWith('local-')) return;
      try {
        patch(await messagesApi.react(chatId, messageId, emoji));
      } catch {
        // silent
      }
    },
    [chatId, patch],
  );

  const togglePin = useCallback(
    async (msg: Message) => {
      if (msg.id.startsWith('local-')) return;
      try {
        const updated = msg.is_pinned ? await messagesApi.unpin(chatId, msg.id) : await messagesApi.pin(chatId, msg.id);
        const next: Message = updated && (updated as Message).id ? (updated as Message) : { ...msg, is_pinned: !msg.is_pinned };
        patch(next);
        // keep the pinned list (PinnedSheet / desktop header) in sync before the refetch lands
        qc.setQueryData<Message[]>(['pinned', chatId], (old) => {
          if (!old) return old;
          const rest = old.filter((m) => m.id !== next.id);
          return next.is_pinned ? [next, ...rest] : rest;
        });
      } catch {
        // silent; WS message_edited also updates is_pinned
      }
      void qc.invalidateQueries({ queryKey: ['pinned', chatId] });
    },
    [chatId, patch, qc],
  );

  const sendPoll = useCallback(
    async (question: string, options: string[]) => {
      const q = question.trim();
      const opts = options.map((o) => o.trim()).filter(Boolean);
      if (!q || opts.length < 2) return;
      try {
        const sent = await messagesApi.send(chatId, '', [], undefined, { question: q, options: opts });
        qc.setQueryData<Message[]>(key, (prev) => mergeInto(prev, [sent]));
        if (aliveRef.current && winRef.current) setExtraIds((s) => new Set(s).add(sent.id));
        onSentRef.current?.();
      } catch (e) {
        if (aliveRef.current) setError(errorLine(e, 'chat.pollFailed', 'poll'));
      }
    },
    [chatId, key, qc],
  );

  return {
    myId,
    /** Server messages on screen (chronological). */
    messages: shown,
    /** Optimistic rows on screen (after the server messages). */
    pending: visiblePending,
    isLoadingInitial: resetting || (!data && query.isPending),
    /** First page and the unread anchor are both settled (iOS: after loadInitial). */
    ready: !!data && stateLoaded && !resetting,
    hasMoreOlder,
    hasMoreNewer,
    loadingOlder,
    unreadAnchor,
    error,
    resetSeq,
    scrollTarget,
    consumeScrollTarget,
    loadOlder,
    jumpTo,
    revealLoaded,
    jumpToLatest,
    send,
    retry,
    edit,
    remove,
    bulkDelete,
    react,
    togglePin,
    sendPoll,
  };
}

export type ChatTimelineApi = ReturnType<typeof useChatTimeline>;
