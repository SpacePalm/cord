// Mobile voice engine (iOS `VoiceStore` port).
// One LiveKit `Room` for the whole mobile session, driven by `sessionStore.voicePresence`
// (source of truth for "I'm in a call"): presence set → fetch token + connect; presence changed /
// cleared → disconnect + POST /voice/leave (+ DM cancel). The room lives outside React, so it
// survives navigation, sheets and the room sheet being collapsed. UI reads `useVoiceStore`.
// Also owns DM-call signalling (WS incoming_call / call_cancelled / call_declined), the ringer and
// the 45 s ring timeout — what desktop does in IncomingCallOverlay / OutgoingCallWatcher.
import {
  AudioPresets,
  ConnectionQuality,
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RoomOptions,
  type VideoTrack,
} from 'livekit-client';
import type { QueryClient } from '@tanstack/react-query';
import { useSessionStore, type VoicePresence } from '../../../store/sessionStore';
import { useAuthStore } from '../../../store/authStore';
import { useNotificationStore } from '../../../store/notificationStore';
import { voiceApi } from '../../../api/voice';
import { dmsApi, type DMItem } from '../../../api/dms';
import {
  onCallCancelled,
  onCallDeclined,
  onIncomingCall,
  type CallDeclinedEvent,
  type IncomingCallEvent,
} from '../../../hooks/useWebSocket';
import { playVoiceJoinSound, playVoiceLeaveSound } from '../../../utils/notificationSound';
import { activateVoiceGuard, deactivateVoiceGuard } from '../../../utils/voiceBackgroundGuard';
import { mt } from '../../i18n';
import { installVoiceAudioUnlock, primeVoiceAudio, suspendVoiceAudio, voiceAudioContext } from './voiceAudio';
import { isRingerActive, startVoiceRinger, stopVoiceRinger } from './voiceRinger';
import {
  pushNotice,
  setShowRoom,
  useVoiceStore,
  volumeOf,
  type ConnState,
  type VoiceMember,
  type VoiceQuality,
} from './voiceStore';

// ───────────────────────────── state ─────────────────────────────

/** Presence persisted from the previous page session (iOS never restores a call on launch). */
const bootPresence = useSessionStore.getState().voicePresence;
/**
 * Only a cold start ON MOBILE drops the stale presence. When the page loaded in the desktop layout,
 * desktop owns (and auto-rejoins) the presence; crossing the breakpoint later must reconnect, not hang up.
 */
let bootHandled = (() => {
  try {
    return !window.matchMedia('(max-width: 767.98px)').matches;
  } catch {
    return false;
  }
})();

const RING_TIMEOUT_MS = 45_000;
const DEDUP_MS = 5_000;

const E = {
  started: 0,
  qc: null as QueryClient | null,
  unsubs: [] as Array<() => void>,
  room: null as Room | null,
  /** Presence the current room / connection attempt belongs to. */
  presence: null as VoicePresence | null,
  gen: 0,
  everConnected: false,
  rebuildQueued: false,
  knownRemote: null as Set<string> | null,
  participantsKey: '',
  audioBox: null as HTMLDivElement | null,
  suppressNetwork: false,
  ringToken: 0,
  vibrateTimer: 0,
  recentIncoming: new Map<string, number>(),
  recentDeclines: new Map<string, number>(),
  audioBlockedNotified: false,
  /** OS notification of the ringing call (tab hidden) — closed with the banner. */
  callNotification: null as Notification | null,
};

/** Join-flow generation (iOS `joinGen`): drops results of superseded joins. */
let joinGen = 0;

export function isCallPresence(p: VoicePresence | null | undefined): boolean {
  // desktop DM calls are stored as channelName 'call'
  return !!p && (!!p.isCall || p.channelName === 'call');
}

// ───────────────────────────── lifecycle ─────────────────────────────

