// The one mobile logout path (iOS `AppEnvironment.logout`), shared by Settings → "Выйти" and the quick
// switcher's "Выйти" action so both clear exactly the same state.
import type { QueryClient } from '@tanstack/react-query';
import { authApi } from '../../../api/auth';
import { useAuthStore } from '../../../store/authStore';
import { useSessionStore } from '../../../store/sessionStore';
import { clearMediaCache } from '../media/mediaCache';
import { resetVoice } from '../voice/voiceActions';

/**
 * voice.reset() (leave the call / DM cancel while the token is still valid, stop ringing, drop the call
 * card) → revoke the refresh session on the server → clear the tokens → drop the media cache → `/login`
 * (when a router `navigate` is given; otherwise ProtectedRoute redirects) → clear the react-query cache once
 * the shell has unmounted (no live observers left that would refetch without a token).
 */
export function performMobileLogout(qc: QueryClient, navigate?: (to: string, opts?: { replace?: boolean }) => void): void {
  // before the tokens go: /voice/leave and the DM-call cancel must still be authorised
  resetVoice();
  const session = useSessionStore.getState();
  if (session.voicePresence) session.leaveVoice();
  const rt = localStorage.getItem('refresh_token');
  if (rt) authApi.logoutOnServer(rt).catch(() => {});
  useAuthStore.getState().logout();
  void clearMediaCache();
  navigate?.('/login', { replace: true });
  window.setTimeout(() => qc.clear(), 0);
}
