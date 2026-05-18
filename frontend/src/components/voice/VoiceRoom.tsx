// Voice room component based on LiveKit.

import { useCallback, useEffect, useRef, useState, createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useParticipants,
  useLocalParticipant,
  useIsSpeaking,
  useConnectionState,
  useTracks,
  useRoomContext,
} from '@livekit/components-react';
import { ConnectionState, Track, RemoteParticipant, RemoteAudioTrack, ScreenSharePresets, VideoPreset, AudioPresets, type RoomOptions } from 'livekit-client';
import {
  Mic, MicOff, PhoneOff, Loader2, WifiOff,
  MonitorUp, MonitorOff, X, Volume2, VolumeX,
  Maximize, Minimize, Headphones, HeadphoneOff,
  MoreVertical, Signal, MessageSquare, Video, VideoOff, ArrowLeftRight,
  PanelBottom, PanelRight,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { voiceApi } from '../../api/voice';
import { dmsApi } from '../../api/dms';
import { pushRichToast } from '../../hooks/useUnreadCounts';
import { useSessionStore } from '../../store/sessionStore';
import { useAuthStore } from '../../store/authStore';
import { useNotificationStore } from '../../store/notificationStore';
import { playVoiceJoinSound, playVoiceLeaveSound } from '../../utils/notificationSound';
import { activateVoiceGuard, deactivateVoiceGuard } from '../../utils/voiceBackgroundGuard';
import { useT } from '../../i18n';

import '@livekit/components-styles';

// ─── Persistence helpers ────────────────────────────────────────────

const STORAGE_KEY = 'cord-voice-user-settings';

interface PersistedVoiceSettings {
  volumes: Record<string, number>;
  mutedUsers: Record<string, boolean>;
}

function loadVoiceSettings(): PersistedVoiceSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { volumes: {}, mutedUsers: {} };
}

function saveVoiceSettings(s: PersistedVoiceSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

// ─── Per-user volume context ────────────────────────────────────────

interface UserVolumeCtx {
  volumes: Record<string, number>;
  mutedUsers: Record<string, boolean>;
  deafened: boolean;
  setUserVolume: (identity: string, vol: number) => void;
  toggleUserMute: (identity: string) => void;
  openMenuId: string | null;
  setOpenMenuId: (id: string | null) => void;
}

const VolumeContext = createContext<UserVolumeCtx>({
  volumes: {},
  mutedUsers: {},
  deafened: false,
  setUserVolume: () => {},
  toggleUserMute: () => {},
  openMenuId: null,
  setOpenMenuId: () => {},
});

// ─── Applies volume to remote participants via Web Audio GainNode ────

const audioGains = new Map<string, { ctx: AudioContext; gain: GainNode; streamId: string }>();

function getOrCreateGain(identity: string, stream: MediaStream): GainNode | null {
  const existing = audioGains.get(identity);
  if (existing && existing.streamId === stream.id) return existing.gain;

  // Clean up old entry if stream changed
  if (existing) {
    try { existing.ctx.close(); } catch {}
    audioGains.delete(identity);
  }

  try {
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    source.connect(gain);
    gain.connect(ctx.destination);
    audioGains.set(identity, { ctx, gain, streamId: stream.id });
    return gain;
  } catch {
    return null;
  }
}

function VolumeApplier() {
  const participants = useParticipants();
  const { volumes, mutedUsers, deafened } = useContext(VolumeContext);

  useEffect(() => {
    for (const p of participants) {
      if (!(p instanceof RemoteParticipant)) continue;
      const vol = deafened || mutedUsers[p.identity]
        ? 0
        : Math.max(0, Math.min(3, Number.isFinite(volumes[p.identity]) ? volumes[p.identity] : 1));

      for (const pub of p.audioTrackPublications.values()) {
        if (!pub.track || pub.source !== Track.Source.Microphone) continue;
        const track = pub.track as RemoteAudioTrack;
        try {
          const stream = (track as any).mediaStream as MediaStream | undefined;
          if (stream) {
            // Use GainNode for full 0-300% range
            const gain = getOrCreateGain(p.identity, stream);
            if (gain) {
              gain.gain.value = vol;
              // Mute the original element to avoid double audio
              track.setVolume(0);
              continue;
            }
          }
          // Fallback: no stream available, use native (0-1 only)
          track.setVolume(Math.min(vol, 1));
        } catch {
          // track not ready
        }
      }
    }
  }, [participants, volumes, mutedUsers, deafened]);

  // Remove gain nodes for participants that left
  useEffect(() => {
    const activeIds = new Set<string>();
    for (const p of participants) {
      if (p instanceof RemoteParticipant) activeIds.add(p.identity);
    }
    for (const [id, entry] of audioGains) {
      if (!activeIds.has(id)) {
        try { entry.ctx.close(); } catch {}
        audioGains.delete(id);
      }
    }
  }, [participants]);

  // Cleanup all gain nodes on unmount
  useEffect(() => {
    return () => {
      for (const [, entry] of audioGains) {
        try { entry.ctx.close(); } catch {}
      }
      audioGains.clear();
    };
  }, []);

  return null;
}

// ─── Participant connection quality indicator ───────────────────────

// connectionQuality can be a number (0-3) or a string ("excellent","good","poor","unknown","lost")
function parseQuality(raw: any): number {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    const map: Record<string, number> = { excellent: 3, good: 2, poor: 1, lost: 0, unknown: 0 };
    return map[raw.toLowerCase()] ?? 0;
  }
  return 0;
}

function QualityIndicator({ participant, small }: { participant: any; small?: boolean }) {
  const t = useT();
  const [quality, setQuality] = useState(0);

  useEffect(() => {
    const update = () => setQuality(parseQuality(participant.connectionQuality));
    update();
    participant.on?.('connectionQualityChanged', update);
    const iv = setInterval(update, 3000);
    return () => {
      participant.off?.('connectionQualityChanged', update);
      clearInterval(iv);
    };
  }, [participant]);

  const color = quality >= 3 ? '#22c55e' : quality === 2 ? '#eab308' : quality === 1 ? '#ef4444' : '#6b7280';
  const bg = quality >= 3 ? 'bg-green-500/20' : quality === 2 ? 'bg-yellow-500/20' : quality === 1 ? 'bg-red-500/20' : 'bg-white/10';
  const label = [t('voice.quality.unknown'), t('voice.quality.poor'), t('voice.quality.good'), t('voice.quality.excellent')][quality] ?? t('voice.quality.unknown');

  const barData = small
    ? [{ h: 3, t: 1 }, { h: 5, t: 2 }, { h: 7, t: 3 }]
    : [{ h: 4, t: 1 }, { h: 7, t: 2 }, { h: 10, t: 3 }];

  return (
    <div className={`${bg} rounded-md ${small ? 'p-0.5 px-1' : 'p-1 px-1.5'} flex items-end gap-[2px]`} title={`${t('screen.quality')}: ${label}`}>
      {barData.map((b, i) => (
        <div
          key={i}
          className={`${small ? 'w-[2px]' : 'w-[3px]'} rounded-sm`}
          style={{
            height: b.h,
            backgroundColor: quality >= b.t ? color : 'rgba(255,255,255,0.15)',
          }}
        />
      ))}
    </div>
  );
}

// ─── Connection stats hook ──────────────────────────────────────────

interface ConnectionStats {
  latency: number;
  bitrateUp: number;
  bitrateDown: number;
  packetLoss: number;
  codec: string;
}

