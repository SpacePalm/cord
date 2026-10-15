// Web-only "Голос и видео": iOS has no such screen (only the voice room's
// devices sheet), so it is styled like iOS VoiceDeviceSettingsView — inset-grouped sections with checkmark
// device rows (icon --text-secondary · name · accent checkmark), toggles and a slider. Reuses the desktop
// SettingsModal Audio/Video logic and the sessionStore per-device fields (audioInputId, audioOutputId,
// audioInputGain, autoMic, videoInputId, cameraAllowed).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen } from '../../nav/Screen';
import { useScreenCtx } from '../../nav/NavStack';
import { InsetGroupedList, ListSection, Row, CheckRow, ToggleRow, ButtonRow, Slider, Icon, type SFSymbol } from '../../ui';
import { useMT } from '../../i18n';
import { useSessionStore } from '../../../store/sessionStore';
import { useMediaDevices, useMicTest, useSpeakerTest, canSelectOutput } from './mediaDevices';
import './settings.css';

const METER_BARS = 20;

function inputIcon(label: string): SFSymbol {
  if (/airpods|bluetooth|\bbt\b|hands-?free/i.test(label)) return 'airpodspro';
  if (/head(set|phone)|наушник|гарнитур|wired|line/i.test(label)) return 'headphones';
  return 'mic';
}

function DeviceIcon({ name }: { name: SFSymbol }) {
  return (
    <span className="m-set-device-icon" aria-hidden>
      <Icon name={name} size={22} />
    </span>
  );
}

function Meter({ level, active }: { level: number; active: boolean }) {
  return (
    <span className="m-set-meter" aria-hidden>
      {Array.from({ length: METER_BARS }, (_, i) => {
        const lit = active && level > (i / METER_BARS) * 100;
        const color = i < METER_BARS * 0.6 ? 'var(--ios-green)' : i < METER_BARS * 0.85 ? 'var(--ios-yellow)' : 'var(--ios-red)';
        return <span key={i} style={{ height: `${35 + (i / METER_BARS) * 65}%`, background: lit ? color : undefined }} />;
      })}
    </span>
  );
}

