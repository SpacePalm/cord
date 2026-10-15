// Mobile shell: MobileRoot + NavStack (root "home") + global
// overlays, and bridges from the shared sessionStore UI flags (set by desktop-shared code such as
// notifications / CommandPalette helpers) to their iOS presentations.
import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { MobileRoot } from './MobileRoot';
import { NavStackProvider, mobileNav } from './nav/NavStack';
import { renderRoute } from './nav/registry';
import type { Route } from './nav/routes';
import { InAppBanner } from './features/home/InAppBanner';
import { MobileVoiceHost } from './features/voice/MobileVoiceHost';
import { openQuickSwitcher } from './features/search/QuickSwitcherSheet';
import { openAdvancedSearch } from './features/search/AdvancedSearchSheet';
import { openCreateServerAlert } from './features/home/createServer';
import { useSessionStore } from '../store/sessionStore';
import type { Chat } from '../types';
import type { DMItem } from '../api/dms';

/** desktop SettingsModal tab → iOS settings sub-screen */
const SETTINGS_TAB_ROUTE: Record<string, Route> = {
  profile: { name: 'settings.profile' },
  status: { name: 'settings.status' },
  password: { name: 'settings.password' },
  sessions: { name: 'settings.sessions' },
  security: { name: 'settings.sessions' },
  notifications: { name: 'settings.notifications' },
  appearance: { name: 'settings.appearance' },
  language: { name: 'settings.language' },
  storage: { name: 'settings.storage' },
  audio: { name: 'settings.voiceVideo' },
  voice: { name: 'settings.voiceVideo' },
};

/** Channel / DM display name from the react-query cache (['chats', groupId] / ['dms']). */
function chatTitle(qc: QueryClient, chatId: string): string {
  for (const [, data] of qc.getQueriesData<Chat[]>({ queryKey: ['chats'] })) {
    const c = Array.isArray(data) ? data.find((x) => x?.id === chatId) : undefined;
    if (c) return c.name;
  }
  const dms = qc.getQueryData<DMItem[]>(['dms']);
  const dm = Array.isArray(dms) ? dms.find((d) => d.chat_id === chatId) : undefined;
  return dm?.peer.display_name ?? '';
}

function useSessionBridges() {
  const qc = useQueryClient();
  useEffect(() => {
    const handle = (s: ReturnType<typeof useSessionStore.getState>) => {
      if (s.uiPaletteOpen) {
        s.closePalette();
        openQuickSwitcher();
      }
      if (s.uiAdvancedSearchOpen) {
        const q = (s as { advancedInitialQuery?: string }).advancedInitialQuery;
        s.closeAdvancedSearch();
        openAdvancedSearch(q || undefined);
      }
      if (s.uiSettingsOpen) {
        const tab = s.uiSettingsTab;
        s.closeSettings();
        const sub = tab ? SETTINGS_TAB_ROUTE[tab] : undefined;
        const top = mobileNav.stack[mobileNav.stack.length - 1];
        if (top?.name !== 'settings') mobileNav.push({ name: 'settings' });
        if (sub) mobileNav.push(sub);
      }
      if (s.uiCreateServerOpen) {
        s.closeCreateServer();
        openCreateServerAlert();
      }
      const jump = s.pendingJumpTo;
      if (jump) {
        s.setPendingJumpTo(null);
        mobileNav.navigate({
          name: 'chat',
          chatId: jump.chatId,
          title: chatTitle(qc, jump.chatId),
          jumpTo: { messageId: jump.messageId, createdAt: jump.createdAt },
        });
      }
    };
    // flags may already be set before the shell mounted (e.g. notification click)
    handle(useSessionStore.getState());
    return useSessionStore.subscribe((s, prev) => {
      if (
        (s.uiPaletteOpen && !prev.uiPaletteOpen) ||
        (s.uiAdvancedSearchOpen && !prev.uiAdvancedSearchOpen) ||
        (s.uiSettingsOpen && !prev.uiSettingsOpen) ||
        (s.uiCreateServerOpen && !prev.uiCreateServerOpen) ||
        (s.pendingJumpTo && s.pendingJumpTo !== prev.pendingJumpTo)
      ) {
        handle(s);
      }
    });
  }, [qc]);
}

export function MobileApp() {
  useSessionBridges();
  return (
    <MobileRoot
      overlays={
        <>
          <MobileVoiceHost />
          <InAppBanner />
        </>
      }
    >
      <NavStackProvider renderRoute={renderRoute} />
    </MobileRoot>
  );
}
