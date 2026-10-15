// iOS notification pipeline for the mobile shell: a port of
// CordCore.NotificationGate + AppEnvironment.handleIncomingNotification / notificationText.
// Called by the global MessageNotifier on phones only (after its own-message
// check and 200-id dedupe).
//  · unknown group (new DM / server) → reload /groups (+ /dms) FIRST, then gate
//  · gate order: off → muted chat → personal (Saved) → level (dm_only / mentions_dm) → the chat is the
//    open top screen while the page is visible
//  · passes → in-app banner (always, independent of browser-notification permission) + sound
//    (notificationStore.sound) + an OS Notification only when enabled+granted and the page is hidden
import type { QueryClient } from '@tanstack/react-query';
import type { IncomingMessageEvent } from '../../../hooks/useWebSocket';
import { pushMobileBanner } from '../../../hooks/useUnreadCounts';
import { useNotificationStore } from '../../../store/notificationStore';
import { playNotificationSound } from '../../../utils/notificationSound';
import { groupsApi } from '../../../api/groups';
import type { Group, User } from '../../../types';
import { mobileNav } from '../../nav/NavStack';
import { mt } from '../../i18n';
import { graphemeCount, prefixGraphemes } from '../../ui/text';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `@username` with non-word boundaries, case-insensitive (NotificationGate.containsMention). */
export function containsMention(content: string | null | undefined, username: string): boolean {
  if (!content || !username) return false;
  return new RegExp(`(^|[^A-Za-z0-9_])@${escapeRegExp(username)}(?![A-Za-z0-9_])`, 'i').test(content);
}

/** iOS `activeChatId`: the chat screen on top of the navigation stack (sheets over it keep it active). */
export function isActiveMobileChat(chatId: string): boolean {
  const stack = mobileNav.stack;
  const top = stack[stack.length - 1];
  return !!top && top.name === 'chat' && top.chatId === chatId;
}

/** AppEnvironment.notificationText: title "author · server" / "author", body rules in iOS order. */
export function notificationText(
  msg: IncomingMessageEvent['message'],
  group: Group | undefined,
  mentioned: boolean,
): { title: string; body: string; author: string; routeTitle: string } {
  const author = msg.author_display_name || msg.author_username || '';
  const isDm = !!group?.is_dm;
  const title = !isDm && group?.name ? `${author} · ${group.name}` : author;
  let body = (msg.content ?? '').replace(/\s+/g, ' ').trim();
  if (!body && msg.attachments?.length) body = `📎 ${mt('notifications.attachment')}`;
  if (graphemeCount(body) > 140) body = `${prefixGraphemes(body, 139)}…`;
  if (mentioned && body) body = `✳ ${body}`;
  const routeTitle = isDm ? author : group?.name ?? author;
  return { title, body, author, routeTitle };
}

export async function handleMobileIncoming(event: IncomingMessageEvent, me: User, qc: QueryClient): Promise<void> {
  const msg = event.message;
  let groups = qc.getQueryData<Group[]>(['groups']) ?? [];
  if (!groups.some((g) => g.id === event.group_id)) {
    // Unknown group: before the reload the gate would treat a brand-new DM as a channel.
    try {
      groups = await qc.fetchQuery({ queryKey: ['groups'], queryFn: groupsApi.list, staleTime: 0 });
    } catch {
      /* keep the old list */
    }
    void qc.invalidateQueries({ queryKey: ['dms'] });
  }
  const group = groups.find((g) => g.id === event.group_id);
  const settings = useNotificationStore.getState();
  const mentioned = containsMention(msg.content, me.username);
  const isDm = !!group?.is_dm;

  if (settings.level === 'off') return;
  if (settings.mutedChats[msg.chat_id]) return;
  if (group?.is_personal) return;
  if (settings.level === 'dm_only' && !isDm) return;
  if (settings.level === 'mentions_dm' && !isDm && !mentioned) return;
  const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
  if (visible && isActiveMobileChat(msg.chat_id)) return;

  const { title, body, author, routeTitle } = notificationText(msg, group, mentioned);
  const route = { name: 'chat' as const, chatId: msg.chat_id, title: routeTitle, groupId: event.group_id };

  pushMobileBanner({
    title,
    body,
    avatar: msg.author_image_path || null,
    authorName: author,
    chatId: msg.chat_id,
    groupId: event.group_id,
    routeTitle,
  });

  if (settings.sound) playNotificationSound(settings.soundVolume);

  // OS notification only while the page is hidden (the in-app banner covers the foreground).
  if (
    !visible &&
    settings.browserEnabled &&
    typeof Notification !== 'undefined' &&
    Notification.permission === 'granted'
  ) {
    try {
      const n = new Notification(title, {
        body,
        icon: msg.author_image_path || '/logo.png',
        tag: `msg-${msg.chat_id}`,
        requireInteraction: mentioned,
      });
      n.onclick = () => {
        window.focus();
        mobileNav.navigate(route);
        n.close();
      };
      setTimeout(() => n.close(), mentioned ? 60_000 : 10_000);
    } catch {
      /* quota / permission */
    }
  }
}
