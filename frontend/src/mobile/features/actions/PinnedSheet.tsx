// Pinned messages sheet (PinnedMessagesView.swift).
// Re-fetched on every presentation (spinner), empty state, plain list rows (tap → jump + dismiss),
// trailing swipe "Открепить" (pin.slash) → unpin, patch the feed copy, reload (spinner again).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Message } from '../../../types';
import { messagesApi } from '../../../api/messages';
import { present, type SheetCtx } from '../../present/PresentationProvider';
import { SheetScreen } from '../../nav/Screen';
import { BarTextButton } from '../../nav/BarButton';
import { PlainList, Row, Spinner, SwipeRow, closeOpenSwipeRow } from '../../ui';
import { useMT, useMobileLocale } from '../../i18n';
import { HitRowBody } from './HitRow';
import './actions.css';

export interface PinnedSheetProps extends SheetCtx {
  chatId: string;
  onJump: (msg: Message) => void;
  /** Optional: a message was unpinned here (lets the chat patch history pages it keeps outside ['messages', chatId]). */
  onMessageUpdated?: (msg: Message) => void;
}

/**
 * Unpin swipe tint. iOS declares `Button(role: .destructive)` without `.tint`; on iOS 26 such swipe pills render
 * in the global tint (accent) — measured on iOS 26 (ChannelListView's identical destructive "trash" pill).
 */
const UNPIN_TINT = 'var(--accent)';

export function PinnedSheet({ chatId, onJump, onMessageUpdated, dismiss }: PinnedSheetProps) {
  const t = useMT();
  const locale = useMobileLocale();
  const qc = useQueryClient();
  const [pinned, setPinned] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const live = useRef({ onMessageUpdated });
  live.current = { onMessageUpdated };

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    let list: Message[] = [];
    try {
      // keeps ['pinned', chatId] (desktop header / other readers) in sync
      list = await qc.fetchQuery({ queryKey: ['pinned', chatId], queryFn: () => messagesApi.pinned(chatId), staleTime: 0 });
    } catch {
      list = []; // failure ⇒ treated as empty (iOS `try?`)
    }
    if (!alive.current) return;
    setPinned(list);
    setLoading(false);
  }, [chatId, qc]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const unpin = async (msg: Message) => {
    try {
      const updated = await messagesApi.unpin(chatId, msg.id);
      // replace the feed copy (no-op when it is not loaded)
      qc.setQueryData<Message[]>(['messages', chatId], (old) => (old ? old.map((m) => (m.id === updated.id ? updated : m)) : old));
      qc.setQueryData<Message[]>(['pinned', chatId], (old) => (old ? old.filter((m) => m.id !== updated.id) : old));
      live.current.onMessageUpdated?.(updated);
    } catch {
      /* silent (ChatStore.unpin) */
    }
    if (alive.current) await reload();
  };

  const jump = (msg: Message) => {
    closeOpenSwipeRow();
    onJump(msg);
    void dismiss();
  };

  return (
    <SheetScreen
      title={t('chat.pinned')}
      trailing={
        <BarTextButton prominent onPress={() => void dismiss()}>
          {t('common.close')}
        </BarTextButton>
      }
      scroll={false}
    >
      <div className="m-act-fill">
        {loading ? (
          <div className="m-act-center">
            <Spinner />
          </div>
        ) : pinned.length === 0 ? (
          <div className="m-act-center">
            <div className="m-act-muted">{t('chat.noPinned')}</div>
          </div>
        ) : (
          <div className="m-act-scroll">
            <PlainList>
              {pinned.map((msg) => (
                <SwipeRow
                  key={msg.id}
                  actions={[{ icon: 'pin.slash', label: t('chat.unpin'), tint: UNPIN_TINT, onPress: () => void unpin(msg) }]}
                >
                  <Row onPress={() => jump(msg)}>
                    <HitRowBody msg={msg} locale={locale} attachmentsText={`📎 ${msg.attachments.length}`} />
                  </Row>
                </SwipeRow>
              ))}
            </PlainList>
          </div>
        )}
      </div>
    </SheetScreen>
  );
}

/** Presents the pinned sheet ("•••" → "Закреплённые"). */
export function openPinned(chatId: string, onJump: (msg: Message) => void, onMessageUpdated?: (msg: Message) => void): SheetCtx {
  return present.presentSheet((ctx) => (
    <PinnedSheet {...ctx} chatId={chatId} onJump={onJump} onMessageUpdated={onMessageUpdated} />
  ));
}
