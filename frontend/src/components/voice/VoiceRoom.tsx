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
import { ConnectionState, Track, RemoteParticipant } from 'livekit-client';
import {
  Mic, MicOff, PhoneOff, Loader2, WifiOff,
  MonitorUp, MonitorOff, X, Volume2, VolumeX, Monitor,
  Maximize, Minimize, Headphones, HeadphoneOff,
  MoreVertical, Signal,
} from 'lucide-react';
import { voiceApi } from '../../api/voice';
import { useSessionStore } from '../../store/sessionStore';
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
        try {
          const stream = (pub.track as any).mediaStream as MediaStream | undefined;
          if (stream) {
            // Use GainNode for full 0-300% range
            const gain = getOrCreateGain(p.identity, stream);
            if (gain) {
              gain.gain.value = vol;
              // Mute the original element to avoid double audio
              pub.track.setVolume(0);
              continue;
            }
          }
          // Fallback: no stream available, use native (0-1 only)
          pub.track.setVolume(Math.min(vol, 1));
        } catch {
          // track not ready
        }
      }
    }
  }, [participants, volumes, mutedUsers, deafened]);

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
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      const menuW = 220;
      const menuH = 140;
      let top = rect.bottom + 4;
      let left = rect.left;
      // If overflows right edge
      if (left + menuW > window.innerWidth) left = window.innerWidth - menuW - 8;
      // If overflows bottom edge — show above
      if (top + menuH > window.innerHeight) top = rect.top - menuH - 4;
      setPos({ top, left });
    }
  }, [anchorRef]);

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

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 bg-[var(--bg-secondary)] rounded-xl shadow-2xl p-3 w-[220px] border border-[var(--border-color)]"
      style={{ top: pos.top, left: pos.left }}
    >
      <p className="text-xs font-semibold text-[var(--text-primary)] truncate mb-2 px-1">{name}</p>
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
  contentHint: 'motion' | 'detail';
}

const DEFAULT_SETTINGS: ScreenShareSettings = {
  resolution: '1080',
  fps: 30,
  audio: true,
  contentHint: 'motion',
};

const RESOLUTION_MAP: Record<string, { width: number; height: number } | null> = {
  '720': { width: 1280, height: 720 },
  '1080': { width: 1920, height: 1080 },
  '1440': { width: 2560, height: 1440 },
  'source': null,
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

        <div className="mb-4">
          <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-2">{t('screen.optimize')}</label>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setSettings((s) => ({ ...s, contentHint: 'motion' }))}
              className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors ${settings.contentHint === 'motion' ? 'bg-[var(--accent)] text-white' : 'bg-white/5 text-[var(--text-secondary)] hover:bg-white/10'}`}>
              <Monitor size={16} /> {t('screen.motion')}
            </button>
            <button onClick={() => setSettings((s) => ({ ...s, contentHint: 'detail' }))}
              className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors ${settings.contentHint === 'detail' ? 'bg-[var(--accent)] text-white' : 'bg-white/5 text-[var(--text-secondary)] hover:bg-white/10'}`}>
              <MonitorUp size={16} /> {t('screen.detail')}
            </button>
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