export function startVoiceEngine(qc: QueryClient): void {
  E.qc = qc;
  E.started++;
  if (E.started > 1) return;

  // Cold start with a persisted presence → iOS parity: no auto re-join. Tell the server we left.
  const cur = useSessionStore.getState().voicePresence;
  if (!bootHandled) {
    bootHandled = true;
    if (cur && cur === bootPresence) {
      sendLeave(cur);
      useSessionStore.getState().leaveVoice();
    }
  }

  E.unsubs.push(
    useSessionStore.subscribe((s, prev) => {
      if (s.voicePresence !== prev.voicePresence) onPresence(s.voicePresence, prev.voicePresence);
      const room = E.room;
      if (room && E.everConnected) {
        if (s.audioInputId !== prev.audioInputId && s.audioInputId)
          void room.switchActiveDevice('audioinput', s.audioInputId).catch(() => undefined);
        if (s.audioOutputId !== prev.audioOutputId && s.audioOutputId)
          void room.switchActiveDevice('audiooutput', s.audioOutputId).catch(() => undefined);
        if (s.videoInputId !== prev.videoInputId && s.videoInputId)
          void room.switchActiveDevice('videoinput', s.videoInputId).catch(() => undefined);
      }
    }),
  );
  E.unsubs.push(
    useVoiceStore.subscribe((s, prev) => {
      if (s.volumes !== prev.volumes || s.mutedUsers !== prev.mutedUsers || s.isDeafened !== prev.isDeafened) applyVolumes();
      if (s.mutedUsers !== prev.mutedUsers || s.isDeafened !== prev.isDeafened) scheduleRebuild();
    }),
  );
  // logout / session lost: drop the call locally (the token is gone — no network)
  E.unsubs.push(
    useAuthStore.subscribe((s, prev) => {
      if (prev.token && !s.token) resetVoiceLocal();
    }),
  );
  E.unsubs.push(onIncomingCall(handleIncoming));
  E.unsubs.push(onCallCancelled((ev) => {
    if (useVoiceStore.getState().incoming?.group_id === ev.group_id) clearIncoming();
  }));
  E.unsubs.push(onCallDeclined(handleDeclined));
  // the ringer starts without a gesture → unlock the shared AudioContext on the first tap anywhere
  E.unsubs.push(installVoiceAudioUnlock(isAudioIdle));

  const p = useSessionStore.getState().voicePresence;
  if (p) onPresence(p, null);
}

export function stopVoiceEngine(): void {
  E.started = Math.max(0, E.started - 1);
  if (E.started > 0) return;
  E.unsubs.splice(0).forEach((u) => u());
  clearIncoming();
  // Shell unmounted (breakpoint switch → desktop takes over the presence, or logout): disconnect
  // locally without telling the server.
  teardown({ network: false, suspendAudio: true });
  if (!useAuthStore.getState().token && useSessionStore.getState().voicePresence) {
    E.suppressNetwork = true;
    useSessionStore.getState().leaveVoice();
    E.suppressNetwork = false;
  }
  useVoiceStore.setState({ showRoom: false, permissionDenied: false, deniedName: null });
}

function onPresence(next: VoicePresence | null, _prev: VoicePresence | null): void {
  if (!E.started) return;
  if (next && E.presence && next.channelId === E.presence.channelId) {
    E.presence = next; // metadata update only
    return;
  }
  if (E.presence || E.room) teardown({ network: !E.suppressNetwork, suspendAudio: !next });
  if (next) void connect(next);
  else {
    useVoiceStore.setState({
      state: 'idle',
      members: [],
      isMuted: false,
      isDeafened: false,
      isCameraOn: false,
      audioBlocked: false,
      showRoom: false,
    });
  }
}

/** Fire-and-forget POST /voice/leave (+ DM cancel: stops the peer's ringing; no-op once answered). */
function sendLeave(p: VoicePresence): void {
  voiceApi.leave(p.channelId).catch(() => undefined);
  if (isCallPresence(p)) dmsApi.cancelCall(p.groupId).catch(() => undefined);
}

