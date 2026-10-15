// Route → screen component.
import type { ReactNode } from 'react';
import type { Route } from './routes';
import { HomeScreen } from '../features/home/HomeScreen';
import { ChannelListScreen } from '../features/groups/ChannelListScreen';
import { ChatScreen } from '../features/chat/ChatScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { ProfileScreen } from '../features/settings/ProfileScreen';
import { StatusScreen } from '../features/settings/StatusScreen';
import { PasswordScreen } from '../features/settings/PasswordScreen';
import { SessionsScreen } from '../features/settings/SessionsScreen';
import { NotificationsScreen } from '../features/settings/NotificationsScreen';
import { AppearanceScreen } from '../features/settings/AppearanceScreen';
import { LanguageScreen } from '../features/settings/LanguageScreen';
import { StorageScreen } from '../features/settings/StorageScreen';
import { VoiceVideoScreen } from '../features/settings/VoiceVideoScreen';
import { AdminScreen } from '../features/admin/AdminScreen';

export function renderRoute(route: Route): ReactNode {
  switch (route.name) {
    case 'home':
      return <HomeScreen />;
    case 'channels':
      return <ChannelListScreen groupId={route.groupId} />;
    case 'chat':
      return <ChatScreen chatId={route.chatId} title={route.title} groupId={route.groupId} jumpTo={route.jumpTo} />;
    case 'settings':
      return <SettingsScreen />;
    case 'settings.profile':
      return <ProfileScreen />;
    case 'settings.status':
      return <StatusScreen />;
    case 'settings.password':
      return <PasswordScreen />;
    case 'settings.sessions':
      return <SessionsScreen />;
    case 'settings.notifications':
      return <NotificationsScreen />;
    case 'settings.appearance':
      return <AppearanceScreen />;
    case 'settings.language':
      return <LanguageScreen />;
    case 'settings.storage':
      return <StorageScreen />;
    case 'settings.voiceVideo':
      return <VoiceVideoScreen />;
    case 'admin':
      return <AdminScreen tab={route.tab} />;
  }
}
