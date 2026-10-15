// Global voice overlays (iOS SessionGate overlays): FloatingVoiceBar (bottom, z 50), IncomingCallCard
// (top, z 501) and the CallNotice capsule (top, z 502). Mounted by MobileVoiceHost through MobileRoot
// "overlays" (outside the receded card stack).
import { useEffect, useRef } from 'react';
import { useMT } from '../../i18n';
import { Avatar } from '../../ui/Avatar';
import { Icon } from '../../ui/Icon';
import { useKeyboardInset } from '../../ui/useKeyboardInset';
import { useSessionStore } from '../../../store/sessionStore';
import { useVoiceStore } from './voiceStore';
import { leaveVoiceFlow, toggleDeafen, toggleMic, unlockVoiceAudio } from './voiceEngine';
import { acceptIncomingCall, declineIncomingCall, openVoiceRoom } from './voiceActions';
import { isOutgoingRinging } from './VoiceRoomSheet';
import { CallButton, useTransitionPresence } from './VoiceBits';
import './voice.css';

/** Height the floating bar reserves (54 card + 6 margin + 2) — read by screens via --ios-floating-bar-h. */
const BAR_RESERVE = '62px';

// ───────────────────────────── floating bar ─────────────────────────────

export function FloatingVoiceBar() {
  const t = useMT();
  const presence = useSessionStore((s) => s.voicePresence);
  const showRoom = useVoiceStore((s) => s.showRoom);
  const state = useVoiceStore((s) => s.state);
  const members = useVoiceStore((s) => s.members);
  const isMuted = useVoiceStore((s) => s.isMuted);
  const isDeafened = useVoiceStore((s) => s.isDeafened);
  const kb = useKeyboardInset();
  const active = !!presence && !showRoom;
  // the composer rides on the keyboard — keep the bar out of the way while typing
  const visible = active && kb === 0;
  const { mounted, leaving } = useTransitionPresence(visible, 360);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--ios-floating-bar-h', visible ? BAR_RESERVE : '0px');
  }, [visible]);
  useEffect(() => () => {
    document.documentElement.style.removeProperty('--ios-floating-bar-h');
  }, []);

  if (!mounted) return null;
  const ringing = isOutgoingRinging(presence, state, members);
  const subtitle = ringing ? t('voice.calling') : state === 'connected' ? t('voice.membersCount', members.length) : t('voice.connecting');
  const enabled = state === 'connected';
  return (
    <div
      className={'m-voice-bar-wrap' + (leaving ? ' is-leaving' : '')}
      role="button"
      tabIndex={0}
      aria-label={t('voice.expand')}
      onPointerDownCapture={unlockVoiceAudio}
      onClick={openVoiceRoom}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) openVoiceRoom();
      }}
    >
      <div className="m-voice-bar">
        <Icon name="speaker.wave.2.fill" size={22} color="var(--accent)" className="m-voice-bar-speaker" />
        <div className="m-voice-bar-text">
          <div className="ios-t-subheadline ios-w-semibold ios-truncate" style={{ color: 'var(--text-primary)' }}>
            {presence?.channelName || t('voice.channel')}
          </div>
          <div className="ios-t-caption2 ios-truncate" style={{ color: 'var(--text-muted)' }}>
            {subtitle}
          </div>
        </div>
        <CallButton
          size={38}
          icon={isMuted ? 'mic.slash.fill' : 'mic.fill'}
          iconSize={22}
          bg="var(--bg-tertiary)"
          fg={isMuted ? 'var(--danger)' : 'var(--text-primary)'}
          disabled={!enabled}
          ariaLabel={isMuted ? t('voice.mic') : t('voice.micOff')}
          onPress={() => void toggleMic()}
        />
        <CallButton
          size={38}
          icon="headphones"
          iconSize={22}
          bg={isDeafened ? 'var(--danger)' : 'var(--bg-tertiary)'}
          fg={isDeafened ? '#fff' : 'var(--text-primary)'}
          disabled={!enabled}
          ariaLabel={isDeafened ? t('voice.undeafen') : t('voice.deafen')}
          onPress={toggleDeafen}
        />
        <CallButton size={38} icon="phone.down.fill" iconSize={22} bg="var(--danger)" fg="#fff" ariaLabel={t('voice.leave')} onPress={leaveVoiceFlow} />
      </div>
    </div>
  );
}

// ───────────────────────────── incoming call ─────────────────────────────

type Call = NonNullable<ReturnType<typeof useVoiceStore.getState>['incoming']>;

export function IncomingCallCard() {
  const t = useMT();
  const call = useVoiceStore((s) => s.incoming);
  // keep the last call rendered during the exit transition
  const lastRef = useRef<Call | null>(call);
  if (call) lastRef.current = call;
  const { mounted, leaving } = useTransitionPresence(!!call, 360);
  if (!mounted || !lastRef.current) return null;
  return <CallCard call={lastRef.current} t={t} leaving={leaving} />;
}

function CallCard({ call, t, leaving }: { call: Call; t: ReturnType<typeof useMT>; leaving: boolean }) {
  const name = call.caller.display_name || call.caller.username;
  return (
    <div className={'m-voice-call-wrap' + (leaving ? ' is-leaving' : '')} aria-live="assertive">
      <div className="m-voice-call" role="dialog" aria-label={t('voice.incomingCall')}>
        <Avatar src={call.caller.image_path || null} name={name} size={46} />
        <div className="m-voice-call-text">
          <div className="ios-t-subheadline ios-w-semibold ios-truncate" style={{ color: 'var(--text-primary)' }}>
            {name}
          </div>
          <div className="ios-t-caption" style={{ color: 'var(--text-muted)' }}>
            {t('voice.incomingCall')}
          </div>
        </div>
        <CallButton
          size={44}
          icon="phone.down.fill"
          iconSize={22}
          bg="var(--danger)"
          fg="#fff"
          ariaLabel={t('voice.decline')}
          onPress={declineIncomingCall}
        />
        <CallButton
          size={44}
          icon="phone.fill"
          iconSize={22}
          bg="var(--ios-green)"
          fg="#fff"
          ariaLabel={t('voice.accept')}
          onPress={acceptIncomingCall}
          className="m-voice-accept"
        />
      </div>
    </div>
  );
}

// ───────────────────────────── notice capsule ─────────────────────────────

export function CallNotice() {
  const notice = useVoiceStore((s) => s.notice);
  const lastRef = useRef('');
  if (notice) lastRef.current = notice.text;
  const { mounted, leaving } = useTransitionPresence(!!notice, 360);
  if (!mounted) return null;
  return (
    <div className={'m-voice-notice-wrap' + (leaving ? ' is-leaving' : '')} role="status" aria-live="polite">
      <div className="m-voice-notice ios-t-subheadline">{notice?.text ?? lastRef.current}</div>
    </div>
  );
}