function teardown(opts: { network: boolean; suspendAudio: boolean }): void {
  E.gen++;
  const room = E.room;
  const p = E.presence;
  E.room = null;
  E.presence = null;
  E.everConnected = false;
  E.knownRemote = null;
  E.audioBlockedNotified = false;
  if (room) {
    try {
      room.removeAllListeners();
    } catch {
      /* ignore */
    }
    detachAllAudio(room);
    void room.disconnect(true).catch(() => undefined);
    void deactivateVoiceGuard().catch(() => undefined);
  }
  E.audioBox?.replaceChildren();
  if (p) {
    // local presence cache: remove myself from the channel list row right away
    const me = useAuthStore.getState().user?.id;
    const qc = E.qc;
    if (qc && me) {
      const list = qc.getQueryData<{ identity: string }[]>(['voice-participants', p.channelId]);
      if (Array.isArray(list)) qc.setQueryData(['voice-participants', p.channelId], list.filter((x) => x.identity !== me));
    }
    if (opts.network) sendLeave(p);
  }
  if (E.participantsKey) {
    E.participantsKey = '';
    useSessionStore.getState().setVoiceParticipants([]);
  }
  if (opts.suspendAudio) suspendVoiceAudio();
}

async function connect(p: VoicePresence): Promise<void> {
  const gen = ++E.gen;
  E.presence = p;
  E.everConnected = false;
  E.knownRemote = null;
  // iOS resets callStartedAt on every join (web joinVoice keeps the minimum of old/new)
  useSessionStore.setState({ callStartedAt: null });
  useVoiceStore.setState({
    state: 'connecting',
    members: [],
    isMuted: false,
    isDeafened: false,
    isCameraOn: false,
    audioBlocked: false,
    permissionDenied: false,
    deniedName: null,
  });
  try {
    const tok = await voiceApi.getToken(p.channelId);
    if (gen !== E.gen) return;
    if (tok.call_started_at) useSessionStore.getState().setCallStartedAt(tok.call_started_at);

    const ctx = voiceAudioContext() ?? primeVoiceAudio();
    const outputId = useSessionStore.getState().audioOutputId;
    const options: Partial<RoomOptions> = {
      publishDefaults: { red: true, audioPreset: AudioPresets.speech },
      // mobile: the tab may be backgrounded / the screen locked — don't hang up on pagehide
      disconnectOnPageLeave: false,
      // remote audio through Web Audio gain nodes → per-user volume 0–300 % (also on iOS, where
      // HTMLMediaElement.volume is read-only)
      webAudioMix: ctx ? { audioContext: ctx } : true,
      ...(outputId ? { audioOutput: { deviceId: outputId } } : null),
    };
    const room = new Room(options);
    E.room = room;
    bindRoom(room, gen);
    await room.connect(tok.url, tok.token);
    if (gen !== E.gen) {
      room.removeAllListeners();
      void room.disconnect(true).catch(() => undefined);
      return;
    }
    E.everConnected = true;
    useVoiceStore.setState({ state: 'connected' });
    void activateVoiceGuard(p.channelName || mt('voice.channel'), p.groupName || '').catch(() => undefined);

    const ss = useSessionStore.getState();
    if (ss.autoMic !== false) {
      const inputId = ss.audioInputId;
      try {
        await room.localParticipant.setMicrophoneEnabled(true, inputId ? { deviceId: inputId } : undefined);
      } catch {
        try {
          if (inputId) await room.localParticipant.setMicrophoneEnabled(true);
        } catch (e) {
          // web deviation: stay in the call (listening, muted) instead of hanging up
          console.warn('[voice] microphone failed', e);
        }
      }
    }
    if (gen !== E.gen) return;
    room.remoteParticipants.forEach((rp) => attachParticipantAudio(rp));
    applyVolumes();
    syncAudioBlocked(room);
    rebuild();
    void refreshPresence(p.channelId);
  } catch (e) {
    if (gen !== E.gen) return;
    console.warn('[voice] join failed', e);
    failJoin(p);
  }
}

/** iOS: any token / connect error → leave() silently. Web extras: DM caller notice, callee decline. */
function failJoin(p: VoicePresence): void {
  if (isCallPresence(p)) {
    if (p.isCaller) pushNotice(mt('voice.callFailed'));
    else dmsApi.declineCall(p.groupId).catch(() => undefined);
  }
  if (useSessionStore.getState().voicePresence?.channelId === p.channelId) useSessionStore.getState().leaveVoice();
}