// Recursively searches for RTCPeerConnection in an object (depth 3)
function findPeerConnections(obj: any, depth = 0): RTCPeerConnection[] {
  if (!obj || depth > 3) return [];
  const pcs: RTCPeerConnection[] = [];
  if (obj instanceof RTCPeerConnection) return [obj];
  if (typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      try {
        const val = obj[key];
        if (val instanceof RTCPeerConnection) pcs.push(val);
        else if (typeof val === 'object' && val !== null && !(val instanceof HTMLElement)) {
          pcs.push(...findPeerConnections(val, depth + 1));
        }
      } catch { /* skip */ }
    }
  }
  return pcs;
}

function useConnectionStats(): ConnectionStats {
  const room = useRoomContext();
  const [stats, setStats] = useState<ConnectionStats>({ latency: 0, bitrateUp: 0, bitrateDown: 0, packetLoss: 0, codec: '...' });

  useEffect(() => {
    let prev: { bytesSent: number; bytesReceived: number; ts: number } | null = null;

    const poll = async () => {
      try {
        // Get all PeerConnections from room
        const pcs = findPeerConnections(room);
        if (pcs.length === 0) return;

        let bytesSent = 0;
        let bytesReceived = 0;
        let packetsLost = 0;
        let packetsTotal = 0;
        let latency = 0;
        let codec = '';

        for (const pc of pcs) {
          const rtcStats = await pc.getStats();
          // Collect codecs into a separate map
          const codecMap = new Map<string, string>();
          rtcStats.forEach((report: any) => {
            if (report.type === 'codec' && report.mimeType) {
              codecMap.set(report.id, report.mimeType.split('/')[1] ?? '');
            }
          });

          rtcStats.forEach((report: any) => {
            // Ping from candidate-pair
            if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.currentRoundTripTime) {
              latency = Math.round(report.currentRoundTripTime * 1000);
            }
            // Inbound traffic
            if (report.type === 'inbound-rtp') {
              bytesReceived += report.bytesReceived ?? 0;
              packetsLost += report.packetsLost ?? 0;
              packetsTotal += (report.packetsReceived ?? 0) + (report.packetsLost ?? 0);
              if (!codec && report.codecId) {
                codec = codecMap.get(report.codecId) ?? '';
              }
            }
            // Outbound traffic
            if (report.type === 'outbound-rtp') {
              bytesSent += report.bytesSent ?? 0;
              if (!codec && report.codecId) {
                codec = codecMap.get(report.codecId) ?? '';
              }
            }
          });
        }

        const now = Date.now();
        if (prev) {
          const dt = (now - prev.ts) / 1000;
          if (dt > 0) {
            setStats({
              latency,
              bitrateUp: Math.round(((bytesSent - prev.bytesSent) * 8) / dt / 1000),
              bitrateDown: Math.round(((bytesReceived - prev.bytesReceived) * 8) / dt / 1000),
              packetLoss: packetsTotal > 0 ? Math.round((packetsLost / packetsTotal) * 100 * 10) / 10 : 0,
              codec: codec || '?',
            });
          }
        } else {
          setStats((s) => ({ ...s, latency, codec: codec || '?' }));
        }
        prev = { bytesSent, bytesReceived, ts: now };
      } catch { /* stats not available */ }
    };

    poll();
    const iv = setInterval(poll, 2000);
    return () => clearInterval(iv);
  }, [room]);

  return stats;
}

// ─── Connection stats panel ─────────────────────────────────────────

function StatsPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const stats = useConnectionStats();
  const latencyColor = stats.latency < 80 ? 'text-green-400' : stats.latency < 150 ? 'text-yellow-400' : 'text-red-400';

  return createPortal(
    <div className="fixed inset-0 z-50" onMouseDown={onClose}>
      <div
        className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-[var(--bg-secondary)] rounded-xl shadow-2xl border border-[var(--border-color)] p-4 w-64"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <p className="text-xs font-semibold text-[var(--text-primary)] mb-3">{t('stats.connection')}</p>
        <div className="space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-[var(--text-muted)]">{t('stats.ping')}</span>
            <span className={`font-medium ${latencyColor}`}>{stats.latency} {t('stats.ms')}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--text-muted)]">{t('stats.up')}</span>
            <span className="text-[var(--text-secondary)] font-medium">{stats.bitrateUp} {t('stats.kbps')}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--text-muted)]">{t('stats.down')}</span>
            <span className="text-[var(--text-secondary)] font-medium">{stats.bitrateDown} {t('stats.kbps')}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--text-muted)]">{t('stats.loss')}</span>
            <span className={`font-medium ${stats.packetLoss > 5 ? 'text-red-400' : stats.packetLoss > 1 ? 'text-yellow-400' : 'text-green-400'}`}>{stats.packetLoss}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--text-muted)]">{t('stats.codec')}</span>
            <span className="text-[var(--text-secondary)] font-medium">{stats.codec}</span>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Participant avatar from metadata ───────────────────────────────

function getParticipantAvatar(participant: any): string {
  try {
    const meta = JSON.parse(participant.metadata || '{}');
    return meta.image_path || '';
  } catch { return ''; }
}

function ParticipantAvatar({ participant, size, bgClass }: { participant: any; size: number; bgClass?: string }) {
  const avatar = getParticipantAvatar(participant);
  const initials = (participant.name || participant.identity || '?').slice(0, 2).toUpperCase();

  if (avatar) {
    return <img src={avatar} alt="" className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />;
  }
  return (
    <div className={`rounded-full flex items-center justify-center text-white font-bold shrink-0 ${bgClass ?? 'bg-[var(--accent)]'}`} style={{ width: size, height: size, fontSize: size * 0.35 }}>
      {initials}
    </div>
  );
}

// ─── Reusable volume slider component ───────────────────────────────

