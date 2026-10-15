// Server screen — iOS ChannelListView: large title (live server name / "Сохранённое"),
// trailing gear (any member of a non-personal group) + "+" (canManageChannels), one inset section of
// channels in API order (no Text/Voice headers), text rows push the chat, voice rows join directly,
// trailing swipe actions [Cleanup][Color][Rename][Delete], pull-to-refresh, centred spinner while
// loading an empty list, error as the last row.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { groupsApi } from '../../../api/groups';
import { voiceApi, type VoiceParticipantInfo } from '../../../api/voice';
import { useUnreadCounts } from '../../../hooks/useUnreadCounts';
import { useSessionStore } from '../../../store/sessionStore';
import type { Chat, Group } from '../../../types';
import { Screen } from '../../nav/Screen';
import { BarButton, BarGroup } from '../../nav/BarButton';
import { useNav, useScreenCtx } from '../../nav/NavStack';
import { present } from '../../present/PresentationProvider';
import {
  Avatar,
  ErrorRow,
  Icon,
  InsetGroupedList,
  ListSection,
  Row,
  Spinner,
  SwipeRow,
  closeOpenSwipeRow,
  prefixGraphemes,
  usePressHighlight,
  type SwipeAction,
} from '../../ui';
import { useMT } from '../../i18n';
import { joinVoiceChannel } from '../voice/voiceActions';
import { apiDetail, channelTint, trimSpaces, useGroup, useGroupMembers, useGroupPermissions, useGroupsQuery, userMessage } from './data';
import { ChannelCleanupSheet, ChannelColorSheet, ChannelCreateSheet } from './ChannelManageSheets';
import { GroupSettingsSheet } from './GroupSettingsSheet';
import { useRegisterQueryClient } from './queryClientRef';
import './groups.css';

export interface ChannelListScreenProps {
  groupId: string;
}

// ───────────────────────────── rows ─────────────────────────────

function TextChannelRow({ chat, unread, onOpen }: { chat: Chat; unread: number; onOpen: () => void }) {
  return (
    <Row
      icon="number"
      iconColor={channelTint(chat.color) ?? 'var(--text-muted)'}
      title={chat.name}
      titleStyle={unread > 0 ? { fontWeight: 600 } : undefined}
      chevron
      badge={unread}
      badgePosition="after"
      onPress={onOpen}
    />
  );
}

function useVoiceParticipants(channelId: string): { active: boolean; people: VoiceParticipantInfo[] } {
  // For the channel I'm in → the live local list; others → GET /voice/participants (WS-fed cache).
  const active = useSessionStore((s) => s.voicePresence?.channelId === channelId);
  const local = useSessionStore((s) => s.voiceParticipants);
  const { data } = useQuery<VoiceParticipantInfo[]>({
    queryKey: ['voice-participants', channelId],
    queryFn: () => voiceApi.listParticipants(channelId),
    enabled: !active,
    staleTime: 60_000,
  });
  return { active, people: active ? local : data ?? [] };
}

