// Mobile voice UI state (iOS VoiceStore observable surface).
// Not persisted — except the per-user local volumes / mutes, which share the desktop
// localStorage key 'cord-voice-user-settings' (same {volumes, mutedUsers} shape, 0–3 range).
import { create } from 'zustand';
import type { VideoTrack } from 'livekit-client';
import type { IncomingCallEvent } from '../../../hooks/useWebSocket';

export type ConnState = 'idle' | 'connecting' | 'connected' | 'reconnecting';
export type VoiceQuality = 'unknown' | 'poor' | 'good' | 'excellent';

/** UI snapshot of one participant (iOS `VoiceMember`). */
export interface VoiceMember {
  /** LiveKit identity == userId */
  id: string;
  name: string;
  imagePath: string;
  isSpeaking: boolean;
  /** Their microphone is off (NOT my local mute). */
  isMuted: boolean;
  isLocal: boolean;
  quality: VoiceQuality;
  /** Live camera track (published, subscribed, not muted) — null otherwise. */
  cameraTrack: VideoTrack | null;
  /** Subscribed screen-share track — null otherwise. */
  screenTrack: VideoTrack | null;
}

export type IncomingCall = IncomingCallEvent;

interface VoiceUiState {
  state: ConnState;
  /** Sorted: local first, then remotes by name (case-insensitive). */
  members: VoiceMember[];
  isMuted: boolean;
  isDeafened: boolean;
  isCameraOn: boolean;
  /** Room sheet visible (iOS `showRoom`). Collapsing never ends the call. */
  showRoom: boolean;
  /** Mic permission denied on the last join (room shows the "no microphone" state). */
  permissionDenied: boolean;
  deniedName: string | null;
  incoming: IncomingCall | null;
  notice: { id: number; text: string } | null;
  volumes: Record<string, number>;
  mutedUsers: Record<string, boolean>;
  /** Remote audio is blocked by the browser autoplay policy (needs a tap). */
  audioBlocked: boolean;
}

const STORAGE_KEY = 'cord-voice-user-settings';

function loadSettings(): { volumes: Record<string, number>; mutedUsers: Record<string, boolean> } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const j = JSON.parse(raw) as { volumes?: Record<string, number>; mutedUsers?: Record<string, boolean> };
      return { volumes: j.volumes ?? {}, mutedUsers: j.mutedUsers ?? {} };
    }
  } catch {
    /* ignore */
  }
  return { volumes: {}, mutedUsers: {} };
}

function saveSettings(volumes: Record<string, number>, mutedUsers: Record<string, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ volumes, mutedUsers }));
  } catch {
    /* ignore */
  }
}

const initial = loadSettings();

export const useVoiceStore = create<VoiceUiState>()(() => ({
  state: 'idle',
  members: [],
  isMuted: false,
  isDeafened: false,
  isCameraOn: false,
  showRoom: false,
  permissionDenied: false,
  deniedName: null,
  incoming: null,
  notice: null,
  volumes: initial.volumes,
  mutedUsers: initial.mutedUsers,
  audioBlocked: false,
}));

/** Per-user playback volume 0…3 (1 = 100%). */
export function volumeOf(id: string, volumes = useVoiceStore.getState().volumes): number {
  const v = volumes[id];
  return Number.isFinite(v) ? Math.max(0, Math.min(3, v)) : 1;
}

export function isLocallyMuted(id: string, muted = useVoiceStore.getState().mutedUsers): boolean {
  return !!muted[id];
}

export function setUserVolume(id: string, v: number): void {
  const clamped = Math.max(0, Math.min(3, v));
  const s = useVoiceStore.getState();
  const volumes = { ...s.volumes };
  if (Math.abs(clamped - 1) < 0.001) delete volumes[id];
  else volumes[id] = clamped;
  useVoiceStore.setState({ volumes });
  saveSettings(volumes, s.mutedUsers);
}

export function toggleUserMute(id: string): void {
  const s = useVoiceStore.getState();
  const mutedUsers = { ...s.mutedUsers };
  if (mutedUsers[id]) delete mutedUsers[id];
  else mutedUsers[id] = true;
  useVoiceStore.setState({ mutedUsers });
  saveSettings(s.volumes, mutedUsers);
}

let noticeSeq = 0;
/** Capsule toast at the top; replaces the current one and auto-clears after 4 s. */
export function pushNotice(text: string): void {
  const id = ++noticeSeq;
  useVoiceStore.setState({ notice: { id, text } });
  window.setTimeout(() => {
    if (useVoiceStore.getState().notice?.id === id) useVoiceStore.setState({ notice: null });
  }, 4000);
}

export function setShowRoom(v: boolean): void {
  if (useVoiceStore.getState().showRoom !== v) useVoiceStore.setState({ showRoom: v });
}
