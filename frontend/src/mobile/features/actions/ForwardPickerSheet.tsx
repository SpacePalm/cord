// Forward destination picker (ForwardPickerView.swift).
// Large sheet, own inline bar "Переслать в…" with a leading "Закрыть"; plain list: "Каналы" (text channels of
// every server + the Saved group) and "Личные сообщения" (DMs, most recent first); iOS 26 `.searchable` bottom
// capsule. One tap forwards immediately (1 id → /forward, >1 → /forward/bulk), HUD while sending, error row on
// failure (retry by tapping again), success → onForwarded() then dismiss.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Chat, Group, Message } from '../../../types';
import { groupsApi } from '../../../api/groups';
import { dmsApi, type DMItem } from '../../../api/dms';
import { messagesApi } from '../../../api/messages';
import { present, type SheetCtx } from '../../present/PresentationProvider';
import { SheetScreen } from '../../nav/Screen';
import { BarTextButton } from '../../nav/BarButton';
import { ErrorRow, HUD, Icon, ListSection, PlainList, Row, SearchCapsule, Spinner, type SFSymbol } from '../../ui';
import { useMT } from '../../i18n';
import { apiErrorText, containsCI } from './shared';
import './actions.css';

export interface ForwardPickerSheetProps extends SheetCtx {
  messages: Message[];
  /** Called after a successful forward (chat exits selection mode). */
  onForwarded?: () => void;
}

interface ChannelItem {
  chat: Chat;
  group: Group;
}

/** Text channels of every server (groups order, chats in API order) followed by the Saved group's. */
async function loadChannels(groups: Group[], fetchChats: (g: Group) => Promise<Chat[]>): Promise<ChannelItem[]> {
  const sources = groups.filter((g) => !g.is_dm && !g.is_personal);
  const saved = groups.find((g) => g.is_personal);
  if (saved) sources.push(saved);
  // iOS fetches sequentially; parallel keeps the same order and is faster. Failing groups are omitted (try?).
  const lists = await Promise.all(sources.map((g) => fetchChats(g).catch(() => null)));
  const out: ChannelItem[] = [];
  lists.forEach((chats, i) => {
    if (!chats) return;
    for (const chat of chats) if (chat.type === 'text') out.push({ chat, group: sources[i] });
  });
  return out;
}

export function ForwardPickerSheet({ messages, onForwarded, dismiss }: ForwardPickerSheetProps) {
  const t = useMT();
  const qc = useQueryClient();
  const [channels, setChannels] = useState<ChannelItem[] | null>(null);
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const sendingRef = useRef(false);
  const live = useRef({ onForwarded, dismiss });
  live.current = { onForwarded, dismiss };

  // groups / DMs come from the app caches (iOS env.groups); refreshed in the background
  const groupsQ = useQuery({ queryKey: ['groups'], queryFn: groupsApi.list, staleTime: 30_000 });
  const dmsQ = useQuery({ queryKey: ['dms'], queryFn: dmsApi.list, staleTime: 30_000 });

  // chronological feed order (iOS sends an unordered Set)
  const sourceIds = useMemo(
    () =>
      [...messages]
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .map((m) => m.id),
    [messages],
  );

  // channel lists are re-fetched on every presentation (`.task { await loadChannels() }`)
  const started = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const groupsReady = groupsQ.data !== undefined || groupsQ.isError;
  useEffect(() => {
    if (started.current || !groupsReady) return;
    started.current = true;
    void loadChannels(groupsQ.data ?? [], (g) =>
      qc.fetchQuery({ queryKey: ['chats', g.id], queryFn: () => groupsApi.listChats(g.id), staleTime: 0 }),
    ).then((out) => {
      if (alive.current) setChannels(out);
    });
  }, [groupsReady, groupsQ.data, qc]);

  const loading = channels === null;
  const dms: DMItem[] = dmsQ.data ?? [];
  const q = search;
  const matchingChannels = (channels ?? []).filter(
    (c) => !q || containsCI(c.chat.name, q) || containsCI(c.group.name, q),
  );
  const matchingDMs = dms.filter((d) => !q || containsCI(d.peer.display_name || d.peer.username, q));

  const forward = (targetChatId: string) => {
    if (sendingRef.current || sourceIds.length === 0) return;
    sendingRef.current = true;
    setSending(true);
    setErrorText(null);
    const req =
      sourceIds.length === 1
        ? messagesApi.forward(targetChatId, sourceIds[0]).then(() => undefined)
        : messagesApi.forwardBulk(targetChatId, sourceIds).then(() => undefined);
    req.then(
      () => {
        void qc.invalidateQueries({ queryKey: ['messages', targetChatId] });
        // the request is not cancelled when the sheet was closed meanwhile: onForwarded still runs (iOS)
        live.current.onForwarded?.();
        void live.current.dismiss();
      },
      (e: unknown) => {
        sendingRef.current = false;
        setSending(false);
        setErrorText(apiErrorText(e, t('forward.failed')));
      },
    );
  };

  const row = (key: string, icon: SFSymbol, title: string, subtitle: string | null, chatId: string) => (
    <Row
      key={key}
      leading={
        <span className="m-act-fwd-icon" aria-hidden>
          <Icon name={icon} size={icon === 'number' ? 22 : 24} />
        </span>
      }
      leadingGap={10}
      title={title}
      titleLines={1}
      subtitle={subtitle ?? undefined}
      subtitleLines={1}
      onPress={() => forward(chatId)}
    />
  );

  return (
    <SheetScreen
      title={t('forward.title')}
      leading={<BarTextButton onPress={() => void dismiss()}>{t('common.close')}</BarTextButton>}
      scroll={false}
    >
      <div className="m-act-fill">
        {loading ? (
          <div className="m-act-center">
            <Spinner />
          </div>
        ) : (
          <div className={'m-act-scroll no-bottom' + (sending ? ' is-disabled' : '')} aria-busy={sending || undefined}>
            <PlainList>
              {errorText && <ErrorRow text={errorText} />}
              {matchingChannels.length > 0 && (
                <ListSection header={t('palette.channels')}>
                  {matchingChannels.map((c) =>
                    row(c.chat.id, 'number', c.chat.name, c.group.is_personal ? t('main.saved') : c.group.name, c.chat.id),
                  )}
                </ListSection>
              )}
              {matchingDMs.length > 0 && (
                <ListSection header={t('main.directMessages')}>
                  {matchingDMs.map((d) =>
                    row(`dm-${d.chat_id}`, 'person.crop.circle.fill', d.peer.display_name || d.peer.username, null, d.chat_id),
                  )}
                </ListSection>
              )}
            </PlainList>
            <SearchCapsule value={search} onChange={setSearch} placeholder={t('forward.searchPlaceholder')} />
          </div>
        )}
        {sending && <HUD />}
      </div>
    </SheetScreen>
  );
}

/** Presents the forward picker for `messages` (context-menu "Переслать" or the selection bar). */
export function openForwardPicker(messages: Message[], onForwarded?: () => void): SheetCtx {
  return present.presentSheet((ctx) => <ForwardPickerSheet {...ctx} messages={messages} onForwarded={onForwarded} />);
}
