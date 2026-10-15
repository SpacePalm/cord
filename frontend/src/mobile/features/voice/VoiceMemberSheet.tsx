// iOS `VoiceMemberSheet` (.height(300)): "Open chat", "Mute for me" switch, 0–300 % volume.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { dmsApi } from '../../../api/dms';
import { mobileNav } from '../../nav/NavStack';
import { useMT } from '../../i18n';
import { Avatar } from '../../ui/Avatar';
import { Icon } from '../../ui/Icon';
import { Slider } from '../../ui/Slider';
import { Switch } from '../../ui/Switch';
import { SheetScreen } from '../../nav/Screen';
import type { SheetCtx } from '../../present/PresentationProvider';
import { setShowRoom, setUserVolume, toggleUserMute, useVoiceStore, volumeOf } from './voiceStore';
import { presentVoiceSheet } from './voicePresent';
import './voice.css';

export interface VoiceMemberSheetProps {
  identity: string;
  name: string;
  imagePath: string;
  ctx?: SheetCtx;
}

export function VoiceMemberSheet({ identity, name: initialName, imagePath: initialImage, ctx }: VoiceMemberSheetProps) {
  const t = useMT();
  const qc = useQueryClient();
  const live = useVoiceStore((s) => s.members.find((m) => m.id === identity));
  const name = live?.name ?? initialName;
  const imagePath = live?.imagePath ?? initialImage;
  const muted = useVoiceStore((s) => !!s.mutedUsers[identity]);
  // the label shows the sheet's own (step-snapped) value, seeded from the store on appear
  const [volume, setVolume] = useState(() => volumeOf(identity));
  const [busy, setBusy] = useState(false);

  const openChat = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const dm = await dmsApi.openWith(identity);
      if (dm.is_new) void qc.invalidateQueries({ queryKey: ['dms'] });
      setShowRoom(false);
      void ctx?.dismiss();
      mobileNav.navigate({ name: 'chat', chatId: dm.chat_id, title: dm.peer.display_name || dm.peer.username, groupId: dm.group_id });
    } catch {
      /* iOS: silently nothing */
    } finally {
      setBusy(false);
    }
  };

  return (
    <SheetScreen noBar scroll={false}>
    <div className="m-voice-member">
      <div className="m-voice-member-head">
        <Avatar src={imagePath || null} name={name} size={40} />
        <span className="ios-t-headline ios-truncate" style={{ color: 'var(--text-primary)' }}>
          {name}
        </span>
      </div>
      <button type="button" className="m-voice-member-open ios-t-subheadline" onClick={() => void openChat()}>
        <Icon name="message" size={20} />
        <span>{t('voice.openChat')}</span>
      </button>
      <hr className="ios-divider" />
      <div className="m-voice-member-toggle" onClick={() => toggleUserMute(identity)}>
        <span className="ios-t-body">{t('voice.muteForMe')}</span>
        <Switch checked={muted} onChange={() => toggleUserMute(identity)} ariaLabel={t('voice.muteForMe')} />
      </div>
      <div className="m-voice-member-vol">
        <div className="m-voice-member-vol-row ios-t-subheadline">
          <span style={{ color: 'var(--text-secondary)' }}>{t('voice.volume')}</span>
          <span className="ios-tabular" style={{ color: 'var(--text-muted)' }}>
            {Math.round(volume * 100)}%
          </span>
        </div>
        <Slider
          value={volume}
          min={0}
          max={3}
          step={0.05}
          disabled={muted}
          ariaLabel={t('voice.volume')}
          onChange={(v) => {
            setVolume(v);
            setUserVolume(identity, v);
          }}
        />
      </div>
    </div>
    </SheetScreen>
  );
}

/** Tap / long-press a remote tile or its "•••". */
export function openVoiceMemberSheet(m: { id: string; name: string; imagePath: string }): void {
  presentVoiceSheet((ctx) => <VoiceMemberSheet identity={m.id} name={m.name} imagePath={m.imagePath} ctx={ctx} />, {
    detents: [{ height: 300 }],
  });
}