function bindRoom(room: Room, gen: number): void {
  const live = () => gen === E.gen && room === E.room;
  const setState = (s: ConnState) => {
    if (useVoiceStore.getState().state !== s) useVoiceStore.setState({ state: s });
  };
  room.on(RoomEvent.ConnectionStateChanged, (cs: ConnectionState) => {
    if (!live()) return;
    if (cs === ConnectionState.Connected) {
      if (E.everConnected) setState('connected');
    } else if (cs === ConnectionState.Reconnecting || cs === ConnectionState.SignalReconnecting) {
      setState('reconnecting');
    } else if (cs === ConnectionState.Disconnected && E.everConnected) {
      setState('idle');
    }
    scheduleRebuild();
  });
  room.on(RoomEvent.Disconnected, () => {
    if (!live() || !E.everConnected) return;
    // iOS didDisconnectWithError → leave() (silent)
    if (useSessionStore.getState().voicePresence) useSessionStore.getState().leaveVoice();
  });
  room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
    if (!live()) return;
    if (track.kind === Track.Kind.Audio) {
      attachAudio(track);
      applyVolumes(participant.identity);
    }
    scheduleRebuild();
  });
  room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
    if (track.kind === Track.Kind.Audio) track.detach().forEach((el) => el.remove());
    if (live()) scheduleRebuild();
  });
  room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
    if (live()) syncAudioBlocked(room);
  });
  const rebuildEvents = [
    RoomEvent.ParticipantConnected,
    RoomEvent.ParticipantDisconnected,
    RoomEvent.ActiveSpeakersChanged,
    RoomEvent.TrackPublished,
    RoomEvent.TrackUnpublished,
    RoomEvent.TrackMuted,
    RoomEvent.TrackUnmuted,
    RoomEvent.LocalTrackPublished,
    RoomEvent.LocalTrackUnpublished,
    RoomEvent.ConnectionQualityChanged,
    RoomEvent.ParticipantMetadataChanged,
    RoomEvent.ParticipantNameChanged,
    RoomEvent.Reconnected,
  ] as const;
  for (const ev of rebuildEvents) {
    room.on(ev as RoomEvent.ParticipantConnected, () => {
      if (live()) scheduleRebuild();
    });
  }
  room.on(RoomEvent.Reconnected, () => {
    if (live()) setState('connected');
  });
}

function syncAudioBlocked(room: Room): void {
  const blocked = !room.canPlaybackAudio;
  if (useVoiceStore.getState().audioBlocked !== blocked) useVoiceStore.setState({ audioBlocked: blocked });
  if (blocked && !E.audioBlockedNotified) {
    E.audioBlockedNotified = true;
    pushNotice(mt('voice.tapToEnableAudio'));
  }
}

/** Resume remote audio (iOS autoplay policy) — call from any tap inside the voice UI. */
export function unlockVoiceAudio(): void {
  // no call (e.g. the mic-denied room): nothing to unlock — don't wake the audio hardware for nothing
  if (!useSessionStore.getState().voicePresence && !E.room) return;
  primeVoiceAudio();
  const room = E.room;
  if (room && !room.canPlaybackAudio) void room.startAudio().catch(() => undefined);
}

// ───────────────────────────── audio rendering & volumes ─────────────────────────────

function audioBox(): HTMLDivElement {
  if (!E.audioBox || !E.audioBox.isConnected) {
    const box = document.createElement('div');
    box.setAttribute('data-voice-audio', '');
    box.style.display = 'none';
    document.body.appendChild(box);
    E.audioBox = box;
  }
  return E.audioBox;
}

function attachAudio(track: RemoteTrack): void {
  if (track.attachedElements.length > 0) return;
  const el = track.attach();
  audioBox().appendChild(el);
}

function attachParticipantAudio(rp: RemoteParticipant): void {
  rp.audioTrackPublications.forEach((pub) => {
    if (pub.track && pub.isSubscribed) attachAudio(pub.track);
  });
}

function detachAllAudio(room: Room): void {
  room.remoteParticipants.forEach((rp) =>
    rp.audioTrackPublications.forEach((pub) => {
      try {
        pub.track?.detach().forEach((el) => el.remove());
      } catch {
        /* ignore */
      }
    }),
  );
}

function gainFor(id: string): number {
  const s = useVoiceStore.getState();
  if (s.isDeafened || s.mutedUsers[id]) return 0;
  return volumeOf(id, s.volumes);
}