/** Web-only extra: microphone / speaker / camera devices. */
export function VoiceVideoScreen() {
  const t = useMT();
  const { isTop } = useScreenCtx();

  const audioInputId = useSessionStore((s) => s.audioInputId);
  const audioOutputId = useSessionStore((s) => s.audioOutputId);
  const audioInputGain = useSessionStore((s) => s.audioInputGain);
  const autoMic = useSessionStore((s) => s.autoMic);
  const videoInputId = useSessionStore((s) => s.videoInputId);
  const cameraAllowed = useSessionStore((s) => s.cameraAllowed);
  const setAudioInput = useSessionStore((s) => s.setAudioInput);
  const setAudioOutput = useSessionStore((s) => s.setAudioOutput);
  const setAudioInputGain = useSessionStore((s) => s.setAudioInputGain);
  const setAutoMic = useSessionStore((s) => s.setAutoMic);
  const setVideoInput = useSessionStore((s) => s.setVideoInput);
  const setCameraAllowed = useSessionStore((s) => s.setCameraAllowed);

  const mic = useMediaDevices('microphone');
  const cam = useMediaDevices('camera', cameraAllowed);
  const { setPermission: setMicPermission, enumerate: enumerateMic } = mic;
  const onMicGranted = useCallback(() => {
    setMicPermission('granted');
    void enumerateMic();
  }, [setMicPermission, enumerateMic]);
  const onMicDenied = useCallback(() => setMicPermission('denied'), [setMicPermission]);
  const test = useMicTest(audioInputId, audioInputGain, onMicGranted, onMicDenied);
  const speaker = useSpeakerTest(audioOutputId);
  const outputSelectable = canSelectOutput();

  // camera preview
  const [camStream, setCamStream] = useState<MediaStream | null>(null);
  const camRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  /** Bumped by every start/stop: a camera that opens after the screen was left is closed at once. */
  const camGen = useRef(0);
  const stopCamera = useCallback(() => {
    camGen.current++;
    camRef.current?.getTracks().forEach((tr) => tr.stop());
    camRef.current = null;
    setCamStream(null);
  }, []);
  const startCamera = async () => {
    stopCamera(); // a double tap while the prompt is pending must not orphan the first stream
    const gen = camGen.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: videoInputId ? { deviceId: { exact: videoInputId } } : true });
      if (gen !== camGen.current) {
        stream.getTracks().forEach((tr) => tr.stop());
        return;
      }
      camRef.current = stream;
      setCamStream(stream);
      cam.setPermission('granted');
      void cam.enumerate();
    } catch {
      if (gen === camGen.current) cam.setPermission('denied');
    }
  };
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = camStream;
    if (camStream) void v.play().catch(() => {});
  }, [camStream]);

  // stop every capture when leaving the screen (pop or a push on top) and on unmount
  const stopAll = useRef(() => {});
  stopAll.current = () => {
    test.stop();
    stopCamera();
  };
  useEffect(() => {
    if (!isTop) stopAll.current();
  }, [isTop]);
  useEffect(() => () => stopAll.current(), []);
  useEffect(() => {
    if (!cameraAllowed) stopCamera();
  }, [cameraAllowed, stopCamera]);

  const pickInput = (id: string | null) => {
    if (id === audioInputId) return;
    if (test.active) test.stop();
    setAudioInput(id);
  };
  const pickCamera = (id: string | null) => {
    if (id === videoInputId) return;
    if (camRef.current) stopCamera();
    setVideoInput(id);
  };

  const fallbackName = (i: number) => t('settings.deviceFallback', i + 1);
  const micGranted = mic.permission === 'granted';
  const camGranted = cam.permission === 'granted';

  return (
    <Screen title={t('settings.voiceVideo')}>
      <InsetGroupedList>
        {!micGranted && (
          <ListSection footer={mic.permission === 'denied' ? t('audio.micDeniedHint') : t('audio.micNeeded')}>
            {mic.permission === 'denied' ? (
              <Row icon="mic.slash.fill" iconColor="var(--danger)" title={t('audio.micDenied')} titleColor="var(--danger)" />
            ) : (
              <ButtonRow icon="mic" title={t('audio.allow')} onPress={() => void mic.request()} />
            )}
          </ListSection>
        )}

        <ListSection header={t('settings.micSection')}>
          <CheckRow
            leading={<DeviceIcon name="mic" />}
            title={t('audio.default')}
            checked={!audioInputId}
            onPress={() => pickInput(null)}
          />
          {mic.inputs.map((d, i) => (
            <CheckRow
              key={d.deviceId}
              leading={<DeviceIcon name={inputIcon(d.label)} />}
              title={d.label || fallbackName(i)}
              checked={audioInputId === d.deviceId}
              onPress={() => pickInput(d.deviceId)}
            />
          ))}
        </ListSection>

        <ListSection>
          <ToggleRow title={t('audio.autoMic')} subtitle={t('audio.autoMicHint')} checked={autoMic} onChange={setAutoMic} />
          <Row>
            <div className="m-set-radius">
              <div className="m-set-radius-head">
                <span style={{ color: 'var(--text-primary)' }}>{t('audio.sensitivity')}</span>
                <span className="ios-tabular" style={{ color: 'var(--text-muted)' }}>
                  {Math.round(audioInputGain * 100)}%
                </span>
              </div>
              <Slider value={audioInputGain} min={0} max={3} step={0.05} onChange={setAudioInputGain} ariaLabel={t('audio.sensitivity')} />
            </div>
          </Row>
          <Row
            title={test.active ? t('settings.micTestStop') : t('settings.micTest')}
            titleColor={test.active ? 'var(--ios-red)' : 'var(--accent)'}
            disabled={mic.permission === 'denied'}
            onPress={() => (test.active ? test.stop() : void test.start())}
            trailing={<Meter level={test.level} active={test.active} />}
          />
        </ListSection>

        {outputSelectable && (
          <ListSection header={t('voice.output')}>
            <CheckRow
              leading={<DeviceIcon name="speaker.wave.2.fill" />}
              title={t('audio.default')}
              checked={!audioOutputId}
              onPress={() => setAudioOutput(null)}
            />
            {micGranted &&
              mic.outputs.map((d, i) => (
                <CheckRow
                  key={d.deviceId}
                  leading={<DeviceIcon name={/head|airpods|bluetooth|наушник/i.test(d.label) ? 'headphones' : 'speaker.wave.2.fill'} />}
                  title={d.label || fallbackName(i)}
                  checked={audioOutputId === d.deviceId}
                  onPress={() => setAudioOutput(d.deviceId)}
                />
              ))}
            <ButtonRow
              title={speaker.playing ? t('audio.testingSpeakers') : t('audio.testSpeakers')}
              disabled={speaker.playing}
              onPress={() => void speaker.play()}
            />
          </ListSection>
        )}

        <ListSection header={t('settings.cameraSection')} footer={t('camera.allowHint')}>
          <ToggleRow title={t('camera.allow')} checked={cameraAllowed} onChange={setCameraAllowed} />
        </ListSection>

        {cameraAllowed && (
          <ListSection footer={cam.permission === 'denied' ? t('camera.deniedHint') : undefined}>
            {cam.permission === 'denied' && (
              <Row icon="video.slash.fill" iconColor="var(--danger)" title={t('camera.denied')} titleColor="var(--danger)" />
            )}
            {cam.permission === 'unknown' && <ButtonRow icon="video" title={t('camera.grant')} onPress={() => void cam.request()} />}
            <CheckRow
              leading={<DeviceIcon name="video" />}
              title={t('audio.default')}
              checked={!videoInputId}
              onPress={() => pickCamera(null)}
            />
            {camGranted &&
              cam.inputs.map((d, i) => (
                <CheckRow
                  key={d.deviceId}
                  leading={<DeviceIcon name="video" />}
                  title={d.label || fallbackName(i)}
                  checked={videoInputId === d.deviceId}
                  onPress={() => pickCamera(d.deviceId)}
                />
              ))}
            <ButtonRow
              title={camStream ? t('settings.cameraStop') : t('settings.cameraTest')}
              role={camStream ? 'destructive' : 'default'}
              disabled={cam.permission === 'denied'}
              onPress={() => (camStream ? stopCamera() : void startCamera())}
            />
            {camStream && (
              <Row>
                <div className="m-set-video">
                  <video ref={videoRef} autoPlay playsInline muted />
                </div>
              </Row>
            )}
          </ListSection>
        )}
      </InsetGroupedList>
    </Screen>
  );
}
