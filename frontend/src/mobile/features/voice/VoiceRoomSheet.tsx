// iOS `VoiceChannelView` — the in-call room, presented as a large sheet WITHOUT a nav bar:
// custom header (speaker · title / status · gear · chevron), hairline, state-dependent content
// (no mic / calling / connecting / reconnecting / disconnected / screen shares / empty / grid) and
// the 4-button control row, all rendered in every state.
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useMT } from '../../i18n';
import { SheetScreen } from '../../nav/Screen';
import { Avatar } from '../../ui/Avatar';
import { Icon } from '../../ui/Icon';
import { Spinner } from '../../ui/Spinner';
import { useLongPress } from '../../ui/useLongPress';
import { useSessionStore, type VoicePresence } from '../../../store/sessionStore';
import { useVoiceStore, type ConnState, type VoiceMember } from './voiceStore';
import { isCallPresence, leaveVoiceFlow, toggleCamera, toggleDeafen, toggleMic, unlockVoiceAudio } from './voiceEngine';
import { collapseVoiceRoom } from './voiceActions';
import { CallButton, GlyphButton, QualityBars, ScreenVolumeSlider, VideoView, formatCallDuration, useTicker } from './VoiceBits';
import { openVoiceMemberSheet } from './VoiceMemberSheet';
import { openVoiceDevicesSheet } from './VoiceDevicesSheet';
import { openScreenShareCover } from './ScreenShareCover';
import './voice.css';

// ───────────────────────────── derived state ─────────────────────────────

/** iOS `isOutgoingRinging`: I'm the DM caller and still alone (also while connecting). */
export function isOutgoingRinging(p: VoicePresence | null, state: ConnState, members: VoiceMember[]): boolean {
  return (
    !!p &&
    !!p.isCaller &&
    isCallPresence(p) &&
    !!p.peerName &&
    members.every((m) => m.isLocal) &&
    (state === 'connected' || state === 'connecting')
  );
}

function useRoomModel() {
  const presence = useSessionStore((s) => s.voicePresence);
  const callStartedAt = useSessionStore((s) => s.callStartedAt);
  const state = useVoiceStore((s) => s.state);
  const members = useVoiceStore((s) => s.members);
  const permissionDenied = useVoiceStore((s) => s.permissionDenied);
  const deniedName = useVoiceStore((s) => s.deniedName);
  const ringing = isOutgoingRinging(presence, state, members);
  const title = permissionDenied ? deniedName : presence?.channelName ?? null;
  return { presence, callStartedAt, state, members, permissionDenied, ringing, title };
}

// ───────────────────────────── header ─────────────────────────────

function StatusLine() {
  const t = useMT();
  const { state, members, permissionDenied, ringing, callStartedAt } = useRoomModel();
  const connected = !permissionDenied && !ringing && state === 'connected';
  const now = useTicker(1000, connected && callStartedAt != null);
  let text: string;
  if (permissionDenied) text = t('voice.noMic');
  else if (ringing) text = t('voice.calling');
  else if (state === 'connecting') text = t('voice.connecting');
  else if (state === 'reconnecting') text = t('voice.reconnecting');
  else if (state === 'connected') {
    text = t('voice.membersCount', members.length);
    if (callStartedAt != null) text += ' · ' + formatCallDuration(callStartedAt, now);
  } else text = t('voice.disconnected');
  return <div className="ios-t-caption ios-truncate m-voice-hdr-status">{text}</div>;
}