/** deafen > local mute > per-user volume, applied to mic AND screen-share audio. */
function applyVolumes(identity?: string): void {
  const room = E.room;
  if (!room) return;
  room.remoteParticipants.forEach((rp) => {
    if (identity && rp.identity !== identity) return;
    // never exactly 0: LiveKit skips a falsy volume when it rebuilds the gain node on re-attach
    const g = Math.max(gainFor(rp.identity), 0.000001);
    for (const src of [Track.Source.Microphone, Track.Source.ScreenShareAudio] as const) {
      try {
        rp.setVolume(g, src);
      } catch {
        try {
          rp.setVolume(Math.min(1, g), src);
        } catch {
          /* track not ready */
        }
      }
    }
  });
}

// ───────────────────────────── members snapshot ─────────────────────────────

function mapQuality(q: ConnectionQuality): VoiceQuality {
  switch (q) {
    case ConnectionQuality.Excellent:
      return 'excellent';
    case ConnectionQuality.Good:
      return 'good';
    case ConnectionQuality.Poor:
    case ConnectionQuality.Lost:
      return 'poor';
    default:
      return 'unknown';
  }
}

function imagePathOf(p: Participant): string {
  try {
    const meta = JSON.parse(p.metadata || '{}') as { image_path?: string };
    return meta.image_path || '';
  } catch {
    return '';
  }
}

function liveVideo(p: Participant, source: Track.Source, isLocal: boolean): VideoTrack | null {
  const pub = p.getTrackPublication(source);
  if (!pub || !pub.track || pub.isMuted) return null;
  if (!isLocal && !(pub as RemoteTrackPublication).isSubscribed) return null;
  return pub.track as VideoTrack;
}

function memberOf(p: Participant, isLocal: boolean): VoiceMember {
  const id = p.identity;
  return {
    id,
    name: p.name || id,
    imagePath: imagePathOf(p),
    isSpeaking: p.isSpeaking,
    isMuted: !p.isMicrophoneEnabled,
    isLocal,
    quality: mapQuality(p.connectionQuality),
    cameraTrack: liveVideo(p, Track.Source.Camera, isLocal),
    screenTrack: liveVideo(p, Track.Source.ScreenShare, isLocal),
  };
}

function scheduleRebuild(): void {
  if (E.rebuildQueued) return;
  E.rebuildQueued = true;
  queueMicrotask(() => {
    E.rebuildQueued = false;
    rebuild();
  });
}

function rebuild(): void {
  const room = E.room;
  if (!room || !E.everConnected) return;
  const lp = room.localParticipant;
  const list: VoiceMember[] = [memberOf(lp, true)];
  room.remoteParticipants.forEach((rp) => list.push(memberOf(rp, false)));
  list.sort((a, b) => {
    if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1;
    const an = a.name.toLowerCase();
    const bn = b.name.toLowerCase();
    return an < bn ? -1 : an > bn ? 1 : 0;
  });
  const state = useVoiceStore.getState().state;
  // join / leave sounds — only in stable `connected`, first tick seeds silently
  if (state === 'connected') {
    const ids = new Set(list.filter((m) => !m.isLocal).map((m) => m.id));
    const known = E.knownRemote;
    if (known) {
      const { sound, soundVolume } = useNotificationStore.getState();
      if (sound) {
        if ([...ids].some((id) => !known.has(id))) playVoiceJoinSound(soundVolume);
        if ([...known].some((id) => !ids.has(id))) playVoiceLeaveSound(soundVolume);
      }
    }
    E.knownRemote = ids;
  }
  useVoiceStore.setState({
    members: list,
    isMuted: !lp.isMicrophoneEnabled,
    isCameraOn: lp.isCameraEnabled,
  });
  // desktop ParticipantSync equivalent (active-channel participants for shared UI)
  const parts = list.map((m) => ({ identity: m.id, name: m.name, image_path: m.imagePath }));
  const key = JSON.stringify(parts);
  if (key !== E.participantsKey) {
    E.participantsKey = key;
    useSessionStore.getState().setVoiceParticipants(parts);
  }
}

async function refreshPresence(channelId: string): Promise<void> {
  try {
    const list = await voiceApi.listParticipants(channelId);
    E.qc?.setQueryData(['voice-participants', channelId], list);
  } catch {
    /* ignore */
  }
}

// ───────────────────────────── controls ─────────────────────────────

