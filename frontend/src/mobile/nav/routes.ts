// Every screen that can be pushed onto the mobile navigation stack (iOS MainView NavigationStack).
// Sheets/alerts/menus are NOT routes — they are presented via usePresent().

export type AdminTab = 'users' | 'servers' | 'security' | 'system';

export type Route =
  | { name: 'home' }
  | { name: 'channels'; groupId: string }
  | {
      name: 'chat';
      chatId: string;
      /** Nav-bar title (channel name, DM peer name, or server name for banner taps — as iOS). */
      title: string;
      /** Owning group, when known (enables @mentions, Members, owner-delete). */
      groupId?: string;
      /** Open the chat scrolled to this message (search results, pinned, notifications). */
      jumpTo?: { messageId: string; createdAt: string };
    }
  | { name: 'settings' }
  | { name: 'settings.profile' }
  | { name: 'settings.status' }
  | { name: 'settings.password' }
  | { name: 'settings.sessions' }
  | { name: 'settings.notifications' }
  | { name: 'settings.appearance' }
  | { name: 'settings.language' }
  | { name: 'settings.storage' }
  /** Web-only extra (iOS has no audio/camera settings screen): mic/speaker/camera devices. */
  | { name: 'settings.voiceVideo' }
  | { name: 'admin'; tab?: AdminTab };

export type RouteName = Route['name'];

/** Stable key for a route instance (used for keep-alive / scroll restoration). */
export function routeKey(r: Route): string {
  switch (r.name) {
    case 'channels':
      return `channels:${r.groupId}`;
    case 'chat':
      return `chat:${r.chatId}`;
    default:
      return r.name;
  }
}