function VolumeSlider({ identity, compact }: { identity: string; compact?: boolean }) {
  const t = useT();
  const { volumes, mutedUsers, setUserVolume, toggleUserMute } = useContext(VolumeContext);
  const vol = volumes[identity] ?? 1;
  const muted = !!mutedUsers[identity];

  return (
    <div className={compact ? 'flex items-center gap-2' : ''}>
      {/* Mute button */}
      <button
        onClick={(e) => { e.stopPropagation(); toggleUserMute(identity); }}
        className={`
          ${compact ? 'p-1' : 'w-full flex items-center gap-2 px-3 py-2 mb-2'} rounded-lg text-sm transition-colors
          ${muted ? 'text-[var(--danger)]' : 'text-[var(--text-secondary)] hover:bg-white/10'}
        `}
        title={muted ? t('user.unmute') : t('user.mute')}
      >
        {muted ? <VolumeX size={compact ? 14 : 16} /> : <Volume2 size={compact ? 14 : 16} />}
        {!compact && <span>{muted ? t('user.unmute') : t('user.mute')}</span>}
      </button>

      {/* Slider */}
      <div className={compact ? 'flex items-center gap-2' : ''}>
        {!compact && (
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-[var(--text-muted)]">{t('user.volume')}</span>
            <span className="text-xs text-[var(--text-secondary)] font-medium">{Math.round(vol * 100)}%</span>
          </div>
        )}
        <input
          type="range"
          min={0}
          max={300}
          value={Math.round(vol * 100)}
          onChange={(e) => { e.stopPropagation(); setUserVolume(identity, Number(e.target.value) / 100); }}
          className={`accent-[var(--accent)] h-1.5 ${compact ? 'w-20' : 'w-full'}`}
          disabled={muted}
        />
        {compact && (
          <span className="text-[10px] text-[var(--text-muted)] w-8 text-right">{Math.round(vol * 100)}%</span>
        )}
        {!compact && (
          <div className="flex justify-between text-[10px] text-[var(--text-muted)] mt-0.5">
            <span>0%</span>
            <span>300%</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── "..." dropdown menu for participant ────────────────────────────

function UserMenu({ participant, anchorRef, onClose }: {
  participant: any;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const isSelf = participant.identity === currentUserId;

  useEffect(() => {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      const menuW = 220;
      const menuH = isSelf ? 120 : 180;
      let top = rect.bottom + 4;
      let left = rect.left;
      // If overflows right edge
      if (left + menuW > window.innerWidth) left = window.innerWidth - menuW - 8;
      // If overflows bottom edge — show above
      if (top + menuH > window.innerHeight) top = rect.top - menuH - 4;
      setPos({ top, left });
    }
  }, [anchorRef, isSelf]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) &&
          anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, anchorRef]);

  if (!pos) return null;

  const name = participant.name || participant.identity;
  const itemCls = 'flex items-center gap-2 w-full px-2 py-1.5 rounded text-sm text-[var(--text-secondary)] hover:bg-white/10 hover:text-[var(--text-primary)] transition-colors';

  // Открытие DM: participant.identity — это user.id, этого хватает для openWith.
  const openDM = async () => {
    try {
      const dm = await dmsApi.openWith(participant.identity);
      useSessionStore.getState().setLastGroup(dm.group_id);
      useSessionStore.getState().setLastChannel(dm.chat_id);
      useSessionStore.getState().setDmMode(true);
      navigate('/app');
    } finally {
      onClose();
    }
  };

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 bg-[var(--bg-secondary)] rounded-xl shadow-2xl p-3 w-[220px] border border-[var(--border-color)]"
      style={{ top: pos.top, left: pos.left }}
    >
      <p className="text-xs font-semibold text-[var(--text-primary)] truncate mb-2 px-1">{name}</p>
      {/* DM — не показываем для самого себя (нельзя открыть чат с собой) */}
      {!isSelf && (
        <>
          <button onClick={openDM} className={itemCls}>
            <MessageSquare size={14} />
            {t('user.openChat')}
          </button>
          <div className="h-px bg-[var(--border-color)] my-1.5" />
        </>
      )}
      <VolumeSlider identity={participant.identity} />
    </div>,
    document.body
  );
}

// ─── Screen share settings ──────────────────────────────────────────

interface ScreenShareSettings {
  resolution: '720' | '1080' | '1440' | 'source';
  fps: number;
  audio: boolean;
}

const DEFAULT_SETTINGS: ScreenShareSettings = {
  resolution: '1080',
  fps: 30,
  audio: true,
};

const SCREENSHARE_PRESETS: Record<string, Record<number, VideoPreset>> = {
  '720': {
    5: ScreenSharePresets.h720fps5,
    15: ScreenSharePresets.h720fps15,
    30: ScreenSharePresets.h720fps30,
    60: new VideoPreset(1280, 720, 3_000_000, 60, 'medium'),
  },
  '1080': {
    5: new VideoPreset(1920, 1080, 1_500_000, 5, 'medium'),
    15: ScreenSharePresets.h1080fps15,
    30: ScreenSharePresets.h1080fps30,
    60: new VideoPreset(1920, 1080, 8_000_000, 60, 'medium'),
  },
  '1440': {
    5: new VideoPreset(2560, 1440, 2_500_000, 5, 'medium'),
    15: new VideoPreset(2560, 1440, 4_000_000, 15, 'medium'),
    30: new VideoPreset(2560, 1440, 8_000_000, 30, 'medium'),
    60: new VideoPreset(2560, 1440, 12_000_000, 60, 'medium'),
  },
};

function ScreenShareModal({ onStart, onCancel }: {
  onStart: (settings: ScreenShareSettings) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [settings, setSettings] = useState<ScreenShareSettings>(DEFAULT_SETTINGS);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div className="bg-[var(--bg-secondary)] rounded-xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">{t('screen.title')}</h2>
          <button onClick={onCancel} className="p-1 rounded hover:bg-white/10 text-[var(--text-muted)]"><X size={18} /></button>
        </div>

        <div className="mb-4">
          <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-2">{t('screen.quality')}</label>
          <div className="grid grid-cols-4 gap-2">
            {(['720', '1080', '1440', 'source'] as const).map((res) => (
              <button key={res} onClick={() => setSettings((s) => ({ ...s, resolution: res }))}
                className={`py-2 rounded-lg text-sm font-medium transition-colors ${settings.resolution === res ? 'bg-[var(--accent)] text-white' : 'bg-white/5 text-[var(--text-secondary)] hover:bg-white/10'}`}>
                {res === 'source' ? t('screen.source') : `${res}p`}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-2">{t('screen.fps')}</label>
          <div className="grid grid-cols-4 gap-2">
            {[5, 15, 30, 60].map((fps) => (
              <button key={fps} onClick={() => setSettings((s) => ({ ...s, fps }))}
                className={`py-2 rounded-lg text-sm font-medium transition-colors ${settings.fps === fps ? 'bg-[var(--accent)] text-white' : 'bg-white/5 text-[var(--text-secondary)] hover:bg-white/10'}`}>
                {fps} FPS
              </button>
            ))}
          </div>
        </div>

        <div className="mb-6">
          <button onClick={() => setSettings((s) => ({ ...s, audio: !s.audio }))}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-colors ${settings.audio ? 'bg-green-500/15 text-green-400' : 'bg-white/5 text-[var(--text-muted)]'}`}>
            <Volume2 size={18} />
            <span className="flex-1 text-left font-medium">{t('screen.audio')}</span>
            <div className={`w-9 h-5 rounded-full transition-colors relative ${settings.audio ? 'bg-green-500' : 'bg-white/20'}`}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${settings.audio ? 'left-[18px]' : 'left-0.5'}`} />
            </div>
          </button>
        </div>

        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-white/5 text-[var(--text-secondary)] hover:bg-white/10 transition-colors">{t('cancel')}</button>
          <button onClick={() => onStart(settings)} className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors flex items-center justify-center gap-2">
            <MonitorUp size={16} /> {t('screen.start')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Room participant (fills a grid cell) ───────────────────────────

function ParticipantTile({ participant, isLocal, large }: { participant: any; isLocal: boolean; large?: boolean }) {
  const isSpeaking = useIsSpeaking(participant);
  const isMuted = !participant.isMicrophoneEnabled;
  const { mutedUsers, deafened, openMenuId, setOpenMenuId } = useContext(VolumeContext);
  const isUserMuted = !!mutedUsers[participant.identity];
  const showMenu = openMenuId === participant.identity;
  const btnRef = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Камера-трек participant'а. useTracks реактивен на publish/unpublish, но в
  // LiveKit v2 `setCameraEnabled(false)` по умолчанию НЕ unpublish'ит трек —
  // только мьютит его. Поэтому отдельно слушаем 'muted'/'unmuted' события трека
  // и держим isLive в state, чтобы видео скрывалось мгновенно при выключении
  // (иначе остаётся последний кадр).
  const cameraTracks = useTracks([Track.Source.Camera]);
  const myCameraRef = cameraTracks.find((tr) => tr.participant.identity === participant.identity);
  const cameraTrack = myCameraRef?.publication?.track;

  const [isVideoLive, setIsVideoLive] = useState(false);
  useEffect(() => {
    if (!cameraTrack) { setIsVideoLive(false); return; }
    const update = () => setIsVideoLive(!cameraTrack.isMuted);
    update();
    cameraTrack.on('muted', update);
    cameraTrack.on('unmuted', update);
    return () => {
      cameraTrack.off('muted', update);
      cameraTrack.off('unmuted', update);
    };
  }, [cameraTrack]);

  const hasCamera = !!cameraTrack && isVideoLive;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (!cameraTrack || !isVideoLive) {
      // Сброс srcObject + load() — иначе Chrome/Safari могут оставить
      // последний кадр прилипшим. detach() от LiveKit ставит src=null, но
      // браузер не всегда очищает кадр без явного load().
      el.srcObject = null;
      try { el.load(); } catch { /* ignore */ }
      return;
    }
    cameraTrack.attach(el);
    return () => {
      cameraTrack.detach(el);
      if (el) {
        el.srcObject = null;
        try { el.load(); } catch { /* ignore */ }
      }
    };
  }, [cameraTrack, isVideoLive]);

  return (
    <div
      className={`
        relative rounded-xl overflow-hidden flex flex-col items-center justify-center
        text-white font-bold transition-all duration-200 min-h-0
        ${isSpeaking && !deafened && !isUserMuted ? 'bg-green-500/20 ring-2 ring-green-400' : 'bg-white/5'}
      `}
    >
      {hasCamera ? (
        <>
          {/* muted=true для local — иначе echo из своего же микрофона/динамика.
              В large-режиме (главная область) — object-contain чтобы видеть всё
              видео без обрезки; в grid (маленькие плитки) — object-cover. */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={isLocal}
            className={`absolute inset-0 w-full h-full ${large ? 'object-contain' : 'object-cover'}`}
          />
          {/* Имя в углу поверх видео — как в Zoom/Discord */}
          <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/50 text-xs text-white max-w-[calc(100%-1rem)] truncate">
            {participant.name || participant.identity}
          </span>
        </>
      ) : (
        <>
          <ParticipantAvatar
            participant={participant}
            size={large ? 160 : 96}
            bgClass={isSpeaking && !deafened && !isUserMuted ? 'bg-green-500' : 'bg-[var(--accent)]'}
          />
          <span className={`${large ? 'mt-4 text-base' : 'mt-2 text-sm'} text-[var(--text-secondary)] truncate max-w-[80%] text-center`}>
            {participant.name || participant.identity}
          </span>
        </>
      )}

      {/* Indicators */}
      <div className="absolute top-3 left-3 flex items-center gap-1.5">
        <QualityIndicator participant={participant} />
        {isMuted && (
          <div className="bg-[var(--danger)] rounded-md p-1"><MicOff size={14} className="text-white" /></div>
        )}
        {isUserMuted && (
          <div className="bg-orange-500 rounded-md p-1"><VolumeX size={14} className="text-white" /></div>
        )}
      </div>

      {/* "..." button */}
      {!isLocal && (
        <button
          ref={btnRef}
          onClick={() => setOpenMenuId(showMenu ? null : participant.identity)}
          className="absolute top-2 right-2 p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 transition-colors"
        >
          <MoreVertical size={16} />
        </button>
      )}

      {showMenu && !isLocal && (
        <UserMenu participant={participant} anchorRef={btnRef} onClose={() => setOpenMenuId(null)} />
      )}
    </div>
  );
}

// ─── Screen share video ─────────────────────────────────────────────

function ScreenShareView({ trackRef, isFullscreen, onToggleFullscreen }: {
  trackRef: any;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Attach video track
  useEffect(() => {
    const el = videoRef.current;
    const track = trackRef.publication?.track;
    if (el && track) {
      track.attach(el);
      return () => { track.detach(el); };
    }
  }, [trackRef.publication?.track]);

  // Attach screen share audio track
  const screenAudioTracks = useTracks([Track.Source.ScreenShareAudio]);
  const screenAudioTrack = screenAudioTracks.find(
    (t: any) => t.participant.identity === trackRef.participant?.identity
  );
  const audioTrack = screenAudioTrack?.publication?.track;

  const { volumes, mutedUsers, deafened } = useContext(VolumeContext);

  useEffect(() => {
    const el = audioRef.current;
    if (el && audioTrack) {
      audioTrack.attach(el);
      el.play().catch(() => {});
      return () => { audioTrack.detach(el); };
    }
  }, [audioTrack]);

  // Control screen share audio volume directly via the element
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const id = trackRef.participant?.identity || '';
    if (deafened || mutedUsers[id]) {
      el.volume = 0;
    } else {
      const raw = volumes[id] ?? 1;
      el.volume = Math.max(0, Math.min(1, Number.isFinite(raw) ? raw : 1));
    }
  }, [volumes, mutedUsers, deafened, trackRef.participant?.identity]);

  const name = trackRef.participant?.name || trackRef.participant?.identity || '';
  const identity = trackRef.participant?.identity || '';

  const handleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      containerRef.current.requestFullscreen().catch(() => {});
    }
  }, []);

  // Keyboard Lock API: пока элемент в fullscreen, Esc не закрывает его.
  // Поддерживается Chrome/Edge; в Firefox/Safari тихо отваливается — там
  // Esc продолжит выходить из fullscreen, это известное ограничение браузера.
  useEffect(() => {
    type KbAPI = { lock: (keys: string[]) => Promise<void>; unlock: () => void };
    const getKb = () => (navigator as Navigator & { keyboard?: KbAPI }).keyboard;

    const handler = () => {
      if (document.fullscreenElement) {
        getKb()?.lock(['Escape']).catch(() => {});
      } else {
        getKb()?.unlock?.();
        if (isFullscreen) onToggleFullscreen();
      }
    };
    document.addEventListener('fullscreenchange', handler);
    return () => {
      document.removeEventListener('fullscreenchange', handler);
      getKb()?.unlock?.();
    };
  }, [isFullscreen, onToggleFullscreen]);


  const wrapperClass = isFullscreen
    ? 'fixed inset-0 z-50 flex flex-col bg-black'
    : 'flex-1 h-0 flex flex-col bg-black/40 rounded-xl overflow-hidden mx-4 mt-4';

  return (
    <div ref={containerRef} className={wrapperClass}>
      <div className="px-3 py-1.5 text-xs text-[var(--text-muted)] flex items-center gap-1.5 shrink-0">
        <MonitorUp size={12} />
        <span>{name} {t('voice.sharingScreen')}</span>

        {/* Stream audio controls */}
        <div className="ml-auto flex items-center gap-1">
          <VolumeSlider identity={identity} compact />
          <button
            onClick={() => { handleFullscreen(); onToggleFullscreen(); }}
            className="p-1 rounded hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title={isFullscreen ? t('voice.exitFullscreen') : t('voice.fullscreen')}
          >
            {isFullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 relative">
        <video ref={videoRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-contain" />
        <audio ref={audioRef} autoPlay />
      </div>
    </div>
  );
}

// ─── Sync participants to Zustand store ──────────────────────────────

function ParticipantSync() {
  const participants = useParticipants();
  const setVoiceParticipants = useSessionStore((s) => s.setVoiceParticipants);

  useEffect(() => {
    setVoiceParticipants(
      participants.map((p) => {
        let imagePath = '';
        try {
          const meta = JSON.parse(p.metadata || '{}');
          imagePath = meta.image_path || '';
        } catch { /* no metadata */ }
        return { identity: p.identity, name: p.name || p.identity, image_path: imagePath };
      })
    );
  }, [participants, setVoiceParticipants]);

  return null;
}

// При выходе из звонка LiveKit room.disconnect() не всегда корректно вызывает
// MediaStreamTrack.stop() для screen-share треков — браузер продолжает показывать
// индикатор «сайт записывает экран» пока вкладка не перезагружена. Явно стопаем
// screen-share-треки при размонтировании. Покрывает все способы выхода (кнопка
// в RoomControls, FloatingCallBar, OutgoingCallWatcher, VoicePresencePanel) —
// все они приводят к unmount <LiveKitRoom>.
function LocalTrackCleanup() {
  const { localParticipant } = useLocalParticipant();
  const lpRef = useRef(localParticipant);
  lpRef.current = localParticipant;

  useEffect(() => {
    return () => {
      const lp = lpRef.current;
      if (!lp) return;
      try {
        lp.getTrackPublication(Track.Source.ScreenShare)?.track?.stop();
        lp.getTrackPublication(Track.Source.ScreenShareAudio)?.track?.stop();
        lp.getTrackPublication(Track.Source.Camera)?.track?.stop();
      } catch { /* ignore — track уже мог быть остановлен */ }
    };
  }, []);

  return null;
}

// Реагирует на смену audioInputId/audioOutputId/videoInputId в настройках:
// если юзер во время активного звонка выбирает другой микрофон/наушники/камеру
// — переключаем устройство «на лету» без переподключения к LiveKit-комнате.
// При первом подключении устройства уже применены через props <LiveKitRoom>.
function DeviceSync() {
  const room = useRoomContext();
  const audioInputId = useSessionStore((s) => s.audioInputId);
  const audioOutputId = useSessionStore((s) => s.audioOutputId);
  const videoInputId = useSessionStore((s) => s.videoInputId);

  useEffect(() => {
    if (!room || !audioInputId) return;
    room.switchActiveDevice('audioinput', audioInputId).catch(() => {});
  }, [room, audioInputId]);

  useEffect(() => {
    if (!room || !audioOutputId) return;
    room.switchActiveDevice('audiooutput', audioOutputId).catch(() => {});
  }, [room, audioOutputId]);

  useEffect(() => {
    if (!room || !videoInputId) return;
    room.switchActiveDevice('videoinput', videoInputId).catch(() => {});
  }, [room, videoInputId]);

  return null;
}

// ─── Small participant (strip below screen share) ───────────────────

function SmallParticipant({ participant, isLocal, onFocus, active }: {
  participant: any;
  isLocal: boolean;
  onFocus?: () => void;
  active?: boolean;
}) {
  const t = useT();
  const isSpeaking = useIsSpeaking(participant);
  const isMuted = !participant.isMicrophoneEnabled;
  const { mutedUsers, deafened, openMenuId, setOpenMenuId } = useContext(VolumeContext);
  const isUserMuted = !!mutedUsers[participant.identity];
  const menuKey = 'small-' + participant.identity;
  const showMenu = openMenuId === menuKey;
  const btnRef = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Камера: подписываемся на muted/unmuted чтобы strip переключался без фриза
  // (как в ParticipantTile — см. там комментарий о поведении LiveKit v2).
  const cameraTracks = useTracks([Track.Source.Camera]);
  const myCameraRef = cameraTracks.find((tr) => tr.participant.identity === participant.identity);
  const cameraTrack = myCameraRef?.publication?.track;

  const [isVideoLive, setIsVideoLive] = useState(false);
  useEffect(() => {
    if (!cameraTrack) { setIsVideoLive(false); return; }
    const update = () => setIsVideoLive(!cameraTrack.isMuted);
    update();
    cameraTrack.on('muted', update);
    cameraTrack.on('unmuted', update);
    return () => {
      cameraTrack.off('muted', update);
      cameraTrack.off('unmuted', update);
    };
  }, [cameraTrack]);

  const hasCamera = !!cameraTrack && isVideoLive;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (!cameraTrack || !isVideoLive) {
      el.srcObject = null;
      try { el.load(); } catch { /* ignore */ }
      return;
    }
    cameraTrack.attach(el);
    return () => {
      cameraTrack.detach(el);
      if (el) { el.srcObject = null; try { el.load(); } catch { /* ignore */ } }
    };
  }, [cameraTrack, isVideoLive]);

  return (
    <div
      onClick={onFocus}
      title={onFocus && !active ? t('voice.focusSource') : undefined}
      className={`
        relative flex flex-col items-center gap-1 px-3 py-2 rounded-lg shrink-0 group
        ${onFocus && !active ? 'cursor-pointer hover:ring-2 hover:ring-[var(--accent)]' : ''}
        ${active ? 'ring-2 ring-[var(--accent)]' : ''}
        ${isSpeaking && !deafened && !isUserMuted ? 'bg-green-500/20 ring-1 ring-green-400' : 'bg-white/5'}
        transition-all
      `}
    >
      {hasCamera ? (
        <div className="relative w-[72px] h-[54px] rounded overflow-hidden bg-black">
          <video ref={videoRef} autoPlay playsInline muted={isLocal} className="absolute inset-0 w-full h-full object-cover" />
        </div>
      ) : (
        <ParticipantAvatar
          participant={participant}
          size={40}
          bgClass={isSpeaking && !deafened && !isUserMuted ? 'bg-green-500' : 'bg-[var(--accent)]'}
        />
      )}
      <span className="text-[11px] text-[var(--text-secondary)] truncate max-w-[72px]">
        {participant.name || participant.identity}
      </span>
      <div className="absolute top-1 left-1 flex items-center gap-0.5 pointer-events-none">
        <QualityIndicator participant={participant} small />
        {isMuted && (
          <div className="bg-[var(--danger)] rounded p-0.5"><MicOff size={8} className="text-white" /></div>
        )}
        {isUserMuted && (
          <div className="bg-orange-500 rounded p-0.5"><VolumeX size={8} className="text-white" /></div>
        )}
      </div>

      {!isLocal && (
        <button
          ref={btnRef}
          onClick={(e) => { e.stopPropagation(); setOpenMenuId(showMenu ? null : menuKey); }}
          className="absolute top-0.5 right-0.5 p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 transition-colors z-10"
        >
          <MoreVertical size={12} />
        </button>
      )}

      {showMenu && !isLocal && (
        <UserMenu participant={participant} anchorRef={btnRef} onClose={() => setOpenMenuId(null)} />
      )}

      {/* Focus-hint поверх блока — как у ScreenShareThumbnail. Только для
          неактивного блока (для активного не имеет смысла). */}
      {onFocus && !active && (
        <div className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 bg-black/30 flex items-center justify-center transition-opacity pointer-events-none">
          <ArrowLeftRight size={20} className="text-white" />
        </div>
      )}
    </div>
  );
}

// ─── Маленькая превьюшка screen share — для strip-а когда камера primary ─

function ScreenShareThumbnail({ trackRef, onClick, active }: {
  trackRef: any;
  onClick: () => void;
  active?: boolean;
}) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    const track = trackRef?.publication?.track;
    if (el && track) {
      track.attach(el);
      return () => { track.detach(el); };
    }
  }, [trackRef?.publication?.track]);

  const pName = trackRef?.participant?.name || trackRef?.participant?.identity || '';

  return (
    <button
      onClick={onClick}
      title={active ? undefined : t('voice.focusSource')}
      className={`relative shrink-0 w-32 h-20 rounded-lg overflow-hidden bg-black group transition-all ${
        active
          ? 'ring-2 ring-[var(--accent)]'
          : 'hover:ring-2 hover:ring-[var(--accent)]'
      }`}
    >
      <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-contain" />
      <div className="absolute inset-0 flex items-end p-1.5 bg-gradient-to-t from-black/70 via-transparent to-transparent">
        <span className="text-[10px] text-white truncate max-w-full flex items-center gap-1">
          <MonitorUp size={10} /> {pName}
        </span>
      </div>
      {/* Hover-overlay только для неактивных — нажимать на активную бессмысленно */}
      {!active && (
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 bg-black/30 flex items-center justify-center transition-opacity pointer-events-none">
          <ArrowLeftRight size={20} className="text-white" />
        </div>
      )}
    </button>
  );
}

