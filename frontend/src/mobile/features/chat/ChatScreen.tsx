// Chat screen (iOS MessageListView + MessageListContent).
// Pushed screen, inline title, trailing glass capsule [phone (DM)] [magnifyingglass] [••• menu];
// timeline (useChatTimeline + ChatTimeline), error / typing lines, composer or selection bar,
// long-press context menu, sheets (search / pinned / media / members / forward / poll).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Chat, Group, Member, Message } from '../../../types';
import { dmsApi, type DMItem } from '../../../api/dms';
import { groupsApi } from '../../../api/groups';
import { notificationsApi, type UnreadData } from '../../../api/notifications';
import { useAuthStore } from '../../../store/authStore';
import { useSessionStore } from '../../../store/sessionStore';
import { useNotificationStore } from '../../../store/notificationStore';
import { useTypingUsers } from '../../../hooks/useWebSocket';
import { Screen } from '../../nav/Screen';
import { BackButton, BarButton, BarGroup, BarTextButton } from '../../nav/BarButton';
import { useNav, useScreenCtx } from '../../nav/NavStack';
import { MenuButton } from '../../present/MenuButton';
import { present, primeKeyboard, type MenuItem } from '../../present/PresentationProvider';
import { Icon } from '../../ui/Icon';
import { Spinner } from '../../ui/Spinner';
import { useMT } from '../../i18n';
import { groupPermissions } from '../../lib/groupPermissions';
import { MessageContextMenu } from '../actions/MessageContextMenu';
import { ForwardPickerSheet } from '../actions/ForwardPickerSheet';
import { PinnedSheet } from '../actions/PinnedSheet';
import { ChatSearchSheet } from '../actions/ChatSearchSheet';
import { MediaLinksSheet } from '../actions/MediaLinksSheet';
import { openMembersSheet } from '../groups/MembersSheet';
import { openUserActions } from '../groups/UserActionsMenu';
import { openVoiceRoom, startDmCall } from '../voice/voiceActions';
import { useChatTimeline } from './useChatTimeline';
import { ChatTimeline, type ChatTimelineHandle } from './ChatTimeline';
import { Composer, type ComposeMode, type ComposerHandle } from './Composer';
import { openPollComposer } from './PollComposerSheet';
import { TrashGlyph } from './glyphs';
import './chat.css';

// Exports and props below are used by the registry.
export interface ChatScreenProps {
  chatId: string;
  title: string;
  groupId?: string;
  jumpTo?: { messageId: string; createdAt: string };
}

interface MenuState {
  msg: Message;
  rowRect: DOMRect;
  bounds: DOMRect;
  isPending: boolean;
}

const NEW_MODE: ComposeMode = { kind: 'new' };

/** Which mounted ChatScreen currently owns sessionStore.lastChannelId (see the effect in ChatScreen). */
let openChatSeq = 0;
let openChatOwner = 0;

/** Channel → owning group from the ['chats', groupId] caches. */
function groupFromCaches(qc: QueryClient, chatId: string): { groupId: string; name: string } | undefined {
  for (const [, data] of qc.getQueriesData<Chat[]>({ queryKey: ['chats'] })) {
    const c = Array.isArray(data) ? data.find((x) => x?.id === chatId) : undefined;
    if (c) return { groupId: c.group_id, name: c.name };
  }
  return undefined;
}

/**
 * Resolve the owning group of a channel opened without one (quick switcher / search / banner) so
 * @mentions, Members and owner-delete work there too (deliberately fixes the iOS quick-route gap).
 */
function useChannelGroup(chatId: string, given: string | undefined, skip: boolean): { groupId?: string; name?: string } {
  const qc = useQueryClient();
  const [found, setFound] = useState<{ groupId: string; name: string } | undefined>(() => groupFromCaches(qc, chatId));
  useEffect(() => {
    if (skip) return;
    const cached = groupFromCaches(qc, chatId);
    if (cached) {
      setFound(cached);
      return;
    }
    if (given) return;
    let cancelled = false;
    void (async () => {
      try {
        const groups = await qc.fetchQuery<Group[]>({ queryKey: ['groups'], queryFn: groupsApi.list, staleTime: 60_000 });
        for (const g of groups) {
          if (cancelled) return;
          if (g.is_dm) continue;
          const chats = await qc.fetchQuery<Chat[]>({
            queryKey: ['chats', g.id],
            queryFn: () => groupsApi.listChats(g.id),
            staleTime: 60_000,
          });
          const c = chats.find((x) => x.id === chatId);
          if (c) {
            if (!cancelled) setFound({ groupId: g.id, name: c.name });
            return;
          }
        }
      } catch {
        // no group → behaves like iOS quick-route (no mentions / members)
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [qc, chatId, given, skip]);
  return { groupId: given ?? found?.groupId, name: found?.name };
}

function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
      return;
    }
  } catch {
    /* fall through */
  }
  fallbackCopy(text);
}

function fallbackCopy(text: string) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } catch {
    /* ignore */
  }
  ta.remove();
}

