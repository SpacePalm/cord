import { useState, useRef, useEffect, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { X, Camera, Check, Eye, EyeOff, Mic, MicOff, Volume2 } from 'lucide-react';
import { authApi } from '../../api/auth';
import { useAuthStore } from '../../store/authStore';
import { useSessionStore } from '../../store/sessionStore';
import { ApiError } from '../../api/client';
import { useT, useLangStore, LANGUAGES } from '../../i18n';
import { useThemeStore, PRESET_THEMES, FONT_OPTIONS, type ThemeColors, type Theme, type FontValue } from '../../store/themeStore';
import { ImageCropModal } from '../ui/ImageCropModal';
import { useNotificationStore } from '../../store/notificationStore';
import { Download, Upload, RotateCcw, Bell, BellOff } from 'lucide-react';

type Tab = 'profile' | 'security' | 'audio' | 'notifications' | 'appearance' | 'language';

interface SettingsModalProps {
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------
function AvatarSection({ onUploaded }: { onUploaded: (user: import('../../types').User) => void }) {
  const t = useT();
  const user = useAuthStore((s) => s.user)!;
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [cropSrc, setCropSrc] = useState<string | null>(null);

  const uploadMutation = useMutation({
    mutationFn: (file: File) => authApi.uploadAvatar(file),
    onSuccess: (updated) => {
      // Add cache-buster so the browser doesn't serve the old image
      if (updated.image_path) {
        updated.image_path = updated.image_path + '?t=' + Date.now();
      }
      onUploaded(updated);
      setError('');
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : t('settings.loadError')),
  });

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCropSrc(URL.createObjectURL(file));
    e.target.value = '';
  };

  const handleCropped = (file: File) => {
    setPreview(URL.createObjectURL(file));
    uploadMutation.mutate(file);
  };

  const src = preview ?? (user.image_path || null);
  const initials = (user.display_name || user.username).slice(0, 2).toUpperCase();

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        onClick={() => fileRef.current?.click()}
        className="relative group w-24 h-24 rounded-full overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        title={t('settings.changeAvatar')}
      >
        {src ? (
          <img src={src} alt="avatar" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-[var(--accent)] flex items-center justify-center text-white text-2xl font-bold">
            {initials}
          </div>
        )}
        {/* Overlay on hover */}
        <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          {uploadMutation.isPending ? (
            <div className="w-5 h-5 rounded-full border-2 border-white border-t-transparent animate-spin" />
          ) : (
            <>
              <Camera size={20} className="text-white" />
              <span className="text-white text-xs mt-1">{t('settings.change')}</span>
            </>
          )}
        </div>
      </button>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />

      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
      <p className="text-xs text-[var(--text-muted)]">{t('settings.avatarHint')}</p>

      {cropSrc && (
        <ImageCropModal
          src={cropSrc}
          shape="circle"
          onCrop={handleCropped}
          onClose={() => setCropSrc(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProfileTab
// ---------------------------------------------------------------------------
function ProfileTab({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { user, setUser } = useAuthStore();
  const [displayName, setDisplayName] = useState(user?.display_name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const updateMutation = useMutation({
    mutationFn: () => authApi.updateProfile({ display_name: displayName, email }),
    onSuccess: (updated) => {
      setUser(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      setError('');
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : t('settings.loadError')),
  });

  return (
    <div className="flex flex-col gap-6">
      <AvatarSection onUploaded={setUser} />

      <div className="flex flex-col gap-4">
        <div>
          <label className="block text-xs font-semibold uppercase text-[var(--text-muted)] mb-1.5">
            {t('settings.displayName')}
          </label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={50}
            className="w-full px-3 py-2 rounded bg-[var(--bg-input)] text-sm text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-[var(--text-muted)] mb-1.5">
            {t('settings.email')}
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 rounded bg-[var(--bg-input)] text-sm text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-[var(--text-muted)] mb-1.5">
            {t('settings.username')}
          </label>
          <input
            value={user?.username ?? ''}
            disabled
            className="w-full px-3 py-2 rounded bg-[var(--bg-input)] text-sm text-[var(--text-muted)] cursor-not-allowed opacity-60"
          />
          <p className="text-xs text-[var(--text-muted)] mt-1">{t('settings.usernameHint')}</p>
        </div>
      </div>

      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
          {t('cancel')}
        </button>
        <button
          onClick={() => updateMutation.mutate()}
          disabled={updateMutation.isPending}
          className="px-4 py-2 rounded bg-[var(--accent)] text-white text-sm flex items-center gap-2 hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors"
        >
          {saved ? <><Check size={14} /> {t('saved')}</> : updateMutation.isPending ? t('saving') : t('save')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SecurityTab
// ---------------------------------------------------------------------------
function PasswordField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="block text-xs font-semibold uppercase text-[var(--text-muted)] mb-1.5">{label}</label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 pr-10 rounded bg-[var(--bg-input)] text-sm text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
}

function SecurityTab({ onClose }: { onClose: () => void }) {
  const t = useT();
  const setUser = useAuthStore((s) => s.setUser);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const updateMutation = useMutation({
    mutationFn: () =>
      authApi.updateProfile({ current_password: current, new_password: next }),
    onSuccess: (updated) => {
      setUser(updated);
      setCurrent(''); setNext(''); setConfirm('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      setError('');
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : t('settings.loadError')),
  });

  const handleSubmit = () => {
    setError('');
    if (next.length < 6) { setError(t('settings.passwordMin')); return; }
    if (next !== confirm) { setError(t('settings.passwordMismatch')); return; }
    updateMutation.mutate();
  };

  return (
    <div className="flex flex-col gap-4">
      <PasswordField label={t('settings.currentPassword')} value={current} onChange={setCurrent} />
      <PasswordField label={t('settings.newPassword')} value={next} onChange={setNext} />
      <PasswordField label={t('settings.confirmPassword')} value={confirm} onChange={setConfirm} />

      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
          {t('cancel')}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!current || !next || !confirm || updateMutation.isPending}
          className="px-4 py-2 rounded bg-[var(--accent)] text-white text-sm flex items-center gap-2 hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors"
        >
          {saved ? <><Check size={14} /> {t('saved')}</> : updateMutation.isPending ? t('saving') : t('settings.changePassword')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AudioTab
// ---------------------------------------------------------------------------
const MIC_BARS = 20;

function AudioTab() {
  const t = useT();
  const audioInputId   = useSessionStore((s) => s.audioInputId);
  const audioOutputId  = useSessionStore((s) => s.audioOutputId);
  const audioInputGain = useSessionStore((s) => s.audioInputGain);
  const autoMic        = useSessionStore((s) => s.autoMic);
  const setAudioInput      = useSessionStore((s) => s.setAudioInput);
  const setAudioOutput     = useSessionStore((s) => s.setAudioOutput);
  const setAudioInputGain  = useSessionStore((s) => s.setAudioInputGain);
  const setAutoMic         = useSessionStore((s) => s.setAutoMic);

  const [inputs,  setInputs]  = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');

  const [micActive,   setMicActive]   = useState(false);
  const [micLevel,    setMicLevel]    = useState(0);
  const [playingTone, setPlayingTone] = useState(false);

  const streamRef   = useRef<MediaStream | null>(null);
  const ctxRef      = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const rafRef      = useRef<number>(0);

  // Enumerate devices (labels appear only after permission is granted)
  const enumerate = useCallback(async () => {
    const devs = await navigator.mediaDevices.enumerateDevices();
    setInputs(devs.filter((d) => d.kind === 'audioinput'));
    setOutputs(devs.filter((d) => d.kind === 'audiooutput'));
  }, []);

  // On mount — check if labels are already available (permission was granted before)
  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then((devs) => {
      if (devs.some((d) => d.label)) {
        setPermission('granted');
        setInputs(devs.filter((d) => d.kind === 'audioinput'));
        setOutputs(devs.filter((d) => d.kind === 'audiooutput'));
      }
    });
    return () => stopMic();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const requestPermission = async () => {
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
      tmp.getTracks().forEach((t) => t.stop());
      setPermission('granted');
      await enumerate();
    } catch {
      setPermission('denied');
    }
  };

  const startMic = async () => {
    try {
      const constraints: MediaStreamConstraints = {
        audio: audioInputId ? { deviceId: { exact: audioInputId } } : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      setPermission('granted');
      await enumerate();

      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const src      = ctx.createMediaStreamSource(stream);
      const gainNode = ctx.createGain();
      gainNode.gain.value = audioInputGain;
      gainNodeRef.current = gainNode;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.4;
      src.connect(gainNode);
      gainNode.connect(analyser);

      const tick = () => {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const rms = Math.sqrt(data.reduce((s, v) => s + v * v, 0) / data.length);
        setMicLevel(Math.min(100, rms * 2.8));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
      setMicActive(true);
    } catch {
      setPermission('denied');
    }
  };

  const stopMic = () => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    ctxRef.current?.close().catch(() => {});
    streamRef.current = null;
    ctxRef.current    = null;
    gainNodeRef.current = null;
    setMicActive(false);
    setMicLevel(0);
  };

  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = audioInputGain;
    }
  }, [audioInputGain]);

  const playTone = async () => {
    if (playingTone) return;
    setPlayingTone(true);
    try {
      const ctx = new AudioContext();
      if (audioOutputId && 'setSinkId' in ctx) {
        await (ctx as AudioContext & { setSinkId(id: string): Promise<void> })
          .setSinkId(audioOutputId).catch(() => {});
      }
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 440;
      gain.gain.setValueAtTime(0.35, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 1.5);
      osc.onended = () => { ctx.close().catch(() => {}); setPlayingTone(false); };
    } catch {
      setPlayingTone(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">

      {/* Permission banner */}
      {permission !== 'granted' && (
        <div className="flex flex-col items-center gap-3 py-5 rounded-lg bg-[var(--bg-input)] text-center">
          {permission === 'denied' ? (
            <>
              <MicOff size={24} className="text-[var(--danger)]" />
              <p className="text-sm font-medium text-[var(--text-primary)]">{t('audio.micDenied')}</p>
              <p className="text-xs text-[var(--text-muted)]">
                {t('audio.micDeniedHint')}
              </p>
            </>
          ) : (
            <>
              <Mic size={24} className="text-[var(--text-muted)]" />
              <p className="text-sm font-medium text-[var(--text-primary)]">{t('audio.micNeeded')}</p>
              <button
                onClick={requestPermission}
                className="px-4 py-2 rounded bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-hover)] transition-colors"
              >
                {t('audio.allow')}
              </button>
            </>
          )}
        </div>
      )}

      {/* Input */}
      <div>
        <label className="block text-xs font-semibold uppercase text-[var(--text-muted)] mb-1.5">
          {t('audio.input')}
        </label>
        <select
          value={audioInputId ?? ''}
          onChange={(e) => setAudioInput(e.target.value || null)}
          disabled={permission !== 'granted'}
          className="w-full px-3 py-2 rounded bg-[var(--bg-input)] text-sm text-[var(--text-primary)] border border-[var(--border-color)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-50"
        >
          <option value="">{t('audio.default')}</option>
          {inputs.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Microphone (${d.deviceId.slice(0, 8)}…)`}
            </option>
          ))}
        </select>

        {/* Sensitivity / gain */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold uppercase text-[var(--text-muted)]">
              {t('audio.sensitivity')}
            </label>
            <span className="text-xs font-mono text-[var(--text-secondary)] w-10 text-right">
              {Math.round(audioInputGain * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={3}
            step={0.05}
            value={audioInputGain}
            onChange={(e) => setAudioInputGain(Number(e.target.value))}
            className="w-full accent-[var(--accent)] cursor-pointer"
          />
          <div className="flex justify-between text-xs text-[var(--text-muted)] mt-0.5">
            <span>0%</span>
            <span className="text-[var(--text-secondary)]">{t('audio.normal')}</span>
            <span>300%</span>
          </div>
        </div>

        {/* Mic test button + volume meter */}
        <div className="flex items-center gap-3 mt-3">
          <button
            onClick={micActive ? stopMic : startMic}
            disabled={permission === 'denied'}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors disabled:opacity-40 ${
              micActive
                ? 'bg-[var(--danger)]/10 text-[var(--danger)] hover:bg-[var(--danger)]/20'
                : 'bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20'
            }`}
          >
            {micActive ? <><MicOff size={14} /> {t('audio.testing')}</> : <><Mic size={14} /> {t('audio.test')}</>}
          </button>

          {/* Animated bar meter */}
          <div className="flex items-end gap-[2px] h-6">
            {Array.from({ length: MIC_BARS }, (_, i) => {
              const threshold = (i / MIC_BARS) * 100;
              const lit = micActive && micLevel > threshold;
              const color = i < MIC_BARS * 0.6
                ? 'bg-green-500'
                : i < MIC_BARS * 0.85
                  ? 'bg-yellow-400'
                  : 'bg-red-500';
              return (
                <div
                  key={i}
                  className={`w-1.5 rounded-sm transition-all duration-75 ${lit ? color : 'bg-white/10'}`}
                  style={{ height: `${35 + (i / MIC_BARS) * 65}%` }}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Output */}
      <div>
        <label className="block text-xs font-semibold uppercase text-[var(--text-muted)] mb-1.5">
          {t('audio.output')}
        </label>
        <select
          value={audioOutputId ?? ''}
          onChange={(e) => setAudioOutput(e.target.value || null)}
          disabled={permission !== 'granted' || outputs.length === 0}
          className="w-full px-3 py-2 rounded bg-[var(--bg-input)] text-sm text-[var(--text-primary)] border border-[var(--border-color)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-50"
        >
          <option value="">{t('audio.default')}</option>
          {outputs.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Speakers (${d.deviceId.slice(0, 8)}…)`}
            </option>
          ))}
        </select>

        {permission === 'granted' && outputs.length === 0 && (
          <p className="text-xs text-[var(--text-muted)] mt-1">
            {t('audio.outputNotSupported')}
          </p>
        )}

        <button
          onClick={playTone}
          disabled={playingTone || permission === 'denied'}
          className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors disabled:opacity-40"
        >
          <Volume2 size={14} />
          {playingTone ? t('audio.testingSpeakers') : t('audio.testSpeakers')}
        </button>
      </div>

      {/* Auto-mic toggle */}
      <div className="flex items-center justify-between gap-4 mt-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)]">{t('audio.autoMic')}</p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">{t('audio.autoMicHint')}</p>
        </div>
        <button
          onClick={() => setAutoMic(!autoMic)}
          className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
            autoMic ? 'bg-[var(--accent)]' : 'bg-white/10'
          }`}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
            autoMic ? 'translate-x-5' : 'translate-x-0'
          }`} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ThemePreview — miniature UI demo
// ---------------------------------------------------------------------------

function ThemePreview() {
  const t = useT();

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Preview</p>

      {/* Mini app */}
      <div className="rounded-lg overflow-hidden border border-[var(--border-color)] text-[10px]" style={{ fontSize: 10 }}>
        {/* Header */}
        <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-[var(--border-color)]" style={{ background: 'var(--bg-secondary)' }}>
          <div className="w-2 h-2 rounded-full" style={{ background: 'var(--accent)' }} />
          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}># general</span>
        </div>

        {/* Messages */}
        <div className="flex flex-col gap-2 p-2" style={{ background: 'var(--bg-tertiary)' }}>
          {/* Message 1 */}
          <div className="flex gap-1.5">
            <div className="w-5 h-5 rounded-full shrink-0" style={{ background: 'var(--accent)' }} />
            <div>
              <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Alice</span>
              <p style={{ color: 'var(--text-secondary)' }}>Hey everyone! 👋</p>
            </div>
          </div>
          {/* Message 2 */}
          <div className="flex gap-1.5">
            <div className="w-5 h-5 rounded-full shrink-0" style={{ background: 'var(--danger)' }} />
            <div>
              <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Bob</span>
              <p style={{ color: 'var(--text-secondary)' }}>What's up?</p>
            </div>
          </div>
          {/* Message 3 */}
          <div className="flex gap-1.5">
            <div className="w-5 h-5 rounded-full shrink-0" style={{ background: '#22c55e' }} />
            <div>
              <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Charlie</span>
              <p style={{ color: 'var(--text-muted)' }}>Not much, just testing themes 🎨</p>
            </div>
          </div>
        </div>

        {/* Input field */}
        <div className="px-2 py-1.5" style={{ background: 'var(--bg-tertiary)' }}>
          <div className="rounded-md px-2 py-1" style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>
            Message #general
          </div>
        </div>
      </div>

      {/* Buttons */}
      <div className="flex flex-col gap-1.5">
        <button className="w-full py-1.5 rounded-lg text-[10px] font-medium text-white" style={{ background: 'var(--accent)' }}>
          Accent Button
        </button>
        <button className="w-full py-1.5 rounded-lg text-[10px] font-medium text-white" style={{ background: 'var(--danger)' }}>
          Danger Button
        </button>
        <button className="w-full py-1.5 rounded-lg text-[10px] font-medium" style={{ background: 'var(--bg-input)', color: 'var(--text-secondary)' }}>
          Secondary Button
        </button>
      </div>

      {/* Sidebar preview */}
      <div className="rounded-lg overflow-hidden border border-[var(--border-color)]" style={{ fontSize: 10 }}>
        <div className="px-2 py-1.5 font-semibold" style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color)' }}>
          My Server
        </div>
        <div className="flex flex-col gap-0.5 p-1.5" style={{ background: 'var(--bg-secondary)' }}>
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-input)', color: 'var(--text-primary)' }}>
            <span style={{ color: 'var(--text-muted)' }}>#</span> general
          </div>
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ color: 'var(--text-muted)' }}>
            <span>#</span> random
          </div>
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ color: 'var(--text-muted)' }}>
            <span>🔊</span> Voice
          </div>
        </div>
        {/* Mini user panel */}
        <div className="flex items-center gap-1.5 px-2 py-1.5" style={{ background: 'var(--bg-primary)', borderTop: '1px solid var(--border-color)' }}>
          <div className="relative">
            <div className="w-4 h-4 rounded-full" style={{ background: 'var(--accent)' }} />
            <div className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-green-500 border border-[var(--bg-primary)]" />
          </div>
          <span style={{ color: 'var(--text-primary)' }}>You</span>
        </div>
      </div>

      {/* Typography */}
      <div className="rounded-lg p-2 space-y-1" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}>
        <p style={{ color: 'var(--text-primary)', fontSize: 11, fontWeight: 600 }}>Typography</p>
        <p style={{ color: 'var(--text-primary)', fontSize: 10 }}>Primary text</p>
        <p style={{ color: 'var(--text-secondary)', fontSize: 10 }}>Secondary text</p>
        <p style={{ color: 'var(--text-muted)', fontSize: 10 }}>Muted text</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AppearanceTab
// ---------------------------------------------------------------------------

const COLOR_KEYS: { key: keyof ThemeColors; labelKey: string }[] = [
  { key: 'accent',        labelKey: 'appearance.accent' },
  { key: 'accentHover',   labelKey: 'appearance.accentHover' },
  { key: 'accentText',    labelKey: 'appearance.accentText' },
  { key: 'bgPrimary',     labelKey: 'appearance.bgPrimary' },
  { key: 'bgSecondary',   labelKey: 'appearance.bgSecondary' },
  { key: 'bgTertiary',    labelKey: 'appearance.bgTertiary' },
  { key: 'bgInput',       labelKey: 'appearance.bgInput' },
  { key: 'textPrimary',   labelKey: 'appearance.textPrimary' },
  { key: 'textSecondary', labelKey: 'appearance.textSecondary' },
  { key: 'textMuted',     labelKey: 'appearance.textMuted' },
  { key: 'borderColor',   labelKey: 'appearance.borderColor' },
  { key: 'dangerColor',   labelKey: 'appearance.dangerColor' },
];

function AppearanceTab() {
  const t = useT();
  const { current, setColor, setShape, setTheme, resetToPreset } = useThemeStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState('');

  const handleExport = useCallback(() => {
    const blob = new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cord-theme-${current.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [current]);

  const handleImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const theme = JSON.parse(reader.result as string) as Theme;
        if (!theme.colors || !theme.name) throw new Error();
        if (!theme.shape) theme.shape = { borderRadius: 8, fontSize: 14, fontFamily: 'system' };
        if (!theme.shape.fontFamily) theme.shape.fontFamily = 'system';
        setTheme(theme);
        setImportMsg(t('appearance.imported'));
      } catch {
        setImportMsg(t('appearance.importError'));
      }
      setTimeout(() => setImportMsg(''), 3000);
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [setTheme, t]);

  return (
    <div className="flex gap-6">
      <div className="flex-1 flex flex-col gap-5 min-w-0">
      {/* Presets */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">
          {t('appearance.presets')}
        </h3>
        <div className="grid grid-cols-4 gap-2">
          {PRESET_THEMES.map((p) => (
            <button
              key={p.name}
              onClick={() => resetToPreset(p.name)}
              className={`
                flex flex-col items-center gap-1.5 p-2 rounded-lg text-xs font-medium transition-colors
                ${current.name === p.name ? 'ring-2 ring-[var(--accent)]' : ''}
              `}
              style={{ background: p.colors.bgSecondary, color: p.colors.textPrimary }}
            >
              <div className="flex gap-1">
                <div className="w-3 h-3 rounded-full" style={{ background: p.colors.accent }} />
                <div className="w-3 h-3 rounded-full" style={{ background: p.colors.bgPrimary }} />
                <div className="w-3 h-3 rounded-full" style={{ background: p.colors.textPrimary }} />
              </div>
              {t(`appearance.preset.${p.name}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Colors */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">
          {t('appearance.colors')}
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {COLOR_KEYS.map(({ key, labelKey }) => (
            <label key={key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors cursor-pointer">
              <input
                type="color"
                value={current.colors[key]}
                onChange={(e) => setColor(key, e.target.value)}
                className="w-6 h-6 rounded border-0 cursor-pointer bg-transparent [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded"
              />
              <span className="text-xs text-[var(--text-secondary)]">{t(labelKey)}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Shape */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">
          {t('appearance.shape')}
        </h3>
        <div className="space-y-3">
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-xs text-[var(--text-secondary)]">{t('appearance.borderRadius')}</span>
              <span className="text-xs text-[var(--text-muted)]">{current.shape.borderRadius}px</span>
            </div>
            <input
              type="range" min={0} max={20}
              value={current.shape.borderRadius}
              onChange={(e) => setShape('borderRadius', Number(e.target.value))}
              className="w-full accent-[var(--accent)] h-1.5"
            />
            <div className="flex gap-2 mt-2">
              {[0, 4, 8, 12, 20].map((r) => (
                <div
                  key={r}
                  className={`w-8 h-8 bg-[var(--accent)] transition-all ${current.shape.borderRadius === r ? 'ring-2 ring-white/50' : ''}`}
                  style={{ borderRadius: r }}
                  onClick={() => setShape('borderRadius', r)}
                />
              ))}
            </div>
          </div>

          <div>
            <div className="flex justify-between mb-1">
              <span className="text-xs text-[var(--text-secondary)]">{t('appearance.fontSize')}</span>
              <span className="text-xs text-[var(--text-muted)]">{current.shape.fontSize}px</span>
            </div>
            <input
              type="range" min={12} max={18}
              value={current.shape.fontSize}
              onChange={(e) => setShape('fontSize', Number(e.target.value))}
              className="w-full accent-[var(--accent)] h-1.5"
            />
          </div>

          <div>
            <span className="text-xs text-[var(--text-secondary)] block mb-2">{t('appearance.fontFamily')}</span>
            <select
              value={current.shape.fontFamily}
              onChange={(e) => setShape('fontFamily', e.target.value as FontValue)}
              className="w-full px-3 py-2 rounded-lg text-sm bg-[var(--bg-input)] text-[var(--text-primary)] border border-[var(--border-color)] outline-none focus:border-[var(--accent)] transition-colors"
              style={{
                fontFamily: FONT_OPTIONS.find((f) => f.value === current.shape.fontFamily)?.stack,
              }}
            >
              {FONT_OPTIONS.map((font) => (
                <option key={font.value} value={font.value} style={{ fontFamily: font.stack }}>
                  {font.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Actions: reset, export, import */}
      <div className="flex flex-col gap-2 pt-2 border-t border-[var(--border-color)]">
        <div className="flex gap-2">
          <button
            onClick={() => resetToPreset('dark')}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium bg-white/5 text-[var(--text-secondary)] hover:bg-white/10 transition-colors"
          >
            <RotateCcw size={14} />
            {t('appearance.reset')}
          </button>
          <button
            onClick={handleExport}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium bg-white/5 text-[var(--text-secondary)] hover:bg-white/10 transition-colors"
          >
            <Download size={14} />
            {t('appearance.export')}
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium bg-white/5 text-[var(--text-secondary)] hover:bg-white/10 transition-colors"
          >
            <Upload size={14} />
            {t('appearance.import')}
          </button>
          <input ref={fileInputRef} type="file" accept=".json" onChange={handleImport} className="hidden" />
        </div>
        {importMsg && (
          <p className="text-xs text-center text-[var(--accent)]">{importMsg}</p>
        )}
      </div>
      </div>
      {/* Preview */}
      <div className="w-56 shrink-0">
        <ThemePreview />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NotificationsTab
// ---------------------------------------------------------------------------
function NotificationsTab() {
  const t = useT();
  const browserEnabled = useNotificationStore((s) => s.browserEnabled);
  const setBrowserEnabled = useNotificationStore((s) => s.setBrowserEnabled);
  const [denied, setDenied] = useState(false);

  const handleBrowserToggle = async () => {
    if (browserEnabled) {
      setBrowserEnabled(false);
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      setBrowserEnabled(true);
      setDenied(false);
    } else {
      setDenied(true);
      setBrowserEnabled(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Browser notifications toggle */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)]">{t('notifications.browser')}</p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">{t('notifications.browserHint')}</p>
          {denied && (
            <p className="text-xs text-[var(--danger)] mt-1 flex items-center gap-1">
              <BellOff size={12} />
              {t('notifications.denied')}
            </p>
          )}
        </div>
        <button
          onClick={handleBrowserToggle}
          className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
            browserEnabled ? 'bg-[var(--accent)]' : 'bg-white/10'
          }`}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
            browserEnabled ? 'translate-x-5' : 'translate-x-0'
          }`} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LanguageTab
// ---------------------------------------------------------------------------
function LanguageTab() {
  const t = useT();
  const { lang, setLang } = useLangStore();

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-[var(--text-primary)]">{t('lang.title')}</h2>
      <div className="space-y-2">
        {Object.entries(LANGUAGES).map(([code, { label }]) => (
          <button
            key={code}
            onClick={() => setLang(code)}
            className={`w-full text-left px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
              lang === code
                ? 'bg-[var(--accent)] text-white'
                : 'bg-white/5 text-[var(--text-secondary)] hover:bg-white/10'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SettingsModal
// ---------------------------------------------------------------------------
export function SettingsModal({ onClose }: SettingsModalProps) {
  const t = useT();
  const [tab, setTab] = useState<Tab>('profile');

  // Close on Escape
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const isMobile = window.innerWidth < 768;
  const tabList: { id: Tab; label: string }[] = [
    { id: 'profile',       label: t('settings.profile')       },
    { id: 'security',      label: t('settings.security')      },
    { id: 'audio',         label: t('settings.audio')         },
    { id: 'notifications', label: t('settings.notifications') },
    ...(!isMobile ? [{ id: 'appearance' as Tab, label: t('appearance.title') }] : []),
    { id: 'language',      label: t('settings.language')      },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-4xl bg-[var(--bg-secondary)] rounded-xl shadow-2xl flex overflow-hidden h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Side navigation */}
        <div className="w-44 shrink-0 flex flex-col bg-[var(--bg-primary)] py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] px-4 mb-2">
            {t('settings')}
          </p>
          {tabList.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`text-left px-4 py-2 text-sm transition-colors ${
                tab === id
                  ? 'bg-white/10 text-[var(--text-primary)] font-medium'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-white/5'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)] shrink-0">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              {tabList.find((tb) => tb.id === tab)?.label}
            </h2>
            <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
              <X size={20} />
            </button>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-6">
            {tab === 'profile'       && <ProfileTab onClose={onClose} />}
            {tab === 'security'      && <SecurityTab onClose={onClose} />}
            {tab === 'audio'         && <AudioTab />}
            {tab === 'notifications' && <NotificationsTab />}
            {tab === 'appearance'    && <AppearanceTab />}
            {tab === 'language'      && <LanguageTab />}
          </div>
        </div>
      </div>
    </div>
  );
}