// ─── Resize handle для strip-а (mouse + touch) ────────────────────

function StripResizeHandle({ orientation, onResize, containerRef }: {
  orientation: 'horizontal' | 'vertical';
  onResize: (px: number) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const draggingRef = useRef(false);

  const startDrag = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = orientation === 'horizontal' ? 'row-resize' : 'col-resize';
  }, [orientation]);

  useEffect(() => {
    const clientPoint = (e: MouseEvent | TouchEvent) => {
      if (e instanceof MouseEvent) return { x: e.clientX, y: e.clientY };
      const t = e.touches[0] || e.changedTouches[0];
      return t ? { x: t.clientX, y: t.clientY } : null;
    };

    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!draggingRef.current) return;
      const container = containerRef.current;
      if (!container) return;
      const pt = clientPoint(e);
      if (!pt) return;
      const rect = container.getBoundingClientRect();
      if (orientation === 'horizontal') {
        // Strip снизу → размер = bottom_контейнера - cursor.y
        const px = rect.bottom - pt.y;
        // Min 60 (плитки видны) / max 60% контейнера, чтобы main pane не пропал
        const clamped = Math.max(60, Math.min(rect.height * 0.6, px));
        onResize(Math.round(clamped));
      } else {
        const px = rect.right - pt.x;
        const clamped = Math.max(100, Math.min(rect.width * 0.5, px));
        onResize(Math.round(clamped));
      }
    };

    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    window.addEventListener('touchcancel', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
      window.removeEventListener('touchcancel', onUp);
    };
  }, [orientation, onResize, containerRef]);

  return (
    <div
      onMouseDown={startDrag}
      onTouchStart={startDrag}
      className={`shrink-0 group ${
        orientation === 'horizontal'
          ? 'h-1.5 w-full cursor-row-resize'
          : 'w-1.5 h-full cursor-col-resize'
      } bg-[var(--border-color)] hover:bg-[var(--accent)] transition-colors`}
      title=" "
    />
  );
}

