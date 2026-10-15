// iOS `VoiceDeviceSettingsView` (sheet [.medium, .large], gear in the room header).
// Web: microphone list (+ camera list) from enumerateDevices(); output devices only where the
// browser can route Web Audio to them (AudioContext.setSinkId) — otherwise a "Route — Default" row.
import { useEffect, useState } from 'react';
import { SheetScreen } from '../../nav/Screen';
import { BarTextButton } from '../../nav/BarButton';
import { InsetGroupedList, ListSection, Row, ValueRow } from '../../ui/List';
import { Icon, type SFSymbol } from '../../ui/Icon';
import { useMT } from '../../i18n';
import type { SheetCtx } from '../../present/PresentationProvider';
import { useSessionStore } from '../../../store/sessionStore';
import { activeDevice } from './voiceEngine';
import { supportsOutputSelection } from './voiceAudio';
import { presentVoiceSheet } from './voicePresent';
import './voice.css';

interface Dev {
  id: string;
  label: string;
}

function useDevices(): { inputs: Dev[]; outputs: Dev[]; cameras: Dev[] } {
  const [devs, setDevs] = useState<{ inputs: Dev[]; outputs: Dev[]; cameras: Dev[] }>({ inputs: [], outputs: [], cameras: [] });
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.enumerateDevices) return;
    let alive = true;
    const refresh = () => {
      md.enumerateDevices()
        .then((list) => {
          if (!alive) return;
          const pick = (kind: MediaDeviceKind): Dev[] =>
            list
              .filter((d) => d.kind === kind && d.deviceId)
              .map((d, i) => ({ id: d.deviceId, label: d.label || `${kind === 'videoinput' ? 'Camera' : 'Microphone'} ${i + 1}` }));
          setDevs({ inputs: pick('audioinput'), outputs: pick('audiooutput').filter((d) => d.label), cameras: pick('videoinput') });
        })
        .catch(() => undefined);
    };
    refresh();
    md.addEventListener?.('devicechange', refresh);
    return () => {
      alive = false;
      md.removeEventListener?.('devicechange', refresh);
    };
  }, []);
  return devs;
}

function audioIcon(label: string): SFSymbol {
  if (/airpods|bluetooth|buds|\bbt\b/i.test(label)) return 'airpodspro';
  if (/headset|headphone|наушник|гарнитур|wired/i.test(label)) return 'headphones';
  return 'mic';
}

function currentOf(list: Dev[], preferred: string | null | undefined, kind: MediaDeviceKind): string | null {
  const want = preferred ?? activeDevice(kind) ?? 'default';
  if (list.some((d) => d.id === want)) return want;
  return list[0]?.id ?? null;
}

function DeviceRow({ dev, icon, current, onPick }: { dev: Dev; icon: SFSymbol; current: boolean; onPick: () => void }) {
  return (
    <Row
      leading={<Icon name={icon} size={22} color="var(--text-secondary)" />}
      leadingGap={10}
      title={dev.label}
      titleLines={1}
      onPress={onPick}
      a11yRole="radio"
      ariaChecked={current}
      trailing={current ? <Icon name="checkmark" size={20} strokeWidth={2} color="var(--accent)" /> : undefined}
    />
  );
}

export function VoiceDevicesSheet({ ctx }: { ctx?: SheetCtx }) {
  const t = useMT();
  const { inputs, outputs, cameras } = useDevices();
  const audioInputId = useSessionStore((s) => s.audioInputId);
  const audioOutputId = useSessionStore((s) => s.audioOutputId);
  const videoInputId = useSessionStore((s) => s.videoInputId);
  const cameraAllowed = useSessionStore((s) => s.cameraAllowed);
  const setAudioInput = useSessionStore((s) => s.setAudioInput);
  const setAudioOutput = useSessionStore((s) => s.setAudioOutput);
  const setVideoInput = useSessionStore((s) => s.setVideoInput);

  const pickOutputs = supportsOutputSelection() && outputs.length > 0;
  const curIn = currentOf(inputs, audioInputId, 'audioinput');
  const curOut = currentOf(outputs, audioOutputId, 'audiooutput');
  const curCam = currentOf(cameras, videoInputId, 'videoinput');

  return (
    <SheetScreen
      title={t('voice.devices')}
      trailing={<BarTextButton onPress={() => void ctx?.dismiss()}>{t('common.close')}</BarTextButton>}
    >
      <InsetGroupedList>
        <ListSection header={t('voice.output')}>
          {pickOutputs ? (
            outputs.map((d) => (
              <DeviceRow
                key={d.id}
                dev={d}
                icon={/airpods|bluetooth|buds|\bbt\b/i.test(d.label) ? 'airpodspro' : /headset|headphone|наушник|гарнитур/i.test(d.label) ? 'headphones' : 'speaker.wave.2.fill'}
                current={d.id === curOut}
                onPick={() => setAudioOutput(d.id)}
              />
            ))
          ) : (
            <ValueRow title={t('voice.outputRoute')} value={t('audio.default')} valueColor="var(--text-muted)" chevronStyle="none" />
          )}
        </ListSection>
        <ListSection header={t('voice.input')}>
          {inputs.length === 0 ? (
            <Row title={t('voice.noInputs')} titleColor="var(--text-muted)" />
          ) : (
            inputs.map((d) => (
              <DeviceRow key={d.id} dev={d} icon={audioIcon(d.label)} current={d.id === curIn} onPick={() => setAudioInput(d.id)} />
            ))
          )}
        </ListSection>
        {cameraAllowed && cameras.length > 0 && (
          <ListSection header={t('voice.cameraSection')}>
            {cameras.map((d) => (
              <DeviceRow key={d.id} dev={d} icon="video" current={d.id === curCam} onPick={() => setVideoInput(d.id)} />
            ))}
          </ListSection>
        )}
      </InsetGroupedList>
    </SheetScreen>
  );
}

/** Gear in the room header. */
export function openVoiceDevicesSheet(): void {
  presentVoiceSheet((ctx) => <VoiceDevicesSheet ctx={ctx} />, { detents: ['medium', 'large'] });
}