function VoiceChannelRow({ chat, onJoin }: { chat: Chat; onJoin: () => void }) {
  const { active, people } = useVoiceParticipants(chat.id);
  const press = usePressHighlight(true);
  const iconColor = active ? 'var(--ios-green)' : channelTint(chat.color) ?? 'var(--accent)';
  return (
    <Row separatorInset={56}>
      <div className="m-grp-voice">
        <button
          type="button"
          className={'m-grp-voice-main' + (people.length === 0 ? ' is-alone' : '')}
          onClick={onJoin}
          {...press}
        >
          <span className="ios-row-icon" style={{ color: iconColor }}>
            <Icon name="speaker.wave.2.fill" size={24} />
          </span>
          <span className="m-grp-chan-name">{chat.name}</span>
          {active && (
            <span className="m-grp-voice-wave" aria-hidden>
              <Icon name="waveform" size={14} strokeWidth={2} />
            </span>
          )}
        </button>
        {people.length > 0 && (
          <div className="m-grp-voice-people">
            {people.map((p) => (
              <div key={p.identity} className="m-grp-voice-person">
                <Avatar src={p.image_path || null} name={p.name} size={18} />
                <span className="m-grp-voice-person-name">{p.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Row>
  );
}

// ───────────────────────────── screen ─────────────────────────────

export function ChannelListScreen({ groupId }: ChannelListScreenProps) {
  const t = useMT();
  const nav = useNav();
  const qc = useRegisterQueryClient();
  const { isTop } = useScreenCtx();
  const group = useGroup(groupId);
  const groupsQ = useGroupsQuery();
  const { unreadByChat } = useUnreadCounts();

  // The server vanished from the list (left / deleted here, or kicked / deleted elsewhere): SwiftUI pops a
  // destination whose NavigationLink disappeared — back to the root list.
  const vanished = groupsQ.isSuccess && Array.isArray(groupsQ.data) && !groupsQ.data.some((g) => g.id === groupId);
  const poppedRef = useRef(false);
  useEffect(() => {
    if (!vanished || poppedRef.current) return;
    poppedRef.current = true;
    // not while this screen is merely animating out (the stack may already show something else)
    if (nav.stack.some((r) => r.name === 'channels' && r.groupId === groupId)) nav.popToRoot();
  }, [vanished, nav, groupId]);

  const chatsQ = useQuery<Chat[]>({
    queryKey: ['chats', groupId],
    queryFn: () => groupsApi.listChats(groupId),
    staleTime: 30_000,
    retry: 1,
    refetchOnMount: 'always',
  });
  // myRole — best effort (errors ignored), like iOS
  const membersQ = useGroupMembers(groupId, { refetchOnMount: 'always' });
  const perms = useGroupPermissions(group, membersQ.data);

  const chats = chatsQ.data ?? [];
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const visible = hidden.size ? chats.filter((c) => !hidden.has(c.id)) : chats;
  const textCount = chats.filter((c) => c.type === 'text').length;

  // errorText: load failure (server detail ?? channels.loadFailed) or the last action failure; cleared by
  // the next successful load.
  const [errorText, setErrorText] = useState<string | null>(null);
  useEffect(() => {
    if (chatsQ.isError) setErrorText(apiDetail(chatsQ.error) ?? t('channels.loadFailed'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatsQ.errorUpdatedAt]);
  useEffect(() => {
    if (chatsQ.isSuccess) setErrorText(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatsQ.dataUpdatedAt]);

  const voicePresenceChannel = useSessionStore((s) => s.voicePresence?.channelId ?? null);

  /** iOS load(): chats, voice presence reconcile (not for the channel I'm in), then myRole. */
  const reload = useCallback(async () => {
    const res = await chatsQ.refetch();
    const list = res.data ?? [];
    await Promise.all([
      ...list
        .filter((c) => c.type === 'voice' && c.id !== voicePresenceChannel)
        .map((c) => qc.invalidateQueries({ queryKey: ['voice-participants', c.id] })),
      membersQ.refetch(),
    ]);
  }, [chatsQ, membersQ, qc, voicePresenceChannel]);

  // `.task` re-runs every time the screen re-appears (e.g. popping back from a chat)
  const wasTop = useRef(isTop);
  useEffect(() => {
    if (isTop && !wasTop.current) void reload();
    wasTop.current = isTop;
  }, [isTop, reload]);

  const refetchChats = useCallback(() => qc.invalidateQueries({ queryKey: ['chats', groupId] }), [qc, groupId]);

  // ── actions ──
  const deleteChat = async (chat: Chat) => {
    // SwiftUI animates the row out optimistically; restore it on failure
    setHidden((s) => new Set(s).add(chat.id));
    try {
      await groupsApi.deleteChat(groupId, chat.id);
      await chatsQ.refetch();
    } catch (e) {
      setErrorText(userMessage(e, t('channels.deleteFailed')));
    } finally {
      setHidden((s) => {
        const n = new Set(s);
        n.delete(chat.id);
        return n;
      });
    }
  };

  const rename = async (chat: Chat, text: string) => {
    const trimmed = prefixGraphemes(trimSpaces(text), 50);
    if (!trimmed || trimmed === chat.name) return;
    try {
      await groupsApi.updateChat(groupId, chat.id, { name: trimmed });
      await chatsQ.refetch();
    } catch (e) {
      setErrorText(userMessage(e, t('channels.renameFailed')));
    }
  };

  const openRename = (chat: Chat) => {
    closeOpenSwipeRow();
    present.alert({
      title: t('channels.rename'),
      textField: { placeholder: t('channels.namePlaceholder'), initial: chat.name },
      actions: [
        { label: t('common.save'), onPress: (text) => void rename(chat, text) },
        { label: t('pollComposer.cancel'), role: 'cancel' },
      ],
    });
  };

  const openColor = (g: Group, chat: Chat) => {
    closeOpenSwipeRow();
    present.presentSheet((ctx) => <ChannelColorSheet {...ctx} group={g} chat={chat} onDone={refetchChats} />);
  };

  const openCleanup = (chat: Chat) => {
    closeOpenSwipeRow();
    present.presentSheet((ctx) => <ChannelCleanupSheet {...ctx} chat={chat} />);
  };

  const openCreate = (g: Group) => {
    closeOpenSwipeRow();
    present.presentSheet((ctx) => <ChannelCreateSheet {...ctx} group={g} onDone={refetchChats} />);
  };

  const openSettings = () => {
    closeOpenSwipeRow();
    present.presentSheet((ctx) => <GroupSettingsSheet {...ctx} groupId={groupId} />);
  };

  const swipeActions = (chat: Chat): SwipeAction[] => {
    if (!perms || !group) return [];
    const acts: SwipeAction[] = [];
    if (perms.canManageChannels) {
      const canDelete = !(group.is_personal && chat.type === 'text' && textCount <= 1);
      // iOS 26: role .destructive without a tint renders in the global tint (accent)
      if (canDelete) acts.push({ icon: 'trash', label: t('chat.delete'), onPress: () => void deleteChat(chat) });
      acts.push({ icon: 'pencil', label: t('channels.rename'), tint: 'var(--accent)', onPress: () => openRename(chat) });
      acts.push({ icon: 'paintpalette', label: t('channels.color'), tint: 'var(--ios-purple)', onPress: () => openColor(group, chat) });
    }
    if (perms.isOwner && chat.type === 'text') {
      acts.push({ icon: 'eraser', label: t('channels.cleanup'), tint: 'var(--ios-orange)', onPress: () => openCleanup(chat) });
    }
    return acts;
  };

  const title = group?.is_personal ? t('channels.saved') : group?.name ?? '';

  const gear =
    group && !group.is_personal ? <BarButton icon="gearshape" ariaLabel={t('settings.title')} onPress={openSettings} /> : null;
  const plus =
    group && perms?.canManageChannels ? (
      <BarButton icon="plus" ariaLabel={t('channels.newTitle')} onPress={() => openCreate(group)} />
    ) : null;
  const trailing = gear && plus ? <BarGroup>{gear}{plus}</BarGroup> : gear ?? plus;

  const loadingEmpty = chatsQ.isFetching && chats.length === 0;

  return (
    <Screen title={title} titleMode="large" trailing={trailing} onRefresh={reload}>
      {loadingEmpty && (
        <div className="m-grp-center-spinner">
          <Spinner />
        </div>
      )}
      <InsetGroupedList>
        {(visible.length > 0 || errorText) && (
          <ListSection>
            {visible.map((chat) => (
              <SwipeRow key={chat.id} actions={swipeActions(chat)} fullSwipe={false}>
                {chat.type === 'voice' ? (
                  <VoiceChannelRow
                    chat={chat}
                    onJoin={() =>
                      joinVoiceChannel({
                        channelId: chat.id,
                        channelName: chat.name,
                        groupId,
                        groupName: group?.name ?? '',
                      })
                    }
                  />
                ) : (
                  <TextChannelRow
                    chat={chat}
                    unread={unreadByChat[chat.id] ?? 0}
                    onOpen={() => nav.push({ name: 'chat', chatId: chat.id, title: chat.name, groupId })}
                  />
                )}
              </SwipeRow>
            ))}
            {errorText && <ErrorRow text={errorText} />}
          </ListSection>
        )}
      </InsetGroupedList>
    </Screen>
  );
}