export async function toggleMic(): Promise<void> {
  const room = E.room;
  if (!room || useVoiceStore.getState().state !== 'connected') return;
  const lp = room.localParticipant;
  const enable = !lp.isMicrophoneEnabled;
  const inputId = useSessionStore.getState().audioInputId;
  try {
    await lp.setMicrophoneEnabled(enable, enable && inputId ? { deviceId: inputId } : undefined);
  } catch {
    if (enable && inputId) await lp.setMicrophoneEnabled(true).catch(() => undefined);
  }
  rebuild();
}

/** Deafen = every remote track's playback gain → 0 (mic untouched). Reset on every join. */
export function toggleDeafen(): void {
  useVoiceStore.setState((s) => ({ isDeafened: !s.isDeafened }));
}

export async function toggleCamera(): Promise<void> {
  const room = E.room;
  if (!room || useVoiceStore.getState().state !== 'connected') return;
  const lp = room.localParticipant;
  const on = lp.isCameraEnabled;
  const camId = useSessionStore.getState().videoInputId;
  try {
    await lp.setCameraEnabled(!on, !on ? (camId ? { deviceId: camId } : { facingMode: 'user' }) : undefined);
  } catch (e) {
    console.warn('[voice] camera failed', e);
    pushNotice(mt('voice.cameraError'));
  }
  rebuild();
}

/** Active device id of the room (devices sheet "current" mark). */
export function activeDevice(kind: MediaDeviceKind): string | undefined {
  return E.room?.getActiveDevice(kind);
}

// ───────────────────────────── join / leave flows ─────────────────────────────