function RoomHeader() {
  const t = useMT();
  const { title } = useRoomModel();
  return (
    <div className="m-voice-hdr">
      <Icon name="speaker.wave.2.fill" size={22} color="var(--accent)" className="m-voice-hdr-speaker" />
      <div className="m-voice-hdr-text">
        <div className="ios-t-headline ios-truncate m-voice-hdr-title">{title ?? t('voice.channel')}</div>
        <StatusLine />
      </div>
      <GlyphButton className="m-voice-hdr-btn" onPress={openVoiceDevicesSheet} ariaLabel={t('voice.devices')}>
        <Icon name="gearshape" size={22} color="var(--text-muted)" />
      </GlyphButton>
      <GlyphButton className="m-voice-hdr-btn" onPress={collapseVoiceRoom} ariaLabel={t('voice.collapse')}>
        <Icon name="chevron.down" size={22} strokeWidth={2} color="var(--text-muted)" />
      </GlyphButton>
    </div>
  );
}

// ───────────────────────────── tiles ─────────────────────────────

/** iOS grid algorithm (VoiceViews.swift `grid`). */
export function gridMetrics(count: number, W: number) {
  const SPACING = 8;
  const PAD = 12;
  const MIN_TILE = 60;
  const maxColsByWidth = Math.max(1, Math.floor((W - PAD * 2 + SPACING) / (MIN_TILE + SPACING)));
  const cols = Math.max(1, Math.min(Math.ceil(Math.sqrt(count)), maxColsByWidth));
  const tile = Math.max(MIN_TILE, (W - PAD * 2 - SPACING * (cols - 1)) / cols);
  return { cols, tile };
}

function useSpeakingFlags(m: VoiceMember) {
  const deafened = useVoiceStore((s) => s.isDeafened);
  const locallyMuted = useVoiceStore((s) => !m.isLocal && !!s.mutedUsers[m.id]);
  return { locallyMuted, speaking: m.isSpeaking && !deafened && !locallyMuted };
}

function Tile({ m, size }: { m: VoiceMember; size: number }) {
  const t = useMT();
  const { locallyMuted, speaking } = useSpeakingFlags(m);
  const open = () => {
    if (!m.isLocal) openVoiceMemberSheet(m);
  };
  const lp = useLongPress(open, { ms: 500, disabled: m.isLocal });
  const label = m.isLocal ? t('voice.you') : m.name;
  return (
    <div
      className={'m-voice-tile' + (speaking ? ' is-speaking' : '') + (m.isLocal ? '' : ' is-remote')}
      style={{ width: size, height: size }}
      role={m.isLocal ? undefined : 'button'}
      tabIndex={m.isLocal ? undefined : 0}
      aria-label={m.isLocal ? undefined : m.name}
      onClick={m.isLocal ? undefined : open}
      {...(m.isLocal ? null : lp)}
    >
      {m.cameraTrack ? (
        <>
          <VideoView track={m.cameraTrack} mirror={m.isLocal} />
          <span className="m-voice-tile-chip ios-t-caption2">{label}</span>
        </>
      ) : (
        <div className="m-voice-tile-body">
          <Avatar src={m.imagePath || null} name={m.name} size={68} />
          <div className="m-voice-tile-name ios-t-subheadline">{label}</div>
        </div>
      )}
      <div className="m-voice-tile-ind">
        <span className="m-voice-qchip">
          <QualityBars quality={m.quality} />
        </span>
        {m.isMuted && (
          <span className="m-voice-badge" style={{ background: 'var(--danger)' }}>
            <Icon name="mic.slash.fill" size={13} strokeWidth={2.5} color="#fff" />
          </span>
        )}
        {locallyMuted && (
          <span className="m-voice-badge" style={{ background: 'var(--ios-orange)' }}>
            <Icon name="speaker.slash.fill" size={13} strokeWidth={2.5} color="#fff" />
          </span>
        )}
      </div>
      {!m.isLocal && (
        <button
          type="button"
          className="m-voice-tile-more"
          aria-label={t('voice.moreFor')}
          onClick={(e) => {
            e.stopPropagation();
            open();
          }}
        >
          <Icon name="ellipsis" size={16} strokeWidth={2.5} color="#fff" />
        </button>
      )}
      <span className="m-voice-tile-ring" aria-hidden />
    </div>
  );
}