function ParticipantTile({ participant, isLocal }: { participant: any; isLocal: boolean }) {
  const isSpeaking = useIsSpeaking(participant);
  const isMuted = !participant.isMicrophoneEnabled;
  const { mutedUsers, deafened, openMenuId, setOpenMenuId } = useContext(VolumeContext);
  const isUserMuted = !!mutedUsers[participant.identity];
  const showMenu = openMenuId === participant.identity;
  const btnRef = useRef<HTMLButtonElement>(null);

  return (
    <div
      className={`
        relative rounded-xl flex flex-col items-center justify-center
        text-white font-bold transition-all duration-200 min-h-0
        ${isSpeaking && !deafened && !isUserMuted ? 'bg-green-500/20 ring-2 ring-green-400' : 'bg-white/5'}
      `}
    >
      <ParticipantAvatar
        participant={participant}
        size={96}
        bgClass={isSpeaking && !deafened && !isUserMuted ? 'bg-green-500' : 'bg-[var(--accent)]'}
      />
      <span className="mt-2 text-sm text-[var(--text-secondary)] truncate max-w-[80%] text-center">
        {participant.name || participant.identity}
      </span>

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
      document.exitFullscreen();
    } else {
      containerRef.current.requestFullscreen();
    }
  }, []);

  useEffect(() => {
    const handler = () => {
      if (!document.fullscreenElement && isFullscreen) onToggleFullscreen();
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
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

// ─── Small participant (strip below screen share) ───────────────────

function SmallParticipant({ participant, isLocal }: { participant: any; isLocal: boolean }) {
  const isSpeaking = useIsSpeaking(participant);
  const isMuted = !participant.isMicrophoneEnabled;
  const { mutedUsers, deafened, openMenuId, setOpenMenuId } = useContext(VolumeContext);
  const isUserMuted = !!mutedUsers[participant.identity];
  const menuKey = 'small-' + participant.identity;
  const showMenu = openMenuId === menuKey;
  const btnRef = useRef<HTMLButtonElement>(null);

  return (
    <div className={`
      relative flex flex-col items-center gap-1 px-3 py-2 rounded-lg shrink-0
      ${isSpeaking && !deafened && !isUserMuted ? 'bg-green-500/20 ring-1 ring-green-400' : 'bg-white/5'}
    `}>
      <ParticipantAvatar
        participant={participant}
        size={40}
        bgClass={isSpeaking && !deafened && !isUserMuted ? 'bg-green-500' : 'bg-[var(--accent)]'}
      />
      <span className="text-[11px] text-[var(--text-secondary)] truncate max-w-[60px]">
        {participant.name || participant.identity}
      </span>
      <div className="absolute top-1 left-1 flex items-center gap-0.5">
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
          className="absolute top-0.5 right-0.5 p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 transition-colors"
        >
          <MoreVertical size={12} />
        </button>
      )}

      {showMenu && !isLocal && (
        <UserMenu participant={participant} anchorRef={btnRef} onClose={() => setOpenMenuId(null)} />
      )}
    </div>
  );
}

// ─── Participants grid ──────────────────────────────────────────────

function RoomContent() {
  const t = useT();
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const connectionState = useConnectionState();
  const screenTracks = useTracks([Track.Source.ScreenShare], { onlySubscribed: true });
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (selectedIdx >= screenTracks.length) setSelectedIdx(0);
  }, [screenTracks.length, selectedIdx]);

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

  if (hasScreenShare) {
    const activeTrack = screenTracks[selectedIdx] ?? screenTracks[0];
    return (
      <div className="flex-1 h-0 flex flex-col overflow-hidden">
        {screenTracks.length > 1 && (
          <div className="shrink-0 flex gap-1 px-4 pt-3 overflow-x-auto">
            {screenTracks.map((t, i) => {
              const pName = t.participant?.name || t.participant?.identity || `#${i + 1}`;
              return (
                <button key={t.participant.identity} onClick={() => setSelectedIdx(i)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 transition-colors flex items-center gap-1.5 ${i === selectedIdx ? 'bg-[var(--accent)] text-white' : 'bg-white/5 text-[var(--text-muted)] hover:bg-white/10'}`}>
                  <MonitorUp size={12} /> {pName}
                </button>
              );
            })}
          </div>
        )}
        <ScreenShareView key={activeTrack.participant.identity} trackRef={activeTrack} isFullscreen={isFullscreen} onToggleFullscreen={() => setIsFullscreen((v) => !v)} />
        {!isFullscreen && (
          <div className="shrink-0 flex gap-2 p-3 overflow-x-auto">
            {participants.map((p) => (
              <SmallParticipant key={p.identity} participant={p} isLocal={p.identity === localParticipant.identity} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const rows = Math.ceil(count / cols);

  return (
    <div className="flex-1 h-0 grid gap-2 p-4 overflow-hidden" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
      {participants.map((p) => (
        <ParticipantTile key={p.identity} participant={p} isLocal={p.identity === localParticipant.identity} />
      ))}
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
  const [showModal, setShowModal] = useState(false);
  const [showStats, setShowStats] = useState(false);

  const toggleMic = useCallback(async () => {
    await localParticipant.setMicrophoneEnabled(isMuted);
  }, [localParticipant, isMuted]);

  const handleScreenShareClick = useCallback(() => {
    if (isScreenSharing) localParticipant.setScreenShareEnabled(false);
    else setShowModal(true);
  }, [localParticipant, isScreenSharing]);

  const startScreenShare = useCallback(async (settings: ScreenShareSettings) => {
    setShowModal(false);
    try {
      const res = RESOLUTION_MAP[settings.resolution];
      const isChrome = /Chrome/.test(navigator.userAgent) && !/Edge/.test(navigator.userAgent);
      await localParticipant.setScreenShareEnabled(true, {
        audio: settings.audio,
        contentHint: settings.contentHint,
        ...(isChrome ? {
          selfBrowserSurface: 'include',
          surfaceSwitching: 'include',
          systemAudio: settings.audio ? 'include' : 'exclude',
        } : {}),
        video: { frameRate: { ideal: settings.fps }, ...(res ? { width: { ideal: res.width }, height: { ideal: res.height } } : {}) },
      });
    } catch { /* cancelled */ }
  }, [localParticipant]);

  return (
    <>
      <div className="flex items-center justify-center gap-3 py-4">
        <button onClick={toggleMic} title={isMuted ? t('voice.mic') : t('voice.micOff')}
          className={`p-3 rounded-full transition-colors ${isMuted ? 'bg-[var(--danger)] text-white' : 'bg-white/10 text-[var(--text-secondary)] hover:bg-white/20'}`}>
          {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
        </button>

        <button onClick={onToggleDeafen} title={deafened ? t('voice.undeafen') : t('voice.deafen')}
          className={`p-3 rounded-full transition-colors ${deafened ? 'bg-[var(--danger)] text-white' : 'bg-white/10 text-[var(--text-secondary)] hover:bg-white/20'}`}>
          {deafened ? <HeadphoneOff size={20} /> : <Headphones size={20} />}
        </button>

        <button onClick={handleScreenShareClick} title={isScreenSharing ? t('voice.screenShareStop') : t('voice.screenShare')}
          className={`p-3 rounded-full transition-colors ${isScreenSharing ? 'bg-green-500 text-white hover:bg-green-600' : 'bg-white/10 text-[var(--text-secondary)] hover:bg-white/20'}`}>
          {isScreenSharing ? <MonitorOff size={20} /> : <MonitorUp size={20} />}
        </button>

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

export function VoiceRoom({ channelId, channelName, groupName }: VoiceRoomProps) {
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
  const autoMic = useSessionStore((s) => s.autoMic) ?? true;

  useEffect(() => {
    let cancelled = false;
    async function fetchToken() {
      try {
        setLoading(true); setError(null);
        const data = await voiceApi.getToken(channelId);
        if (!cancelled) { setToken(data.token); setServerUrl(data.url); }
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Failed to get token');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchToken();
    return () => { cancelled = true; };
  }, [channelId]);

  const handleLeave = useCallback(() => leaveVoice(), [leaveVoice]);
  const handleError = useCallback((err: Error) => console.error('[VoiceRoom] LiveKit error:', err), []);

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
        <LiveKitRoom serverUrl={serverUrl} token={token} connect={true} audio={autoMic} video={false} onError={handleError} className="flex-1 h-0 flex flex-col overflow-hidden">
          <RoomAudioRenderer />
          <ParticipantSync />
          <VolumeApplier />
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