/** Mic permission preflight — must start synchronously inside the tap (iOS asks here). */
function requestMicPermission(): Promise<boolean> {
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  if (!md?.getUserMedia) return Promise.resolve(false);
  const inputId = useSessionStore.getState().audioInputId;
  let p: Promise<MediaStream>;
  try {
    p = md.getUserMedia({ audio: inputId ? { deviceId: inputId } : true });
  } catch (e) {
    p = Promise.reject(e);
  }
  return p.then(
    (stream) => {
      stream.getTracks().forEach((t) => t.stop());
      return true;
    },
    (e: unknown) => {
      const name = (e as { name?: string } | null)?.name;
      // only an explicit refusal is "no microphone"; a missing device still lets you listen
      return !(name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError');
    },
  );
}

export interface JoinOptions {
  channelId: string;
  /** Room title: channel name, or the peer's name for DM calls. */
  name: string;
  groupId: string;
  groupName: string;
  call?: { isCaller: boolean; peerName: string; peerImagePath?: string | null };
}

/**
 * iOS `VoiceStore.join`: same room → just open it; another room → leave it first (no confirmation);
 * mic preflight (denied → room sheet in the "no microphone" state, no presence); then mark active
 * and open the room sheet in the connecting state. Resolves true when the presence was set.
 */
export async function joinVoiceFlow(o: JoinOptions): Promise<boolean> {
  const ss = useSessionStore.getState();
  if (ss.voicePresence?.channelId === o.channelId) {
    setShowRoom(true);
    return true;
  }
  const gen = ++joinGen;
  // leave FIRST: its teardown suspends the shared AudioContext; priming afterwards (still inside the tap)
  // queues the resume behind that suspend, so the next room starts with running audio (iOS needs the gesture)
  if (ss.voicePresence) ss.leaveVoice(); // engine: disconnect + /voice/leave + DM cancel (not awaited)
  primeVoiceAudio();
  if (useVoiceStore.getState().permissionDenied) useVoiceStore.setState({ permissionDenied: false, deniedName: null });
  const ok = await requestMicPermission();
  if (gen !== joinGen) return false;
  if (!ok) {
    useVoiceStore.setState({ permissionDenied: true, deniedName: o.name, state: 'idle', members: [], showRoom: true });
    releaseIdleAudio();
    return false;
  }
  useSessionStore.getState().joinVoice(
    o.channelId,
    o.name,
    o.groupName,
    o.groupId,
    o.call
      ? { isCall: true, isCaller: o.call.isCaller, peerName: o.call.peerName, peerImagePath: o.call.peerImagePath || undefined }
      : undefined,
  );
  setShowRoom(true);
  return true;
}

/** Hang up (room controls / floating bar / mic-denied state). */
export function leaveVoiceFlow(): void {
  joinGen++;
  const vs = useVoiceStore.getState();
  if (vs.permissionDenied) useVoiceStore.setState({ permissionDenied: false, deniedName: null });
  setShowRoom(false);
  const ss = useSessionStore.getState();
  if (ss.voicePresence) ss.leaveVoice();
  else releaseIdleAudio(); // e.g. the mic-denied room: taps there resumed the shared context
}

/**
 * Entry points prime (resume) the shared AudioContext inside the tap; when the attempt ends without a call
 * (call setup / mic refused / hang-up in the denied state) nothing else would suspend it again.
 */
function releaseIdleAudio(): void {
  if (!useSessionStore.getState().voicePresence && !E.room) suspendVoiceAudio();
}

/** iOS `startDMCall`. */
export async function startDmCallFlow(o: { groupId: string; peerName: string; peerImagePath?: string | null }): Promise<void> {
  const cur = useSessionStore.getState().voicePresence;
  if (cur && cur.groupId === o.groupId && isCallPresence(cur)) {
    setShowRoom(true);
    return;
  }
  primeVoiceAudio();
  let resp: Awaited<ReturnType<typeof dmsApi.initiateCall>>;
  try {
    resp = await dmsApi.initiateCall(o.groupId);
  } catch {
    pushNotice(mt('voice.callFailed'));
    releaseIdleAudio();
    return;
  }
  const name = o.peerName || resp.peer?.display_name || resp.peer?.username || '';
  const ok = await joinVoiceFlow({
    channelId: resp.voice_chat_id,
    name,
    groupId: o.groupId,
    groupName: name,
    call: { isCaller: true, peerName: name, peerImagePath: o.peerImagePath ?? resp.peer?.image_path ?? null },
  });
  if (!ok && useSessionStore.getState().voicePresence?.channelId !== resp.voice_chat_id) {
    // the peer may already be ringing from our POST — stop it
    dmsApi.cancelCall(o.groupId).catch(() => undefined);
    if (useVoiceStore.getState().permissionDenied) pushNotice(mt('voice.callFailed'));
  }
}

// ───────────────────────────── incoming calls ─────────────────────────────

function vibrate(): void {
  try {
    navigator.vibrate?.([300, 150, 300]);
  } catch {
    /* ignore */
  }
}

/** Nothing uses the shared AudioContext (no call, no room, no ring) → it may be suspended. */
function isAudioIdle(): boolean {
  return !useSessionStore.getState().voicePresence && !E.room && !isRingerActive();
}

function startRing(): void {
  stopVibrate(); // the ringer replaces its own previous ring (no suspend/resume churn in between)
  // through the shared, gesture-unlocked context (iOS Safari), falling back to utils/ringtone
  startVoiceRinger(useNotificationStore.getState().ringtoneVolume);
  vibrate();
  E.vibrateTimer = window.setInterval(vibrate, 2000);
}

function stopRing(): void {
  const wasRinging = isRingerActive();
  stopVoiceRinger();
  // release the audio hardware; Accept primes it again right after (resume queued behind this suspend)
  if (wasRinging && isAudioIdle()) suspendVoiceAudio();
  stopVibrate();
}

function stopVibrate(): void {
  if (E.vibrateTimer) {
    window.clearInterval(E.vibrateTimer);
    E.vibrateTimer = 0;
    try {
      navigator.vibrate?.(0);
    } catch {
      /* ignore */
    }
  }
}

function clearIncoming(): void {
  E.ringToken++;
  stopRing();
  closeCallNotification();
  if (useVoiceStore.getState().incoming) useVoiceStore.setState({ incoming: null });
}

function closeCallNotification(): void {
  const n = E.callNotification;
  E.callNotification = null;
  try {
    n?.close();
  } catch {
    /* ignore */
  }
}

function handleIncoming(ev: IncomingCallEvent): void {
  const me = useAuthStore.getState().user?.id;
  if (me && ev.caller.id === me) return;
  if (useSessionStore.getState().voicePresence?.channelId === ev.voice_chat_id) return; // already in that room
  const now = Date.now();
  for (const [k, t] of E.recentIncoming) if (now - t >= DEDUP_MS) E.recentIncoming.delete(k);
  if (E.recentIncoming.has(ev.voice_chat_id)) return;
  E.recentIncoming.set(ev.voice_chat_id, now);

  // a second call replaces the first (single slot), restarting the timer and the ringer decision
  closeCallNotification();
  useVoiceStore.setState({ incoming: ev });
  const dms = E.qc?.getQueryData<DMItem[]>(['dms']) ?? [];
  const dmChatId = Array.isArray(dms) ? dms.find((d) => d.group_id === ev.group_id)?.chat_id : undefined;
  const ns = useNotificationStore.getState();
  const muted = dmChatId ? ns.mutedChats[dmChatId] === true : false;
  if (ns.sound && !muted) startRing();
  else stopRing();

  const token = ++E.ringToken;
  window.setTimeout(() => {
    if (E.ringToken === token && useVoiceStore.getState().incoming?.voice_chat_id === ev.voice_chat_id) clearIncoming();
  }, RING_TIMEOUT_MS);

  // OS notification only while the tab is hidden (the card is visible otherwise)
  if (
    !muted &&
    typeof document !== 'undefined' &&
    document.visibilityState === 'hidden' &&
    typeof Notification !== 'undefined' &&
    Notification.permission === 'granted'
  ) {
    try {
      const n = new Notification(mt('voice.incomingCall'), {
        body: ev.caller.display_name || ev.caller.username,
        icon: ev.caller.image_path || '/logo.png',
        tag: `call-${ev.voice_chat_id}`,
      });
      n.onclick = () => {
        window.focus();
        n.close();
      };
      E.callNotification = n;
      window.setTimeout(() => {
        if (E.callNotification === n) E.callNotification = null;
        n.close();
      }, RING_TIMEOUT_MS);
    } catch {
      /* ignore */
    }
  }
}

/** Accept the incoming call: leave any current room, join the DM voice chat, open the room. */
export async function acceptIncomingFlow(): Promise<void> {
  const call = useVoiceStore.getState().incoming;
  if (!call) return;
  clearIncoming();
  const name = call.caller.display_name || call.caller.username;
  const ok = await joinVoiceFlow({
    channelId: call.voice_chat_id,
    name,
    groupId: call.group_id,
    groupName: name,
    call: { isCaller: false, peerName: name, peerImagePath: call.caller.image_path || null },
  });
  // couldn't join → tell the caller (otherwise he rings forever)
  if (!ok && useSessionStore.getState().voicePresence?.channelId !== call.voice_chat_id) {
    dmsApi.declineCall(call.group_id).catch(() => undefined);
  }
}

export function declineIncomingFlow(): void {
  const call = useVoiceStore.getState().incoming;
  if (!call) return;
  clearIncoming();
  dmsApi.declineCall(call.group_id).catch(() => undefined);
}

function handleDeclined(ev: CallDeclinedEvent): void {
  const p = useSessionStore.getState().voicePresence;
  // iOS: only when it concerns MY current DM call
  if (!p || p.groupId !== ev.group_id || !isCallPresence(p)) return;
  const now = Date.now();
  for (const [k, t] of E.recentDeclines) if (now - t > 10_000) E.recentDeclines.delete(k);
  if (E.recentDeclines.has(ev.group_id)) return;
  E.recentDeclines.set(ev.group_id, now);
  const name = ev.decliner.display_name || ev.decliner.username;
  leaveVoiceFlow();
  pushNotice(mt('voice.callDeclinedBy', name));
}

// ───────────────────────────── reset (logout) ─────────────────────────────

/** iOS `voice.reset()`: call BEFORE clearing the auth tokens (leave + DM cancel are still authorised). */
export function resetVoice(): void {
  clearIncoming();
  E.recentIncoming.clear();
  useVoiceStore.setState({ notice: null });
  leaveVoiceFlow();
}

function resetVoiceLocal(): void {
  clearIncoming();
  E.recentIncoming.clear();
  joinGen++;
  useVoiceStore.setState({ notice: null, permissionDenied: false, deniedName: null, showRoom: false });
  if (useSessionStore.getState().voicePresence) {
    E.suppressNetwork = true;
    try {
      useSessionStore.getState().leaveVoice();
    } finally {
      E.suppressNetwork = false;
    }
  }
}