function Grid({ members }: { members: VoiceMember[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [W, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { cols, tile } = gridMetrics(members.length, W || 1);
  const rows: (VoiceMember | null)[][] = [];
  for (let i = 0; i < members.length; i += cols) {
    rows.push(Array.from({ length: cols }, (_, c) => members[i + c] ?? null));
  }
  return (
    <div className="m-voice-grid" ref={ref}>
      {W > 0 && (
        <div className="m-voice-grid-inner">
          {rows.map((row, r) => (
            <div key={r} className="m-voice-grid-row">
              {row.map((m, c) =>
                m ? <Tile key={m.id} m={m} size={tile} /> : <span key={`f${c}`} style={{ width: tile, height: tile, flex: 'none' }} />,
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── screen shares ─────────────────────────────

function ShareTile({ m }: { m: VoiceMember }) {
  const t = useMT();
  const name = m.isLocal ? t('voice.you') : m.name;
  const full = () => openScreenShareCover(m.id, name);
  if (!m.screenTrack) return null;
  return (
    <div className="m-voice-share">
      <div className="m-voice-share-hdr">
        <Icon name="rectangle.on.rectangle" size={14} />
        <span className="ios-t-caption ios-truncate m-voice-share-title">{name + ' · ' + t('voice.sharingScreen')}</span>
        <ScreenVolumeSlider identity={m.id} width={84} />
        <GlyphButton onPress={full} ariaLabel={t('voice.fullscreen')} className="m-voice-share-expand">
          <Icon name="arrow.up.left.and.arrow.down.right" size={15} style={{ transform: 'scaleX(-1)' }} />
        </GlyphButton>
      </div>
      <div className="m-voice-share-video" onClick={full}>
        <VideoView track={m.screenTrack} fit="contain" />
      </div>
    </div>
  );
}

function StripTile({ m }: { m: VoiceMember }) {
  const t = useMT();
  const { speaking } = useSpeakingFlags(m);
  const lp = useLongPress(() => openVoiceMemberSheet(m), { ms: 500, disabled: m.isLocal });
  return (
    <div className="m-voice-strip-tile" {...(m.isLocal ? null : lp)}>
      <span className={'m-voice-strip-av' + (speaking ? ' is-speaking' : '')}>
        <Avatar src={m.imagePath || null} name={m.name} size={44} />
      </span>
      <span className="ios-t-caption2 ios-truncate m-voice-strip-name">{m.isLocal ? t('voice.you') : m.name}</span>
    </div>
  );
}

function ShareLayout({ members }: { members: VoiceMember[] }) {
  const sharers = members.filter((m) => m.screenTrack);
  return (
    <div className="m-voice-shares">
      {sharers.map((m) => (
        <ShareTile key={m.id} m={m} />
      ))}
      <div className="m-voice-strip" data-no-sheet-drag>
        <div className="m-voice-strip-inner">
          {members.map((m) => (
            <StripTile key={m.id} m={m} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── content state machine ─────────────────────────────

function RoomContent() {
  const t = useMT();
  const { presence, state, members, permissionDenied, ringing } = useRoomModel();
  if (permissionDenied) {
    return (
      <div className="m-voice-center" style={{ gap: 12 }}>
        <Icon name="mic.slash.fill" size={40} color="var(--danger)" />
        <div className="ios-t-subheadline m-voice-hint">{t('voice.micDeniedHintWeb')}</div>
      </div>
    );
  }
  if (ringing && presence) {
    const peer = presence.peerName ?? '';
    return (
      <div className="m-voice-center" style={{ gap: 14 }}>
        {/* deviation (spec Q1/Q10): the PEER's avatar, shown from the start */}
        <Avatar src={presence.peerImagePath || null} name={peer} size={96} />
        <div className="ios-t-title3 m-voice-peer">{peer}</div>
        <div className="ios-t-subheadline" style={{ color: 'var(--text-muted)' }}>
          {t('voice.calling')}
        </div>
      </div>
    );
  }
  if (state === 'connecting') {
    return (
      <div className="m-voice-center">
        <Spinner />
      </div>
    );
  }
  if (state === 'reconnecting') {
    return (
      <div className="m-voice-center" style={{ gap: 12 }}>
        <Spinner />
        <div className="ios-t-subheadline" style={{ color: 'var(--text-muted)' }}>
          {t('voice.reconnecting')}
        </div>
      </div>
    );
  }
  if (state === 'idle') {
    return (
      <div className="m-voice-center" style={{ gap: 12 }}>
        <Icon name="wifi.slash" size={40} color="var(--text-muted)" />
        <div className="ios-t-subheadline" style={{ color: 'var(--text-muted)' }}>
          {t('voice.disconnected')}
        </div>
      </div>
    );
  }
  if (members.some((m) => m.screenTrack)) return <ShareLayout members={members} />;
  if (members.length === 0) {
    return (
      <div className="m-voice-center">
        <div className="ios-t-body" style={{ color: 'var(--text-muted)' }}>
          {t('voice.empty')}
        </div>
      </div>
    );
  }
  return <Grid members={members} />;
}

// ───────────────────────────── controls ─────────────────────────────

function RoomControls() {
  const t = useMT();
  const state = useVoiceStore((s) => s.state);
  const isMuted = useVoiceStore((s) => s.isMuted);
  const isDeafened = useVoiceStore((s) => s.isDeafened);
  const isCameraOn = useVoiceStore((s) => s.isCameraOn);
  const denied = useVoiceStore((s) => s.permissionDenied);
  const cameraAllowed = useSessionStore((s) => s.cameraAllowed);
  const enabled = state === 'connected' && !denied;
  return (
    <div className="m-voice-controls">
      <CallButton
        size={58}
        icon={isMuted ? 'mic.slash.fill' : 'mic.fill'}
        iconSize={28}
        bg={isMuted ? 'var(--danger)' : 'var(--bg-tertiary)'}
        fg={isMuted ? '#fff' : 'var(--text-primary)'}
        disabled={!enabled}
        ariaLabel={isMuted ? t('voice.mic') : t('voice.micOff')}
        onPress={() => void toggleMic()}
      />
      <CallButton
        size={58}
        icon="headphones"
        iconSize={28}
        bg={isDeafened ? 'var(--danger)' : 'var(--bg-tertiary)'}
        fg={isDeafened ? '#fff' : 'var(--text-primary)'}
        slash={isDeafened}
        disabled={!enabled}
        ariaLabel={isDeafened ? t('voice.undeafen') : t('voice.deafen')}
        onPress={toggleDeafen}
      />
      {cameraAllowed && (
        <CallButton
          size={58}
          icon={isCameraOn ? 'video.fill' : 'video.slash.fill'}
          iconSize={28}
          bg={isCameraOn ? 'var(--accent)' : 'var(--bg-tertiary)'}
          fg={isCameraOn ? '#fff' : 'var(--text-primary)'}
          disabled={!enabled}
          ariaLabel={isCameraOn ? t('voice.cameraOff') : t('voice.camera')}
          onPress={() => void toggleCamera()}
        />
      )}
      <CallButton
        size={58}
        icon="phone.down.fill"
        iconSize={28}
        bg="var(--danger)"
        fg="#fff"
        ariaLabel={t('voice.leave')}
        onPress={leaveVoiceFlow}
      />
    </div>
  );
}

// ───────────────────────────── sheet root ─────────────────────────────

export function VoiceRoomSheet() {
  return (
    <SheetScreen noBar scroll={false}>
      <div className="m-voice-room" onPointerDownCapture={unlockVoiceAudio} style={{ '--tint': 'var(--accent)' } as CSSProperties}>
        <RoomHeader />
        <hr className="ios-divider m-voice-divider" />
        <div className="m-voice-content">
          <RoomContent />
        </div>
        <RoomControls />
      </div>
    </SheetScreen>
  );
}
