// Data side of the iOS MainView / GroupsStore for the mobile shell:
//  · reloadLists()  — GroupsStore.load(): /groups + /dms in parallel
//  · useShellSync() — mounted once by the global InAppBanner: reload groups + DMs, then unread, on EVERY
//    WebSocket connect (first one included); live DM ordering/preview (GroupsStore.apply) for every
//    message_created incl. own; refetch /dms when a DM is cleared; exposes queryClient + ws reconnect to
//    non-React helpers (create-server alert)
//  · create-server error slot (GroupsStore.errorText for create failures)
import { useEffect, useSyncExternalStore } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { groupsApi } from '../../../api/groups';
import { dmsApi, type DMItem } from '../../../api/dms';
import { notificationsApi } from '../../../api/notifications';
import { getWsStatus, onIncomingMessage, onMessagesCleared, onWsStatus, useWs } from '../../../hooks/useWebSocket';
import { useAuthStore } from '../../../store/authStore';
import { prefixGraphemes } from '../../ui/text';

// ───────────────────────────── shell context ─────────────────────────────

interface ShellCtx {
  qc: QueryClient;
  reconnect: () => void;
}
let shell: ShellCtx | null = null;

export function getShellCtx(): ShellCtx | null {
  return shell;
}

/** GroupsStore.load(): /groups and /dms in parallel (errors surface through the queries). */
export function reloadLists(qc: QueryClient): Promise<void> {
  return Promise.allSettled([
    qc.fetchQuery({ queryKey: ['groups'], queryFn: groupsApi.list, staleTime: 0 }),
    qc.fetchQuery({ queryKey: ['dms'], queryFn: dmsApi.list, staleTime: 0 }),
  ]).then(() => undefined);
}

export function reloadUnread(qc: QueryClient): Promise<void> {
  return qc
    .fetchQuery({ queryKey: ['unread'], queryFn: notificationsApi.getUnread, staleTime: 0 })
    .then(() => undefined, () => undefined);
}

/** DMs.applyingNewMessage: move the DM to the top, preview = trimmed content prefix(100) or null. */
function applyDmMessage(qc: QueryClient, chatId: string, content: string | null, createdAt: string) {
  qc.setQueryData<DMItem[]>(['dms'], (old) => {
    if (!Array.isArray(old)) return old;
    const i = old.findIndex((d) => d.chat_id === chatId);
    if (i < 0) return old;
    const trimmed = (content ?? '').trim();
    const dm: DMItem = { ...old[i], last_message: trimmed ? prefixGraphemes(trimmed, 100) : null, last_message_at: createdAt };
    return [dm, ...old.slice(0, i), ...old.slice(i + 1)];
  });
}

export function useShellSync(): void {
  const qc = useQueryClient();
  const { reconnect } = useWs();

  useEffect(() => {
    const ctx = { qc, reconnect };
    shell = ctx;
    return () => {
      if (shell === ctx) shell = null;
    };
  }, [qc, reconnect]);

  // iOS didLogin() starts the realtime connection. The shared WS provider only connects once, 1 s after
  // the app mounts — when the user signs in later (mobile login screen) no socket is ever opened and
  // "Соединение…" would stay forever. If there is still no socket when the shell appears, nudge the
  // provider through its foreground handler (it (re)connects whenever no socket is open).
  useEffect(() => {
    const nudge = () => {
      if (getWsStatus() === 'closed' && document.visibilityState === 'visible') {
        document.dispatchEvent(new Event('visibilitychange'));
      }
    };
    // The provider mounts before the shell and schedules its first connect at mount + 1 s, so after
    // 1.2 s that attempt has certainly run (no duplicate socket); 'closed' then means "no socket".
    const id = window.setTimeout(nudge, 1200);
    return () => window.clearTimeout(id);
  }, []);

  // iOS logout → realtime.disconnect(). The shared provider never closes its socket on logout (and the
  // backend keeps it open), so after sign-out + sign-in without a reload the new session would keep
  // receiving the PREVIOUS account's events (banners, cache updates) and the nudge above would see an
  // 'open' socket and do nothing. Close it whenever the signed-in account goes away or changes; the
  // provider's reconnect then runs with whatever token is current (none → no socket until next login).
  useEffect(
    () =>
      useAuthStore.subscribe((s, prev) => {
        const was = prev.user?.id ?? null;
        if (was && (s.user?.id ?? null) !== was) reconnect();
      }),
    [reconnect],
  );

  // AppEnvironment.onRealtimeConnected: coalesced groups+dms → unread reload on every connect
  useEffect(() => {
    let prev = getWsStatus();
    let token = 0;
    return onWsStatus(() => {
      const s = getWsStatus();
      if (s === 'open' && prev !== 'open') {
        const my = ++token;
        void reloadLists(qc).then(() => {
          if (my === token) return reloadUnread(qc);
        });
      }
      prev = s;
    });
  }, [qc]);

  // live DM list
  useEffect(
    () =>
      onIncomingMessage((e) => {
        applyDmMessage(qc, e.message.chat_id, e.message.content, e.message.created_at);
      }),
    [qc],
  );
  useEffect(
    () =>
      onMessagesCleared((e) => {
        const dms = qc.getQueryData<DMItem[]>(['dms']);
        if (Array.isArray(dms) && dms.some((d) => d.chat_id === e.chat_id)) {
          void qc.invalidateQueries({ queryKey: ['dms'] });
        }
      }),
    [qc],
  );
}

// ───────────────────────────── create-server error slot ─────────────────────────────

export interface HomeError {
  text: string;
  /** Date.now() when set — a later successful /groups load clears it (iOS errorText = nil). */
  at: number;
}

let createError: HomeError | null = null;
const errorListeners = new Set<() => void>();

export function setCreateServerError(text: string | null): void {
  createError = text ? { text, at: Date.now() } : null;
  errorListeners.forEach((l) => l());
}

export function useCreateServerError(): HomeError | null {
  return useSyncExternalStore(
    (fn) => {
      errorListeners.add(fn);
      return () => errorListeners.delete(fn);
    },
    () => createError,
    () => createError,
  );
}
