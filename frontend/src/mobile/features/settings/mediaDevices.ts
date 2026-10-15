// Device-permission / enumeration / test helpers for the web-only "Голос и видео" screen. Logic ported from
// the desktop SettingsModal AudioTab / VideoTab (permission probe via Permissions API with a label fallback,
// devicechange + focus re-checks, mic level meter through an AnalyserNode, 440 Hz speaker tone).
import { useCallback, useEffect, useRef, useState } from 'react';
import { supportsOutputSelection } from '../voice/voiceAudio';

export type DevicePermission = 'unknown' | 'granted' | 'denied';

const hasMediaDevices = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.enumerateDevices;

/** Permission state + device lists for `microphone` (audioinput / audiooutput) or `camera` (videoinput). */
export function useMediaDevices(kind: 'microphone' | 'camera', enabled = true) {
  const [permission, setPermission] = useState<DevicePermission>('unknown');
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const statusRef = useRef<PermissionStatus | null>(null);

  const enumerate = useCallback(async () => {
    if (!hasMediaDevices()) return;
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      if (kind === 'microphone') {
        setInputs(devs.filter((d) => d.kind === 'audioinput' && d.deviceId));
        setOutputs(devs.filter((d) => d.kind === 'audiooutput' && d.deviceId));
      } else {
        setInputs(devs.filter((d) => d.kind === 'videoinput' && d.deviceId));
      }
    } catch {
      /* ignore */
    }
  }, [kind]);

  const check = useCallback(async () => {
    if (!hasMediaDevices()) {
      setPermission('denied');
      return;
    }
    let state: PermissionState | null = null;
    try {
      const status = await navigator.permissions.query({ name: kind as PermissionName });
      state = status.state;
      if (statusRef.current !== status) {
        if (statusRef.current) statusRef.current.onchange = null;
        statusRef.current = status;
        status.onchange = () => {
          const next = status.state;
          setPermission(next === 'prompt' ? 'unknown' : next);
          if (next === 'granted') void enumerate();
        };
      }
    } catch {
      // Permissions API without this name (older Safari / Firefox) → infer from device labels
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        const want = kind === 'microphone' ? 'audioinput' : 'videoinput';
        state = devs.some((d) => d.kind === want && d.label) ? 'granted' : 'prompt';
      } catch {
        state = 'prompt';
      }
    }
    if (state === 'granted') {
      setPermission('granted');
      await enumerate();
    } else {
      setPermission(state === 'denied' ? 'denied' : 'unknown');
    }
  }, [kind, enumerate]);

  useEffect(() => {
    if (!enabled) {
      setPermission('unknown');
      return;
    }
    void check();
    const onChange = () => void check();
    navigator.mediaDevices?.addEventListener?.('devicechange', onChange);
    window.addEventListener('focus', onChange);
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', onChange);
      window.removeEventListener('focus', onChange);
      if (statusRef.current) statusRef.current.onchange = null;
      statusRef.current = null;
    };
  }, [enabled, check]);

  /** Ask for access (getUserMedia inside the tap), then list the devices with labels. */
  const request = useCallback(async () => {
    try {
      const tmp = await navigator.mediaDevices.getUserMedia(kind === 'microphone' ? { audio: true } : { video: true });
      tmp.getTracks().forEach((tr) => tr.stop());
      setPermission('granted');
      await enumerate();
    } catch {
      setPermission('denied');
    }
  }, [kind, enumerate]);

  return { permission, setPermission, inputs, outputs, request, enumerate };
}

/** Microphone test with a level meter (0…100). */
export function useMicTest(deviceId: string | null, gain: number, onGranted?: () => void, onDenied?: () => void) {
  const [active, setActive] = useState(false);
  const [level, setLevel] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const rafRef = useRef(0);
  /** Bumped by every start/stop: a getUserMedia that resolves after a stop (screen left) is dropped. */
  const genRef = useRef(0);

  const stop = useCallback(() => {
    genRef.current++;
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    ctxRef.current?.close().catch(() => {});
    streamRef.current = null;
    ctxRef.current = null;
    gainRef.current = null;
    setActive(false);
    setLevel(0);
  }, []);

  const start = useCallback(async () => {
    // a second tap while the permission prompt / device is pending must not orphan the first capture
    stop();
    const gen = genRef.current;
    let ctx: AudioContext | null = null;
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      ctx = AC ? new AC() : null; // create inside the tap (iOS autoplay policy)
      ctxRef.current = ctx; // owned from now on: stop() closes it even while getUserMedia is pending
      const stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true });
      if (gen !== genRef.current) {
        // stopped (left the screen / tapped again) while waiting → release the mic right away
        stream.getTracks().forEach((tr) => tr.stop());
        return;
      }
      streamRef.current = stream;
      onGranted?.();
      if (!ctx) {
        setActive(true);
        return;
      }
      void ctx.resume?.();
      const src = ctx.createMediaStreamSource(stream);
      const g = ctx.createGain();
      g.gain.value = gain;
      gainRef.current = g;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.4;
      src.connect(g);
      g.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        setLevel(Math.min(100, Math.sqrt(sum / data.length) * 2.8));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
      setActive(true);
    } catch {
      if (gen !== genRef.current) {
        // superseded: the newer start/stop owns the refs; just make sure this attempt's context is gone
        if (ctx && ctx !== ctxRef.current) ctx.close().catch(() => {});
        return;
      }
      stop(); // closes the context created for this attempt (no AudioContext leak per denied test)
      onDenied?.();
    }
  }, [deviceId, gain, onGranted, onDenied, stop]);

  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = gain;
  }, [gain]);

  useEffect(() => stop, [stop]);

  return { active, level, start, stop };
}

/** 1.5 s 440 Hz tone on the chosen output (setSinkId where supported). */
export function useSpeakerTest(outputId: string | null) {
  const [playing, setPlaying] = useState(false);
  const play = useCallback(async () => {
    if (playing) return;
    setPlaying(true);
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      if (outputId && 'setSinkId' in ctx) {
        await (ctx as AudioContext & { setSinkId(id: string): Promise<void> }).setSinkId(outputId).catch(() => {});
      }
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 440;
      g.gain.setValueAtTime(0.35, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.5);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 1.5);
      osc.onended = () => {
        ctx.close().catch(() => {});
        setPlaying(false);
      };
    } catch {
      setPlaying(false);
    }
  }, [outputId, playing]);
  return { playing, play };
}

/**
 * Whether the browser can route audio to a chosen output (absent on iOS Safari). The mobile voice engine
 * plays remote audio through Web Audio (LiveKit `webAudioMix`), whose output only follows
 * `AudioContext.setSinkId` — `HTMLMediaElement.setSinkId` alone (e.g. Firefox) would offer a picker that
 * changes nothing in calls. Same test as the room's devices sheet.
 */
export function canSelectOutput(): boolean {
  return supportsOutputSelection();
}
