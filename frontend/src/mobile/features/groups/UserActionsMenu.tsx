// iOS UserActionsMenu (MembersPanelView.swift:7-45): a glass Menu anchored to the tapped
// row/avatar with «Открыть чат» (message) and «Позвонить» (phone.fill); hidden for yourself. Errors of
// POST /dms/with are silent.
import { dmsApi } from '../../../api/dms';
import { useAuthStore } from '../../../store/authStore';
import { queryClient } from './queryClientRef';
import { mobileNav } from '../../nav/NavStack';
import { present } from '../../present/PresentationProvider';
import { mt } from '../../i18n';
import { startDmCall } from '../voice/voiceActions';

export interface UserActionsTarget {
  id: string;
  username: string;
  display_name: string;
  image_path?: string | null;
}

/**
 * iOS UserActionsMenu: "Open chat" (opens/creates the DM and navigates) + "Call".
 * Hidden for yourself. `beforeNavigate` lets a hosting sheet dismiss itself first.
 */
export function openUserActions(
  anchor: HTMLElement,
  user: UserActionsTarget,
  opts?: { beforeNavigate?: () => Promise<void> },
): void {
  const me = useAuthStore.getState().user;
  if (!user?.id || user.id === me?.id) return;

  const openChat = async () => {
    let dm;
    try {
      dm = await dmsApi.openWith(user.id);
    } catch {
      return; // iOS: `try?` — silently ignored
    }
    if (dm.is_new) void queryClient()?.invalidateQueries({ queryKey: ['dms'] });
    // iOS env.navigate(to: .chat(chatId, title: peer.displayName)) — pushed on top of the current stack,
    // no groupId (DM chats never get the Members menu); the hosting sheet is dismissed afterwards.
    await opts?.beforeNavigate?.();
    mobileNav.navigate({ name: 'chat', chatId: dm.chat_id, title: dm.peer.display_name || dm.peer.username });
  };

  const call = async () => {
    let dm;
    try {
      dm = await dmsApi.openWith(user.id);
    } catch {
      return;
    }
    if (dm.is_new) void queryClient()?.invalidateQueries({ queryKey: ['dms'] });
    // close the hosting sheet BEFORE starting the call so the voice-room sheet can present
    await opts?.beforeNavigate?.();
    startDmCall({
      groupId: dm.group_id,
      peerName: dm.peer.display_name || dm.peer.username,
      peerImagePath: dm.peer.image_path || null,
    });
  };

  present.showMenu(anchor, [
    { label: mt('voice.openChat'), icon: 'message', onSelect: () => void openChat() },
    { label: mt('voice.call'), icon: 'phone.fill', onSelect: () => void call() },
  ]);
}