/** iOS MessageListView: timeline + composer + toolbar (phone / search / ••• menu). */
export function ChatScreen({ chatId, title, groupId, jumpTo }: ChatScreenProps) {
  const t = useMT();
  const qc = useQueryClient();
  const nav = useNav();
  const screen = useScreenCtx();
  const me = useAuthStore((s) => s.user);
  const isTop = screen.isTop;

  // ── DM / channel context ──
  const dmsQuery = useQuery<DMItem[]>({ queryKey: ['dms'], queryFn: dmsApi.list });
  const dm = dmsQuery.data?.find((d) => d.chat_id === chatId);
  const isDm = !!dm;
  const dmsSettled = dmsQuery.isSuccess || dmsQuery.isError;
  const channel = useChannelGroup(chatId, isDm ? undefined : groupId, isDm || (!groupId && !dmsSettled));
  const gid = isDm ? undefined : channel.groupId;

  const groupsQuery = useQuery<Group[]>({ queryKey: ['groups'], queryFn: groupsApi.list, enabled: !!gid });
  const group = gid ? groupsQuery.data?.find((g) => g.id === gid) : undefined;
  const membersQuery = useQuery<Member[]>({
    queryKey: ['group-members', gid],
    queryFn: () => groupsApi.getMembers(gid!),
    enabled: !!gid,
  });
  const myRole = membersQuery.data?.find((m) => m.user_id === me?.id)?.role;
  // owner / global admin may delete others' messages (editor does not — iOS GroupPermissions.isOwner)
  const canDeleteOthers = group ? groupPermissions(group, me, myRole).isOwner : me?.role === 'admin';

  const displayTitle = title || channel.name || dm?.peer.display_name || '';
  const muted = useNotificationStore((s) => !!s.mutedChats[chatId]);

  // ── read state ──
  const markRead = useCallback(() => {
    qc.setQueryData<UnreadData>(['unread'], (old) => {
      if (!old?.unread?.[chatId]) return old;
      const rest = { ...old.unread };
      delete rest[chatId];
      return { ...old, unread: rest };
    });
    notificationsApi
      .markRead(chatId)
      .then(() => {
        void qc.invalidateQueries({ queryKey: ['unread'] });
        void qc.invalidateQueries({ queryKey: ['dms'] });
      })
      .catch(() => undefined);
  }, [qc, chatId]);

  const tl = useChatTimeline(chatId, { onSent: markRead });

  // "the open chat" for MessageNotifier / unread increments: set while this screen is the top one,
  // cleared when it is covered / popped — but only by the instance that set it (the same chat can be
  // stacked twice, e.g. quick route on top of the channel list route).
  const ownerToken = useRef(0);
  if (!ownerToken.current) ownerToken.current = ++openChatSeq;
  useEffect(() => {
    const s = useSessionStore.getState();
    const me = ownerToken.current;
    if (isTop) {
      openChatOwner = me;
      s.setLastChannel(chatId);
      return;
    }
    if (openChatOwner === me) {
      openChatOwner = 0;
      if (s.lastChannelId === chatId) s.setLastChannel(null);
    }
  }, [isTop, chatId]);
  useEffect(
    () => () => {
      if (openChatOwner !== ownerToken.current) return;
      openChatOwner = 0;
      const s = useSessionStore.getState();
      if (s.lastChannelId === chatId) s.setLastChannel(null);
    },
    [chatId],
  );

  // mark read on open / re-appearance, and when new messages land while the chat is visible
  const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';
  useEffect(() => {
    if (tl.ready && isTop) markRead();
  }, [tl.ready, isTop, markRead]);
  const lastIncoming = useMemo(() => {
    for (let i = tl.messages.length - 1; i >= 0; i--) {
      const m = tl.messages[i];
      if (m.author_id !== me?.id) return m.id;
    }
    return null;
  }, [tl.messages, me?.id]);
  // undefined = not captured yet (the open-time markRead covers what is there); null = no incoming message
  // so far — the FIRST one arriving in such a chat must still be marked read
  const lastSeenIncoming = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!tl.ready) return;
    const prev = lastSeenIncoming.current;
    lastSeenIncoming.current = lastIncoming;
    if (prev === undefined || prev === lastIncoming || !lastIncoming || tl.hasMoreNewer) return;
    if (!isTop || !visible()) return;
    const id = window.setTimeout(markRead, 600);
    return () => window.clearTimeout(id);
  }, [lastIncoming, tl.ready, tl.hasMoreNewer, isTop, markRead]);
  useEffect(() => {
    const onVis = () => {
      if (visible() && isTop && tl.ready) markRead();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [isTop, tl.ready, markRead]);

  // route jump (global search / notifications / pinned from elsewhere)
  const jumpHandled = useRef(false);
  const { jumpTo: tlJumpTo, ready } = tl;
  useEffect(() => {
    if (!jumpTo || jumpHandled.current || !ready) return;
    jumpHandled.current = true;
    void tlJumpTo({ id: jumpTo.messageId, createdAt: jumpTo.createdAt });
  }, [jumpTo, ready, tlJumpTo]);

  const onJumpMsg = useCallback(
    (msg: Message) => void tlJumpTo({ id: msg.id, createdAt: msg.created_at, msg }),
    [tlJumpTo],
  );

  // ── compose mode ──
  const [mode, setMode] = useState<ComposeMode>(NEW_MODE);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const timelineRef = useRef<ChatTimelineHandle>(null);
  useEffect(
    () => () => {
      // the edit text is not a real draft (iOS loses all composer state on pop)
      if (modeRef.current.kind === 'edit') useSessionStore.getState().clearDraft(chatId);
    },
    [chatId],
  );

  const focusInput = () => {
    try {
      inputRef.current?.focus({ preventScroll: true });
    } catch {
      inputRef.current?.focus();
    }
  };
  const startReply = (msg: Message) => {
    setMode({ kind: 'reply', id: msg.id, author: msg.author_display_name, preview: msg.content ?? t('chat.attachment') });
    focusInput();
  };
  const startEdit = (msg: Message) => {
    composerRef.current?.setDraft(msg.content ?? '');
    setMode({ kind: 'edit', id: msg.id });
    focusInput();
  };
  const submit = (text: string, files: File[], m: ComposeMode) => {
    setMode(NEW_MODE);
    if (m.kind === 'edit') void tl.edit(m.id, text);
    else void tl.send(text, files, m.kind === 'reply' ? m.id : undefined);
  };
  const sendVoice = (file: File, m: ComposeMode) => {
    setMode(NEW_MODE);
    void tl.send('', [file], m.kind === 'reply' ? m.id : undefined);
  };

  // ── selection mode ──
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const pendingSelect = useRef<string | null>(null);
  useEffect(() => {
    // ids deleted by WS / clear drop out of the selection
    setSelectedIds((prev) => {
      if (!prev.size) return prev;
      const ids = new Set(tl.messages.map((m) => m.id));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => (ids.has(id) ? next.add(id) : (changed = true)));
      return changed ? next : prev;
    });
  }, [tl.messages]);
  const selectableCount = tl.messages.length;
  const allSelected = selectableCount > 0 && selectedIds.size === selectableCount;
  const exitSelection = useCallback(() => {
    setSelecting(false);
    setSelectedIds(new Set());
  }, []);
  const toggleSelect = useCallback((msg: Message) => {
    if (msg.id.startsWith('local-')) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(msg.id)) next.delete(msg.id);
      else next.add(msg.id);
      return next;
    });
  }, []);
  const selectedMessages = () => tl.messages.filter((m) => selectedIds.has(m.id));
  const allDeletable = canDeleteOthers || selectedMessages().every((m) => m.author_id === me?.id);

  const presentForward = (messages: Message[], onForwarded?: () => void) => {
    present.presentSheet((ctx) => <ForwardPickerSheet {...ctx} messages={messages} onForwarded={onForwarded} />);
  };
  const bulkForward = () => {
    const msgs = selectedMessages();
    if (msgs.length) presentForward(msgs, exitSelection);
  };
  const bulkDelete = () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    present.alert({
      title: t('chat.deleteConfirm', String(ids.length)),
      actions: [
        { label: t('common.cancel'), role: 'cancel' },
        {
          label: t('chat.delete'),
          role: 'destructive',
          onPress: () => {
            void tl.bulkDelete(ids).then((ok) => {
              if (ok) exitSelection();
            });
          },
        },
      ],
    });
  };

  // ── long-press context menu ──
  const [menu, setMenu] = useState<MenuState | null>(null);
  // the pressed message left the feed while the menu is up (WS delete / clear / its optimistic row resolved)
  const menuGone = !!menu && (menu.isPending ? !tl.pending.some((p) => p.localId === menu.msg.id) : !tl.messages.some((m) => m.id === menu.msg.id));
  const fillRef = useRef<HTMLDivElement>(null);
  const bottomInnerRef = useRef<HTMLDivElement>(null);
  const contentBounds = (): DOMRect => {
    const screenEl = fillRef.current?.closest('.ios-screen') as HTMLElement | null;
    const sRect = screenEl?.getBoundingClientRect();
    const bar = screenEl?.querySelector<HTMLElement>(':scope > .ios-nav-bar');
    const top = bar ? bar.getBoundingClientRect().bottom : sRect?.top ?? 0;
    const bottom = bottomInnerRef.current ? bottomInnerRef.current.getBoundingClientRect().bottom : sRect?.bottom ?? window.innerHeight;
    const left = sRect?.left ?? 0;
    const width = sRect?.width ?? window.innerWidth;
    return new DOMRect(left, top, width, Math.max(0, bottom - top));
  };
  const openMenu = (msg: Message, rowEl: HTMLElement) => {
    if (selecting) return;
    setMenu({ msg, rowRect: rowEl.getBoundingClientRect(), bounds: contentBounds(), isPending: msg.id.startsWith('local-') });
  };

  // ── nav bar ──
  const openSearch = () => {
    primeKeyboard();
    present.presentSheet((ctx) => <ChatSearchSheet {...ctx} chatId={chatId} onJump={onJumpMsg} />);
  };
  const callPeer = () => {
    if (!dm) return;
    if (useSessionStore.getState().voicePresence?.groupId === dm.group_id) openVoiceRoom();
    else startDmCall({ groupId: dm.group_id, peerName: dm.peer.display_name, peerImagePath: dm.peer.image_path });
  };
  const menuItems = (): MenuItem[] => {
    const items: MenuItem[] = [];
    if (gid) items.push({ label: t('members.title'), icon: 'person.2', onSelect: () => openMembersSheet(gid) });
    items.push({
      label: t('media.title'),
      icon: 'paperclip',
      onSelect: () => present.presentSheet((ctx) => <MediaLinksSheet {...ctx} chatId={chatId} />),
    });
    items.push({
      label: t('chat.pinned'),
      icon: 'pin',
      onSelect: () => present.presentSheet((ctx) => <PinnedSheet {...ctx} chatId={chatId} onJump={onJumpMsg} />),
    });
    const isMuted = !!useNotificationStore.getState().mutedChats[chatId];
    items.push({
      label: t(isMuted ? 'notifications.unmute' : 'notifications.mute'),
      icon: isMuted ? 'bell.slash' : 'bell',
      onSelect: () => useNotificationStore.getState().toggleChatMute(chatId),
    });
    return items;
  };

  const trailing = selecting ? (
    <BarTextButton onPress={() => setSelectedIds(allSelected ? new Set() : new Set(tl.messages.map((m) => m.id)))}>
      {allSelected ? t('chat.deselectAll') : t('chat.selectAll')}
    </BarTextButton>
  ) : (
    <BarGroup>
      {dm && <BarButton icon="phone.fill" color="var(--text-secondary)" ariaLabel={t('voice.call')} onPress={callPeer} />}
      <BarButton icon="magnifyingglass" color="var(--text-secondary)" ariaLabel={t('search.title')} onPress={openSearch} />
      <MenuButton items={menuItems}>
        <BarButton
          icon={muted ? 'bell.slash' : 'ellipsis.circle'}
          color={muted ? 'var(--accent)' : 'var(--text-secondary)'}
          ariaLabel={t('common.more')}
        />
      </MenuButton>
    </BarGroup>
  );
  const leading = selecting ? (
    <>
      <BackButton ariaLabel={t('back')} onPress={() => nav.pop()} />
      <BarTextButton onPress={exitSelection}>{t('common.cancel')}</BarTextButton>
    </>
  ) : undefined;

  // ── lines between the list and the composer ──
  const typingRaw = useTypingUsers(chatId);
  const typingText = useMemo(() => {
    if (!typingRaw.length) return null;
    const names = [...typingRaw].sort();
    return names.length === 1 ? t('chat.typingOne', names[0]) : t('chat.typingMany', names.join(', '));
  }, [typingRaw, t]);
  const errText = tl.error ? (tl.error.key ? t(tl.error.key) : tl.error.text) : null;

  const bottomBar = (
    <div className="m-chat-bottombar">
      <div ref={bottomInnerRef}>
        {selecting ? (
          <div className="m-chat-selbar">
            <button type="button" className="m-chat-selbtn is-forward" disabled={!selectedIds.size} onClick={bulkForward}>
              <Icon name="arrowshape.turn.up.right" size={22} />
              <span>{t('chat.forward')}</span>
            </button>
            <span className="m-chat-spacer" />
            <button type="button" className="m-chat-selbtn is-delete" disabled={!selectedIds.size || !allDeletable} onClick={bulkDelete}>
              <TrashGlyph size={22} />
              <span>{t('chat.delete')}</span>
            </button>
          </div>
        ) : (
          <Composer
            ref={composerRef}
            chatId={chatId}
            mentionGroupId={gid}
            myId={me?.id}
            mode={mode}
            onModeChange={setMode}
            onSubmit={submit}
            onSendVoice={sendVoice}
            onOpenPoll={() => openPollComposer((q, opts) => void tl.sendPoll(q, opts))}
            inputRef={inputRef}
            onInputFocus={() => timelineRef.current?.scrollToBottom(true)}
            active={isTop}
          />
        )}
      </div>
    </div>
  );

  return (
    <Screen
      title={selecting ? t('chat.selected', String(selectedIds.size)) : displayTitle}
      leading={leading}
      trailing={trailing}
      scroll={false}
      bottomBar={bottomBar}
    >
      <div className="m-chat-root" ref={fillRef}>
        <ChatTimeline
          ref={timelineRef}
          chatId={chatId}
          tl={tl}
          selecting={selecting}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onLongPress={openMenu}
          onSwipeReply={(msg) => {
            if (!selecting) startReply(msg);
          }}
          onAuthorPress={(msg, anchor) => {
            if (selecting || msg.author_id === me?.id) return;
            openUserActions(anchor, {
              id: msg.author_id,
              username: msg.author_username,
              display_name: msg.author_display_name,
              image_path: msg.author_image_path,
            });
          }}
          onReact={(msg, emoji) => void tl.react(msg.id, emoji)}
          onReplyJump={(id) => {
            tl.revealLoaded(id);
          }}
          onRetry={tl.retry}
          onDismissKeyboard={() => {
            if (document.activeElement === inputRef.current) inputRef.current?.blur();
          }}
        />
        {errText && <div className="m-chat-error">{errText}</div>}
        {typingText && !selecting && <div className="m-chat-typing">{typingText}</div>}
        {tl.isLoadingInitial && tl.messages.length === 0 && tl.pending.length === 0 && (
          <div className="m-chat-loading">
            <Spinner size="regular" />
          </div>
        )}
        {menu && (
          <MessageContextMenu
            msg={menu.msg}
            rowRect={menu.rowRect}
            bounds={menu.bounds}
            isMine={!!me && menu.msg.author_id === me.id}
            canDeleteOthers={canDeleteOthers}
            isPending={menu.isPending}
            gone={menuGone}
            onReact={(emoji) => void tl.react(menu.msg.id, emoji)}
            onReply={() => startReply(menu.msg)}
            onCopy={() => copyText(menu.msg.content ?? '')}
            onTogglePin={() => void tl.togglePin(menu.msg)}
            onForward={() => presentForward([menu.msg])}
            onSelect={() => {
              if (!menu.isPending) pendingSelect.current = menu.msg.id;
            }}
            onEdit={() => startEdit(menu.msg)}
            onDelete={() => void tl.remove(menu.msg.id)}
            onClose={() => {
              setMenu(null);
              const id = pendingSelect.current;
              pendingSelect.current = null;
              if (id) {
                setSelecting(true);
                setSelectedIds(new Set([id]));
              }
            }}
          />
        )}
      </div>
    </Screen>
  );
}
