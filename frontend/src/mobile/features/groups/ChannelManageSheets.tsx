// iOS ChannelManageViews.swift: ChannelCreateSheet, ChannelColorSheet, ChannelCleanupSheet.
// All three are large sheets with their own inline nav bar and a `ScrollView { VStack }.padding(20)` body.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { groupsApi } from '../../../api/groups';
import { messagesApi } from '../../../api/messages';
import type { Chat, Group } from '../../../types';
import { SheetScreen } from '../../nav/Screen';
import { BarTextButton } from '../../nav/BarButton';
import { present, type SheetCtx } from '../../present/PresentationProvider';
import { CordButton, CordField, SegmentedControl, Stepper } from '../../ui';
import { useMT } from '../../i18n';
import { ChannelColorPicker } from './ChannelColorPicker';
import { trimSpaces, userMessage } from './data';
import './groups.css';

const blurActive = () => (document.activeElement as HTMLElement | null)?.blur?.();

// ───────────────────────────── create ─────────────────────────────

export interface ChannelCreateSheetProps extends SheetCtx {
  group: Group;
  /** Reload the channel list (awaited before the sheet closes, like iOS `onDone`). */
  onDone: () => Promise<unknown>;
}

export function ChannelCreateSheet({ group, onDone, dismiss }: ChannelCreateSheetProps) {
  const t = useMT();
  const [name, setName] = useState('');
  const [type, setType] = useState<'text' | 'voice'>('text');
  const [color, setColor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const trimmed = trimSpaces(name);

  const create = async () => {
    if (busy || !trimmed) return;
    setBusy(true);
    setErrorText(null);
    try {
      await groupsApi.createChat(group.id, trimmed, group.is_personal ? 'text' : type, color);
      await onDone();
      setBusy(false);
      void dismiss();
    } catch (e) {
      setErrorText(userMessage(e, t('channels.createFailed')));
      setBusy(false);
    }
  };

  return (
    <SheetScreen
      title={t('channels.newTitle')}
      leading={<BarTextButton onPress={() => void dismiss()}>{t('pollComposer.cancel')}</BarTextButton>}
      trailing={
        <BarTextButton prominent disabled={busy || !trimmed} onPress={() => void create()}>
          {t('channels.create')}
        </BarTextButton>
      }
    >
      <div className="m-grp-form" style={{ gap: 18 }}>
        <CordField
          label={t('channels.namePlaceholder')}
          placeholder={t('channels.namePlaceholder')}
          value={name}
          onChange={setName}
          maxLength={50}
          enterKeyHint="done"
          onSubmit={blurActive}
        />
        {!group.is_personal && (
          <SegmentedControl<'text' | 'voice'>
            ariaLabel={t('channels.type')}
            value={type}
            onChange={setType}
            options={[
              { value: 'text', label: t('channels.typeText') },
              { value: 'voice', label: t('channels.typeVoice') },
            ]}
          />
        )}
        <ChannelColorPicker value={color} onChange={setColor} />
        {errorText && <div className="m-grp-error">{errorText}</div>}
      </div>
    </SheetScreen>
  );
}

// ───────────────────────────── recolor ─────────────────────────────

export interface ChannelColorSheetProps extends SheetCtx {
  group: Group;
  chat: Chat;
  onDone: () => Promise<unknown>;
}

export function ChannelColorSheet({ group, chat, onDone, dismiss }: ChannelColorSheetProps) {
  const t = useMT();
  const [color, setColor] = useState<string | null>(chat.color ?? null);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setErrorText(null);
    try {
      // explicit JSON null clears the colour (iOS ChatPatchRequest.ColorEdit.clear)
      await groupsApi.updateChat(group.id, chat.id, { color: color ?? null });
      await onDone();
      setBusy(false);
      void dismiss();
    } catch (e) {
      setErrorText(userMessage(e, t('channels.colorFailed')));
      setBusy(false);
    }
  };

  return (
    <SheetScreen
      title={chat.name}
      leading={<BarTextButton onPress={() => void dismiss()}>{t('pollComposer.cancel')}</BarTextButton>}
      trailing={
        <BarTextButton prominent disabled={busy} onPress={() => void save()}>
          {t('common.save')}
        </BarTextButton>
      }
    >
      <div className="m-grp-form" style={{ gap: 18 }}>
        <ChannelColorPicker value={color} onChange={setColor} />
        {errorText && <div className="m-grp-error">{errorText}</div>}
      </div>
    </SheetScreen>
  );
}

// ───────────────────────────── cleanup ─────────────────────────────

export interface ChannelCleanupSheetProps extends SheetCtx {
  chat: Chat;
}

export function ChannelCleanupSheet({ chat, dismiss }: ChannelCleanupSheetProps) {
  const t = useMT();
  const qc = useQueryClient();
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  // iOS quirk kept: `deleted` is not reset by a new run, so an old result can sit above a new error.
  const [deleted, setDeleted] = useState<number | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const cleanup = async (d: number) => {
    if (busy) return;
    setBusy(true);
    setErrorText(null);
    try {
      const resp = await messagesApi.cleanup(chat.id, d);
      setDeleted(resp.deleted);
      void qc.invalidateQueries({ queryKey: ['messages', chat.id] });
    } catch (e) {
      setErrorText(userMessage(e, t('channels.cleanupFailed')));
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    const d = days;
    present.alert({
      title: t('channels.cleanup'),
      message: t('channels.cleanupConfirm', d),
      actions: [
        { label: t('channels.cleanupAction'), role: 'destructive', onPress: () => void cleanup(d) },
        { label: t('pollComposer.cancel'), role: 'cancel' },
      ],
    });
  };

  return (
    <SheetScreen
      title={t('channels.cleanup')}
      trailing={
        <BarTextButton prominent onPress={() => void dismiss()}>
          {t('common.close')}
        </BarTextButton>
      }
    >
      <div className="m-grp-form" style={{ gap: 16 }}>
        <div className="m-grp-hint">{t('channels.cleanupHint')}</div>
        <div className="m-grp-stepper-row">
          <span className="m-grp-stepper-label">{t('channels.cleanupOlderThan', days)}</span>
          <Stepper value={days} onChange={setDays} min={1} max={3650} step={1} ariaLabel={t('channels.cleanupOlderThan', days)} />
        </div>
        <CordButton busy={busy} onPress={confirm}>
          {t('channels.cleanupAction')}
        </CordButton>
        {deleted != null && <div className="m-grp-note">{t('channels.cleanupDeleted', deleted)}</div>}
        {errorText && <div className="m-grp-error">{errorText}</div>}
      </div>
    </SheetScreen>
  );
}