// ─── Participants grid ──────────────────────────────────────────────

function RoomContent() {
  const t = useT();
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const connectionState = useConnectionState();
  const screenTracks = useTracks([Track.Source.ScreenShare], { onlySubscribed: true });
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Один выбранный источник, который показывается в большой main-области.
  // Формат ключа: "screen:<identity>" для трансляции или "participant:<identity>"
  // для камеры/аватара. null — нет screen share вообще (тогда показываем grid).
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

  // Strip layout (persisted в sessionStore, per-device).
  const stripOrientation = useSessionStore((s) => s.voiceStripOrientation);
  const stripSizeH = useSessionStore((s) => s.voiceStripSizeHorizontal);
  const stripSizeV = useSessionStore((s) => s.voiceStripSizeVertical);
  const setStripOrientation = useSessionStore((s) => s.setVoiceStripOrientation);
  const setStripSizeH = useSessionStore((s) => s.setVoiceStripSizeHorizontal);
  const setStripSizeV = useSessionStore((s) => s.setVoiceStripSizeVertical);
  const stripSize = stripOrientation === 'horizontal' ? stripSizeH : stripSizeV;
  const setStripSize = stripOrientation === 'horizontal' ? setStripSizeH : setStripSizeV;
  const containerRef = useRef<HTMLDivElement>(null);

  // Звук на join/leave участников. Первый tick только инициализирует snapshot,
  // чтобы при заходе в комнату не ревело на каждого уже присутствующего.
  const prevIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const { sound, soundVolume } = useNotificationStore.getState();
    const localId = localParticipant?.identity;
    const currentIds = new Set(
      participants
        .map((p) => p.identity)
        .filter((id): id is string => !!id && id !== localId)
    );

    if (prevIdsRef.current === null) {
      prevIdsRef.current = currentIds;
      return;
    }
    const prev = prevIdsRef.current;
    if (sound) {
      for (const id of currentIds) {
        if (!prev.has(id)) { playVoiceJoinSound(soundVolume); break; }
      }
      for (const id of prev) {
        if (!currentIds.has(id)) { playVoiceLeaveSound(soundVolume); break; }
      }
    }
    prevIdsRef.current = currentIds;
  }, [participants, localParticipant]);

  // Авто-выбор focusedKey: при появлении screen share — становится дефолтом.
  // Если focused-источник исчез (трансляция остановлена / участник вышел) —
  // переключаемся на следующий доступный (приоритет: первая screen share,
  // иначе первый участник).
  // ВАЖНО: этот useEffect должен быть ДО любых ранних return'ов (Reconnecting/
  // Disconnected/!hasScreenShare), иначе количество хуков между рендерами
  // меняется → React error #310.
  useEffect(() => {
    const hasScreen = screenTracks.length > 0;
    if (!hasScreen) {
      if (focusedKey !== null) setFocusedKey(null);
      return;
    }
    const sKeys = screenTracks.map((tr) => `screen:${tr.participant.identity}`);
    const pKeys = participants.map((p) => `participant:${p.identity}`);
    const all = [...sKeys, ...pKeys];
    if (!focusedKey || !all.includes(focusedKey)) {
      setFocusedKey(sKeys[0] ?? pKeys[0] ?? null);
    }
  }, [screenTracks, participants, focusedKey]);

  if (connectionState === ConnectionState.Reconnecting) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--text-muted)]">
        <Loader2 size={28} className="animate-spin" /><p className="text-sm">{t('voice.reconnecting')}</p>
      </div>
    );
  }

  if (connectionState === ConnectionState.Disconnected) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--text-muted)]">
        <WifiOff size={28} /><p className="text-sm">{t('voice.disconnected')}</p>
      </div>
    );
  }

  const hasScreenShare = screenTracks.length > 0;
  const count = participants.length;
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);

  // Если нет ни одной screen share — обычный grid всех участников.
  if (!hasScreenShare) {
    return (
      <div className="flex-1 h-0 grid gap-2 p-4 overflow-hidden" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
          {participants.map((p) => (
            <ParticipantTile key={p.identity} participant={p} isLocal={p.identity === localParticipant.identity} />
          ))}
      </div>
    );
  }

  // Focused-mode: одна большая область + strip всех источников.
  const focusedScreenTrack = focusedKey?.startsWith('screen:')
    ? screenTracks.find((tr) => `screen:${tr.participant.identity}` === focusedKey)
    : null;
  const focusedParticipant = focusedKey?.startsWith('participant:')
    ? participants.find((p) => `participant:${p.identity}` === focusedKey)
    : null;

  const isHorizontal = stripOrientation === 'horizontal';
  // Контейнер и strip разворачиваются в зависимости от ориентации:
  //   horizontal — flex-col, strip снизу с высотой stripSize
  //   vertical   — flex-row, strip справа с шириной stripSize
  const containerDirCls = isHorizontal ? 'flex-col' : 'flex-row';
  const stripStyle: React.CSSProperties = isHorizontal
    ? { height: stripSize }
    : { width: stripSize };
  const stripDirCls = isHorizontal
    ? 'flex-row overflow-x-auto items-center'
    : 'flex-col overflow-y-auto items-center';
  const dividerCls = isHorizontal
    ? 'w-px h-12 bg-[var(--border-color)] shrink-0 mx-1'
    : 'h-px w-12 bg-[var(--border-color)] shrink-0 my-1';

  return (
    <div ref={containerRef} className={`flex-1 h-0 flex ${containerDirCls} overflow-hidden`}>
      {/* Main pane: либо screen share, либо большая плитка участника */}
      <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
        {focusedScreenTrack ? (
          <ScreenShareView
            key={focusedScreenTrack.participant.identity}
            trackRef={focusedScreenTrack}
            isFullscreen={isFullscreen}
            onToggleFullscreen={() => setIsFullscreen((v) => !v)}
          />
        ) : focusedParticipant ? (
          <div className="flex-1 h-0 p-4 overflow-hidden">
            <ParticipantTile
              participant={focusedParticipant}
              isLocal={focusedParticipant.identity === localParticipant.identity}
              large
            />
          </div>
        ) : (
          <div className="flex-1 h-0" />
        )}
      </div>

      {!isFullscreen && (
        <>
          <StripResizeHandle
            orientation={stripOrientation}
            onResize={setStripSize}
            containerRef={containerRef}
          />
          <div
            style={stripStyle}
            className={`shrink-0 flex gap-2 p-3 ${stripDirCls} relative`}
          >
            {/* Кнопка переключения ориентации — в углу strip-а */}
            <button
              onClick={() => setStripOrientation(isHorizontal ? 'vertical' : 'horizontal')}
              title={isHorizontal ? t('voice.stripVertical') : t('voice.stripHorizontal')}
              className="shrink-0 p-1.5 rounded-md bg-white/5 hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              {isHorizontal ? <PanelRight size={14} /> : <PanelBottom size={14} />}
            </button>

            {screenTracks.map((tr) => {
              const key = `screen:${tr.participant.identity}`;
              return (
                <ScreenShareThumbnail
                  key={key}
                  trackRef={tr}
                  active={focusedKey === key}
                  onClick={() => setFocusedKey(key)}
                />
              );
            })}
            {screenTracks.length > 0 && participants.length > 0 && (
              <div className={dividerCls} />
            )}
            {participants.map((p) => {
              const key = `participant:${p.identity}`;
              return (
                <SmallParticipant
                  key={key}
                  participant={p}
                  isLocal={p.identity === localParticipant.identity}
                  active={focusedKey === key}
                  onFocus={() => setFocusedKey(key)}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Controls panel ─────────────────────────────────────────────────

function RoomControls({ onLeave, deafened, onToggleDeafen }: {
  onLeave: () => void;
  deafened: boolean;
  onToggleDeafen: () => void;
}) {
  const t = useT();
  const { localParticipant } = useLocalParticipant();
  const isMuted = !localParticipant.isMicrophoneEnabled;
  const isScreenSharing = localParticipant.isScreenShareEnabled;
  const isCameraEnabled = localParticipant.isCameraEnabled;
  const cameraAllowed = useSessionStore((s) => s.cameraAllowed);
  const [showModal, setShowModal] = useState(false);
  const [showStats, setShowStats] = useState(false);

  const toggleMic = useCallback(async () => {
    await localParticipant.setMicrophoneEnabled(isMuted);
  }, [localParticipant, isMuted]);

  const toggleCamera = useCallback(async () => {
    try {
      await localParticipant.setCameraEnabled(!isCameraEnabled);
    } catch (err) {
      // getUserMedia мог отказать (юзер заблокировал permission в браузере,
      // камера не подключена, занята другим приложением). Показываем тост.
      console.error('[VoiceRoom] camera toggle failed:', err);
      pushRichToast({ title: t('voice.camera'), message: t('voice.cameraError') });
    }
  }, [localParticipant, isCameraEnabled, t]);

  const handleScreenShareClick = useCallback(() => {
    if (isScreenSharing) localParticipant.setScreenShareEnabled(false);
    else setShowModal(true);
  }, [localParticipant, isScreenSharing]);

  const startScreenShare = useCallback(async (settings: ScreenShareSettings) => {
    setShowModal(false);
    try {
      const isChrome = /Chrome/.test(navigator.userAgent) && !/Edge/.test(navigator.userAgent);
      const preset = settings.resolution !== 'source'
        ? SCREENSHARE_PRESETS[settings.resolution]?.[settings.fps]
        : undefined;
      const captureOpts = {
        audio: settings.audio,
        resolution: preset,
        ...(isChrome ? {
          selfBrowserSurface: 'include' as const,
          surfaceSwitching: 'include' as const,
          systemAudio: (settings.audio ? 'include' : 'exclude') as 'include' | 'exclude',
        } : {}),
      };
      const tracks = await localParticipant.createScreenTracks(captureOpts);
      for (const track of tracks) {
        if (track.kind === 'video') {
          if (preset) {
            await track.mediaStreamTrack.applyConstraints({
              frameRate: { ideal: preset.resolution.frameRate },
              width: { ideal: preset.resolution.width },
              height: { ideal: preset.resolution.height },
            });
          }
          await localParticipant.publishTrack(track, preset ? {
            videoEncoding: preset.encoding,
          } : undefined);
        } else if (track.kind === 'audio') {
          // Музыка/системный звук: высокое качество, без DTX (он рубит "тихую" музыку),
          // RED для устойчивости к потерям, стерео.
          await localParticipant.publishTrack(track, {
            audioPreset: AudioPresets.musicHighQualityStereo,
            dtx: false,
            red: true,
            forceStereo: true,
          });
        }
      }
      // Если юзер просил аудио, но браузер его не захватил — обычно из-за того,
      // что в диалоге share-screen не отмечен чекбокс "Поделиться аудио".
      if (settings.audio && !tracks.some((tr) => tr.kind === 'audio')) {
        pushRichToast({
          title: t('voice.screenShare'),
          message: t('voice.screenAudioNotCaptured'),
        });
      }
    } catch { /* cancelled */ }
  }, [localParticipant, t]);

  return (
    <>
      <div className="flex items-center justify-center gap-3 py-4">
        <button onClick={toggleMic} title={isMuted ? t('voice.mic') : t('voice.micOff')}
          className={`p-3 rounded-full transition-colors ${isMuted ? 'bg-[var(--danger)] text-white' : 'bg-white/10 text-[var(--text-secondary)] hover:bg-white/20'}`}>
          {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
        </button>

        {cameraAllowed && (
          <button onClick={toggleCamera} title={isCameraEnabled ? t('voice.cameraOff') : t('voice.camera')}
            className={`p-3 rounded-full transition-colors ${isCameraEnabled ? 'bg-[var(--accent)] text-white hover:opacity-90' : 'bg-white/10 text-[var(--text-secondary)] hover:bg-white/20'}`}>
            {isCameraEnabled ? <Video size={20} /> : <VideoOff size={20} />}
          </button>
        )}

        <button onClick={onToggleDeafen} title={deafened ? t('voice.undeafen') : t('voice.deafen')}
          className={`p-3 rounded-full transition-colors ${deafened ? 'bg-[var(--danger)] text-white' : 'bg-white/10 text-[var(--text-secondary)] hover:bg-white/20'}`}>
          {deafened ? <HeadphoneOff size={20} /> : <Headphones size={20} />}
        </button>

        {window.innerWidth >= 768 && (
          <button onClick={handleScreenShareClick} title={isScreenSharing ? t('voice.screenShareStop') : t('voice.screenShare')}
            className={`p-3 rounded-full transition-colors ${isScreenSharing ? 'bg-green-500 text-white hover:bg-green-600' : 'bg-white/10 text-[var(--text-secondary)] hover:bg-white/20'}`}>
            {isScreenSharing ? <MonitorOff size={20} /> : <MonitorUp size={20} />}
          </button>
        )}

        <button onClick={() => setShowStats((v) => !v)} title={t('stats.connection')}
          className={`p-3 rounded-full transition-colors ${showStats ? 'bg-[var(--accent)] text-white' : 'bg-white/10 text-[var(--text-secondary)] hover:bg-white/20'}`}>
          <Signal size={20} />
        </button>

        <button onClick={onLeave} title={t('voice.leave')}
          className="p-3 rounded-full bg-[var(--danger)] text-white hover:opacity-90 transition-opacity">
          <PhoneOff size={20} />
        </button>
      </div>

      {showStats && <StatsPanel onClose={() => setShowStats(false)} />}
      {showModal && <ScreenShareModal onStart={startScreenShare} onCancel={() => setShowModal(false)} />}
    </>
  );
}

// ─── Main component ────────────────────────────────────────────────

interface VoiceRoomProps {
  channelId: string;
  channelName: string;
  groupName: string;
}

export function VoiceRoom({ channelId }: VoiceRoomProps) {
  const t = useT();
  const [token, setToken] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load saved settings from localStorage
  const [volumes, setVolumes] = useState<Record<string, number>>(() => loadVoiceSettings().volumes);
  const [mutedUsers, setMutedUsers] = useState<Record<string, boolean>>(() => loadVoiceSettings().mutedUsers);
  const [deafened, setDeafened] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Save on change
  useEffect(() => {
    saveVoiceSettings({ volumes, mutedUsers });
  }, [volumes, mutedUsers]);

  const setUserVolume = useCallback((identity: string, vol: number) => {
    setVolumes((prev) => ({ ...prev, [identity]: vol }));
  }, []);

  const toggleUserMute = useCallback((identity: string) => {
    setMutedUsers((prev) => ({ ...prev, [identity]: !prev[identity] }));
  }, []);

  const toggleDeafen = useCallback(() => setDeafened((v) => !v), []);

  const volumeCtx: UserVolumeCtx = { volumes, mutedUsers, deafened, setUserVolume, toggleUserMute, openMenuId, setOpenMenuId };

  const leaveVoice = useSessionStore((s) => s.leaveVoice);
  const setCallStartedAt = useSessionStore((s) => s.setCallStartedAt);
  const autoMic = useSessionStore((s) => s.autoMic) ?? true;
  const audioInputId = useSessionStore((s) => s.audioInputId);

  useEffect(() => {
    let cancelled = false;
    async function fetchToken() {
      try {
        setLoading(true); setError(null);
        const data = await voiceApi.getToken(channelId);
        if (!cancelled) {
          setToken(data.token);
          setServerUrl(data.url);
          setCallStartedAt(data.call_started_at);
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Failed to get token');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchToken();
    return () => { cancelled = true; };
  }, [channelId, setCallStartedAt]);

  // Защита от усыпления на мобильных: Wake Lock + Media Session + silent-audio.
  // Активируем после mount'а (user gesture «Join» уже был), снимаем на unmount.
  useEffect(() => {
    const presence = useSessionStore.getState().voicePresence;
    const title = presence?.channelName || 'Voice call';
    const subtitle = presence?.groupName || '';
    activateVoiceGuard(title, subtitle).catch(() => {});
    return () => { deactivateVoiceGuard().catch(() => {}); };
  }, []);

  const handleLeave = useCallback(() => {
    // Если это DM-звонок — сообщаем второй стороне отмену (её оверлей и рингтон
    // остановятся). Для обычной групповой голосовой — endpoint 404, молча игнор
    const presence = useSessionStore.getState().voicePresence;
    if (presence) dmsApi.cancelCall(presence.groupId).catch(() => {});
    voiceApi.leave(channelId).catch(() => {});
    leaveVoice();
  }, [leaveVoice, channelId]);
  const handleError = useCallback((err: Error) => console.error('[VoiceRoom] LiveKit error:', err), []);

  // iOS Safari/Chrome выгружают вкладку при locked screen → срабатывает pagehide
  // → LiveKit по умолчанию делает clean-disconnect и звонок обрывается, а юзер
  // слышит серию iOS-звуков «mic on/off» (это переключения audio-session при
  // попытках reconnect перед окончательным disconnect). На мобильных отключаем
  // авто-disconnect — даём шанс восстановиться когда экран снова включат.
  // На десктопе оставляем дефолт true: закрыл вкладку = вышел из звонка.
  const isMobileDevice = typeof window !== 'undefined' && window.innerWidth < 768;
  const roomOptions: RoomOptions = {
    publishDefaults: {
      red: true,
      // dtx: false,
      audioPreset: AudioPresets.speech,
    },
    disconnectOnPageLeave: !isMobileDevice,
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--text-muted)]">
        <Loader2 size={32} className="animate-spin" /><p className="text-sm">{t('group.connecting')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--text-muted)]">
        <p className="text-sm text-[var(--danger)]">{error}</p>
        <button onClick={leaveVoice} className="px-4 py-2 rounded bg-white/10 text-[var(--text-secondary)] hover:bg-white/20">{t('back')}</button>
      </div>
    );
  }

  if (!token || !serverUrl) return null;

  return (
    <div className="flex-1 h-0 flex flex-col overflow-hidden">
      <VolumeContext.Provider value={volumeCtx} >
        <LiveKitRoom
          serverUrl={serverUrl}
          token={token}
          connect={true}
          audio={autoMic ? (audioInputId ? { deviceId: { exact: audioInputId } } : true) : false}
          video={false}
          onError={handleError}
          options={roomOptions}
          className="flex-1 h-0 flex flex-col overflow-hidden"
        >
          <RoomAudioRenderer />
          <ParticipantSync />
          <VolumeApplier />
          <LocalTrackCleanup />
          <DeviceSync />
          <div className="flex-1 h-0 flex flex-col overflow-hidden">
            <div className="flex-1 h-0 flex flex-col overflow-hidden">
              <RoomContent />
            </div>
            <div className="shrink-0 border-t border-[var(--border-color)]">
              <RoomControls onLeave={handleLeave} deafened={deafened} onToggleDeafen={toggleDeafen} />
            </div>
          </div>
        </LiveKitRoom>
      </VolumeContext.Provider>
    </div>
  );
}
