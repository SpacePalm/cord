// iOS SettingsView: inline-titled inset-grouped hub. Web differences: no "Сменить сервер" and one extra
// web-only row "Голос и видео" after Notifications.
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Screen } from '../../nav/Screen';
import { InsetGroupedList, ListSection, NavRow, ButtonRow } from '../../ui';
import { useMT } from '../../i18n';
import { useAuthStore } from '../../../store/authStore';
import { performMobileLogout } from './logout';
import './settings.css';

/** Settings hub (inline title "Настройки"). */
export function SettingsScreen() {
  const t = useMT();
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const navigate = useNavigate();

  // iOS env.logout(): voice.reset() (leave the call, stop ringing), end the server session, clear tokens &
  // caches → login. No confirmation.
  const logout = () => performMobileLogout(qc, navigate);

  return (
    <Screen title={t('settings.title')}>
      <InsetGroupedList>
        {user && (
          <ListSection header={t('settings.accountSection')}>
            <NavRow icon="person.crop.circle" title={t('settings.profile')} to={{ name: 'settings.profile' }} />
            <NavRow icon="circle.circle" title={t('settings.status')} to={{ name: 'settings.status' }} />
          </ListSection>
        )}

        {user?.role === 'admin' && (
          <ListSection>
            <NavRow icon="shield.lefthalf.filled" title={t('admin.title')} to={{ name: 'admin' }} />
          </ListSection>
        )}

        <ListSection header={t('settings.securitySection')}>
          <NavRow icon="lock" title={t('settings.changePassword')} to={{ name: 'settings.password' }} />
          <NavRow icon="desktopcomputer" title={t('settings.activeSessions')} to={{ name: 'settings.sessions' }} />
        </ListSection>

        <ListSection>
          <NavRow icon="bell" title={t('settings.notifications')} to={{ name: 'settings.notifications' }} />
          <NavRow icon="mic" title={t('settings.voiceVideo')} to={{ name: 'settings.voiceVideo' }} />
          <NavRow icon="paintbrush" title={t('settings.appearance')} to={{ name: 'settings.appearance' }} />
          <NavRow icon="globe" title={t('settings.language')} to={{ name: 'settings.language' }} />
          <NavRow icon="internaldrive" title={t('settings.storage')} to={{ name: 'settings.storage' }} />
        </ListSection>

        <ListSection>
          <ButtonRow icon="rectangle.portrait.and.arrow.right" title={t('main.logout')} role="danger" onPress={logout} />
        </ListSection>
      </InsetGroupedList>
    </Screen>
  );
}
