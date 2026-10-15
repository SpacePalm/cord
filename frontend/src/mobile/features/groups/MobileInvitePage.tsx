// /invite/:code on a phone: the JoinInviteSheet layout as a full page — nav title
// «Присоединиться», field pre-filled with the code, lookup runs automatically (public endpoint, no auth),
// then the preview card + «Присоединиться». Logged out → Join goes to /login?next=/invite/{code};
// logged in → join, then /app (iOS parity: land on the root list).
import { useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '../../../store/authStore';
import { MobileRoot } from '../../MobileRoot';
import { Screen } from '../../nav/Screen';
import { BarTextButton } from '../../nav/BarButton';
import { useMT } from '../../i18n';
import { JoinInviteForm } from './JoinInviteSheet';
import './groups.css';

function InviteScreen() {
  const t = useMT();
  const navigate = useNavigate();
  const { code = '' } = useParams<{ code: string }>();
  const token = useAuthStore((s) => s.token);

  return (
    <Screen
      title={t('invite.title')}
      trailing={
        <BarTextButton prominent onPress={() => navigate(token ? '/app' : '/login', { replace: true })}>
          {t('common.close')}
        </BarTextButton>
      }
    >
      <JoinInviteForm
        initialCode={code}
        autoLookup
        beforeJoin={(c) => {
          if (useAuthStore.getState().token) return true;
          navigate(`/login?next=/invite/${encodeURIComponent(c)}`);
          return false;
        }}
        onJoined={() => navigate('/app', { replace: true })}
      />
    </Screen>
  );
}

/** /invite/:code on a phone. */
export function MobileInvitePage() {
  return (
    <MobileRoot>
      <InviteScreen />
    </MobileRoot>
  );
}
