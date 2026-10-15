// Small shared pieces of the mobile voice UI.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { VideoTrack } from 'livekit-client';
import { Icon, type SFSymbol } from '../../ui/Icon';
import { Slider } from '../../ui/Slider';
import { setUserVolume, useVoiceStore, volumeOf, type VoiceQuality } from './voiceStore';
import './voice.css';

/** iOS `VoiceFormat.duration`: «M:SS» (minutes not zero-padded) / «H:MM:SS». */
export function formatCallDuration(sinceMs: number, now = Date.now()): string {
  const total = Math.floor(Math.max(0, now - sinceMs) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Re-render every `ms` while `enabled`. */
export function useTicker(ms: number, enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const iv = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(iv);
  }, [ms, enabled]);
  return now;
}

/**
 * Mount/unmount with an enter + exit transition (SwiftUI `.transition(...)`): the node animates in
 * with a CSS keyframe animation on mount and gets `leaving` (exit animation) for `exitMs` before it
 * unmounts. Keyframes (not rAF-driven classes) so it also works when the tab is in the background.
 */
export function useTransitionPresence(visible: boolean, exitMs = 320): { mounted: boolean; leaving: boolean } {
  const [mounted, setMounted] = useState(visible);
  useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }
    const t = window.setTimeout(() => setMounted(false), exitMs);
    return () => window.clearTimeout(t);
  }, [visible, exitMs]);
  return { mounted: mounted || visible, leaving: !visible };
}

/** iOS `VoiceQualityBars`: 3 bars 3×(4/7/10), radius 1, gap 1.5; lost → poor. */
export function QualityBars({ quality }: { quality: VoiceQuality }) {
  const filled = quality === 'excellent' ? 3 : quality === 'good' ? 2 : quality === 'poor' ? 1 : 0;
  const color =
    quality === 'excellent' ? 'var(--ios-green)' : quality === 'good' ? 'var(--ios-yellow)' : 'var(--ios-orange)';
  return (
    <span className="m-voice-qbars" aria-hidden>
      {[0, 1, 2].map((i) => (
        <i key={i} style={{ height: 4 + i * 3, background: i < filled ? color : undefined }} />
      ))}
    </span>
  );
}

export interface CallButtonProps {
  size: 58 | 44 | 38;
  icon: SFSymbol;
  iconSize: number;
  bg: string;
  fg: string;
  onPress: () => void;
  disabled?: boolean;
  ariaLabel: string;
  /** Hand-drawn slash over the glyph (room deafen button). */
  slash?: boolean;
  className?: string;
}

/** Borderless circle button (room controls 58 / call card 44 / floating bar 38). */
export function CallButton({ size, icon, iconSize, bg, fg, onPress, disabled, ariaLabel, slash, className }: CallButtonProps) {
  return (
    <button
      type="button"
      className={'m-voice-callbtn' + (className ? ` ${className}` : '')}
      style={{ width: size, height: size, background: bg, color: fg } as CSSProperties}
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation();
        onPress();
      }}
    >
      <Icon name={icon} size={iconSize} />
      {slash && <span className="m-voice-slash" aria-hidden />}
    </button>
  );
}

/** Bare glyph button (room header gear / chevron, share expand, fullscreen close). */
export function GlyphButton({
  children,
  onPress,
  ariaLabel,
  className,
  style,
}: {
  children: ReactNode;
  onPress: () => void;
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      className={'m-voice-glyphbtn' + (className ? ` ${className}` : '')}
      aria-label={ariaLabel}
      style={style}
      onClick={(e) => {
        e.stopPropagation();
        onPress();
      }}
    >
      {children}
    </button>
  );
}

/** <video> bound to a LiveKit video track (clears the last frame on detach). */
export function VideoView({ track, mirror, fit = 'cover', className }: { track: VideoTrack; mirror?: boolean; fit?: 'cover' | 'contain'; className?: string }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
      el.srcObject = null;
      try {
        el.load();
      } catch {
        /* ignore */
      }
    };
  }, [track]);
  return (
    <video
      ref={ref}
      className={'m-voice-video' + (mirror ? ' is-mirror' : '') + (className ? ` ${className}` : '')}
      style={{ objectFit: fit }}
      autoPlay
      playsInline
      muted
    />
  );
}

/** iOS `ScreenVolumeSlider`: white speaker glyph + 0…300 % slider bound to the per-user volume. */
export function ScreenVolumeSlider({ identity, width = 110 }: { identity: string; width?: number }) {
  const vol = useVoiceStore((s) => volumeOf(identity, s.volumes));
  const muted = useVoiceStore((s) => !!s.mutedUsers[identity]);
  return (
    <span className="m-voice-svol" data-no-sheet-drag onClick={(e) => e.stopPropagation()}>
      <Icon name={muted || vol <= 0.01 ? 'speaker.slash.fill' : 'speaker.wave.2.fill'} size={14} color="#fff" />
      <Slider
        value={vol}
        min={0}
        max={3}
        step={0.01}
        disabled={muted}
        onChange={(v) => setUserVolume(identity, v)}
        style={{ width }}
      />
    </span>
  );
}
