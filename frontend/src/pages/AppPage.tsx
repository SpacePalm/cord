import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GroupSidebar } from '../components/layout/GroupSidebar';
import { ChannelSidebar } from '../components/layout/ChannelSidebar';
import { ChatInput } from '../components/chat/ChatInput';
import { MessageList, type MessageListHandle } from '../components/chat/MessageList';
import { SearchPanel } from '../components/chat/SearchPanel';
import { MediaPanel } from '../components/chat/MediaPanel';
import { GroupSettingsModal } from '../components/settings/GroupSettingsModal';
import { useSessionStore } from '../store/sessionStore';
import { useAuthStore } from '../store/authStore';
import { groupsApi } from '../api/groups';
import { messagesApi } from '../api/messages';
import type { Group, Chat, Message } from '../types';
import { Hash, Volume2, LogIn, Search, Paperclip, Users, X, Plus, ArrowLeft, Menu } from 'lucide-react';
import { MemberListPanel } from '../components/layout/MemberListPanel';
import { VoiceRoom } from '../components/voice/VoiceRoom';
import { useT } from '../i18n';
import { useUnreadCounts } from '../hooks/useUnreadCounts';
import { useCordWebSocket } from '../hooks/useWebSocket';
import { ToastContainer } from '../components/ui/ToastContainer';

type SidePanel = 'search' | 'media' | 'members' | null;

function CallTimer() {
  const callStartedAt = useSessionStore((s) => s.callStartedAt);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((v: number) => v + 1), 1000);
    return () => clearInterval(id);
  }, []);
  if (!callStartedAt) return null;
  const sec = Math.floor((Date.now() - callStartedAt) / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const text = h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return <span className="text-xs text-[var(--text-muted)] tabular-nums ml-2">{text}</span>;
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------
function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-muted)] gap-3">
      <Hash size={48} strokeWidth={1} />
      <p className="text-lg font-medium">{message}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VoiceChannelView
// ---------------------------------------------------------------------------
function VoiceChannelView({ channel, groupName }: { channel: Chat; groupName: string }) {
  const t = useT();
  const voicePresence = useSessionStore((s) => s.voicePresence);
  const joinVoice = useSessionStore((s) => s.joinVoice);

  const isInThisChannel = voicePresence?.channelId === channel.id;

  // When connected — VoiceRoom is rendered at AppPage level (not unmounted on channel switch)
  if (isInThisChannel) return null;

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-[var(--text-muted)]">
      <Volume2 size={64} strokeWidth={1} />
      <div className="text-center">
        <p className="text-xl font-semibold text-[var(--text-primary)]">{channel.name}</p>
        <p className="text-sm mt-1">{t('group.voiceGroup')}</p>
      </div>
      <button
        onClick={() => joinVoice(channel.id, channel.name, groupName)}
        className="px-6 py-2 rounded bg-[var(--accent)] text-white font-medium hover:bg-[var(--accent-hover)] transition-colors flex items-center gap-2"
      >
        <LogIn size={18} />
        {t('group.joinVoice')}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CreateServerModal
// ---------------------------------------------------------------------------
function CreateServerModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string) => void }) {
  const t = useT();
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed) {
      onCreate(trimmed);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md bg-[var(--bg-secondary)] rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-4 text-center">
          <div className="w-14 h-14 rounded-full bg-[var(--accent)]/15 flex items-center justify-center mx-auto mb-4">
            <Plus size={28} className="text-[var(--accent)]" />
          </div>
          <h2 className="text-xl font-bold text-[var(--text-primary)] mb-1">{t('server.createTitle')}</h2>
          <p className="text-sm text-[var(--text-muted)]">{t('server.createSubtitle')}</p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 pb-6">
          <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">
            {t('server.namePrompt')}
          </label>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('server.namePlaceholder')}
            maxLength={100}
            className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
          />

          <div className="flex gap-3 mt-5">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-white/5 text-[var(--text-secondary)] hover:bg-white/10 transition-colors"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t('server.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AppPage
// ---------------------------------------------------------------------------
export function AppPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const voicePresence = useSessionStore((s) => s.voicePresence);
  const { reconnect: reconnectWs } = useCordWebSocket();

  // Mobile responsive: show one panel at a time on small screens
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const [mobileView, setMobileView] = useState<'groups' | 'channels' | 'chat'>('groups');
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const lastGroupId = useSessionStore((s) => s.lastGroupId);
  const lastChannelId = useSessionStore((s) => s.lastChannelId);
  const setLastGroup = useSessionStore((s) => s.setLastGroup);
  const setLastChannel = useSessionStore((s) => s.setLastChannel);

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(lastGroupId);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(lastChannelId);

  const { unreadByChat, unreadByGroup, markRead, toasts, dismissToast } = useUnreadCounts();

  // Группы текущего пользователя
  // Не используем isLoading для блокировки — запрос может зависнуть если backend недоступен
  const { data: groups } = useQuery<Group[]>({
    queryKey: ['groups'],
    queryFn: groupsApi.list,
    staleTime: 30_000,
    retry: 1,
  });

  // При первой загрузке групп — выбрать первую если нет сохранённого
  useEffect(() => {
    if (groups && groups.length > 0 && !selectedGroupId) {
      setSelectedGroupId(groups[0].id);
    }
  }, [groups, selectedGroupId]);

  // Каналы выбранной группы
  // Не используем = [] по умолчанию — это создаёт нестабильную ссылку на каждый рендер,
  // из-за чего useEffect ниже срабатывал бы при каждом рендере
  const { data: channels } = useQuery<Chat[]>({
    queryKey: ['chats', selectedGroupId],
    queryFn: () => groupsApi.listChats(selectedGroupId!),
    enabled: !!selectedGroupId,
    staleTime: 30_000,
    retry: 1,
  });

  // При смене группы — восстановить сохранённый канал или взять первый текстовый
  useEffect(() => {
    if (channels === undefined) return; // ещё грузится — не трогаем
    const savedExists = lastChannelId && channels.some((c) => c.id === lastChannelId);
    const chosenId = savedExists
      ? lastChannelId!
      : (channels.find((c) => c.type === 'text') ?? channels[0])?.id ?? null;
    setSelectedChannelId(chosenId);
    if (chosenId) setLastChannel(chosenId);
  }, [channels]); // eslint-disable-line react-hooks/exhaustive-deps

  // Создать группу
  const createGroupMutation = useMutation({
    mutationFn: groupsApi.create,
    onSuccess: (newGroup: Group) => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      setSelectedGroupId(newGroup.id);
      reconnectWs();
    },
  });

  // Отправить сообщение
  const sendMessageMutation = useMutation({
    mutationFn: ({ chatId, text, files, replyToId, poll, onProgress }: {
      chatId: string; text: string; files: File[]; replyToId?: string;
      poll?: { question: string; options: string[] };
      onProgress?: (pct: number) => void;
    }) => messagesApi.send(chatId, text, files, replyToId, poll, onProgress).then((res) => {
      // После отправки помечаем чат прочитанным чтобы свои сообщения не считались непрочитанными
      markRead(chatId);
      return res;
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', selectedChannelId] });
    },
  });

  const messageListRef = useRef<MessageListHandle>(null);
  const [sidePanel, setSidePanel] = useState<SidePanel>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [groupSettingsOpen, setGroupSettingsOpen] = useState(false);
  const [createServerOpen, setCreateServerOpen] = useState(false);

  const groupList = groups ?? [];
  const channelList = channels ?? [];
  const selectedGroup = groupList.find((g) => g.id === selectedGroupId);
  const selectedChannel = channelList.find((c) => c.id === selectedChannelId);
  const canManage = !!selectedGroup && (
    selectedGroup.owner_id === currentUser?.id || currentUser?.role === 'admin'
  );

  // Members query to check editor role
  const { data: currentMembers } = useQuery({
    queryKey: ['group-members', selectedGroupId],
    queryFn: () => groupsApi.getMembers(selectedGroupId!),
    enabled: !!selectedGroupId,
    staleTime: 30_000,
  });
  const currentMember = currentMembers?.find((m: { user_id: string }) => m.user_id === currentUser?.id);
  const canEdit = canManage || (!!currentMember && currentMember.role === 'editor');

  // Закрывать панели (кроме участников) и сбрасывать ответ при смене канала
  useEffect(() => { setSidePanel((p) => p === 'members' ? p : null); setReplyTo(null); }, [selectedChannelId]);

  // Пометить канал прочитанным при переключении
  useEffect(() => {
    if (selectedChannelId) markRead(selectedChannelId);
  }, [selectedChannelId, markRead]);

  const togglePanel = (panel: NonNullable<SidePanel>) =>
    setSidePanel((p) => (p === panel ? null : panel));

  const handleSelectGroup = (id: string) => {
    setSelectedGroupId(id);
    setLastGroup(id);
    setSelectedChannelId(null);
    if (isMobile) setMobileView('channels');
  };

  const handleCreateGroup = () => {
    setCreateServerOpen(true);
  };

  const handleSend = (
    text: string,
    attachments: File[],
    replyToId?: string,
    poll?: { question: string; options: string[] },
    onProgress?: (pct: number) => void,
  ) => {
    if (!selectedChannelId) return;
    sendMessageMutation.mutate({ chatId: selectedChannelId, text, files: attachments, replyToId, poll, onProgress });
    setReplyTo(null);
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Колонка 1: Список серверов */}
      <div className={isMobile && mobileView !== 'groups' ? 'hidden' : ''}>
        <GroupSidebar
          groups={groupList}
          selectedGroupId={selectedGroupId}
          onSelectGroup={handleSelectGroup}
          onCreateGroup={handleCreateGroup}
          unreadByGroup={unreadByGroup}
        />
      </div>

      {/* Колонка 2: Список каналов */}
      <div className={`${isMobile && mobileView !== 'channels' ? 'hidden' : ''} ${isMobile ? 'flex-1' : ''}`}>
        {selectedGroup ? (
          <ChannelSidebar
            groupName={selectedGroup.name}
            channels={channelList}
            selectedChannelId={selectedChannelId}
            onSelectChannel={(id) => { setSelectedChannelId(id); setLastChannel(id); markRead(id); if (isMobile) setMobileView('chat'); }}
            unreadByChat={unreadByChat}
            canManage={canEdit}
            onOpenSettings={() => setGroupSettingsOpen(true)}
            onBack={isMobile ? () => setMobileView('groups') : undefined}
          />
        ) : (
          <div className={`${isMobile ? 'flex-1' : 'w-60'} bg-[var(--bg-secondary)]`} />
        )}
      </div>

      {/* Колонка 3: Основная область + боковые панели */}
      <div className={`flex-1 flex overflow-hidden ${isMobile && mobileView !== 'chat' ? 'hidden' : ''}`}>
        {/* Чат */}
        <div className="flex-1 flex flex-col bg-[var(--bg-tertiary)] overflow-hidden min-w-0">
          {selectedChannel ? (
            <>
              {/* Шапка канала */}
              <div className="h-12 flex items-center px-4 gap-2 border-b border-[var(--border-color)] shadow-sm shrink-0">
                {isMobile && (
                  <button onClick={() => setMobileView('channels')} className="p-1 -ml-1 mr-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5">
                    <ArrowLeft size={20} />
                  </button>
                )}
                {selectedChannel.type === 'voice' ? (
                  <Volume2 size={20} className="text-[var(--text-muted)]" />
                ) : (
                  <Hash size={20} className="text-[var(--text-muted)]" />
                )}
                <span className="font-semibold text-[var(--text-primary)]">
                  {selectedChannel.name}
                </span>
                {voicePresence && voicePresence.channelId === selectedChannel.id && (
                  <CallTimer />
                )}

                {/* Кнопки панелей */}
                <div className="ml-auto flex items-center gap-1">
                  {selectedChannel.type === 'text' && (
                    <>
                      <button
                        onClick={() => togglePanel('search')}
                        title={t('search')}
                        className={`p-1.5 rounded transition-colors ${
                          sidePanel === 'search'
                            ? 'bg-[var(--accent)] text-white'
                            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5'
                        }`}
                      >
                        <Search size={18} />
                      </button>
                      <button
                        onClick={() => togglePanel('media')}
                        title={t('group.attachments')}
                        className={`p-1.5 rounded transition-colors ${
                          sidePanel === 'media'
                            ? 'bg-[var(--accent)] text-white'
                            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5'
                        }`}
                      >
                        <Paperclip size={18} />
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => togglePanel('members')}
                    title={t('members')}
                    className={`p-1.5 rounded transition-colors ${
                      sidePanel === 'members'
                        ? 'bg-[var(--accent)] text-white'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5'
                    }`}
                  >
                    <Users size={18} />
                  </button>
                </div>
              </div>

              {/* Voice join screen (not connected) */}
              {selectedChannel.type === 'voice' && (!voicePresence || voicePresence.channelId !== selectedChannel.id) && (
                <VoiceChannelView
                  channel={selectedChannel}
                  groupName={selectedGroup?.name ?? ''}
                />
              )}

              {/* Text chat */}
              {selectedChannel.type === 'text' && (
                <>
                  <MessageList ref={messageListRef} chatId={selectedChannel.id} onReply={setReplyTo} />
                  <ChatInput
                    channelId={selectedChannel.id}
                    channelName={selectedChannel.name}
                    replyTo={replyTo}
                    onClearReply={() => setReplyTo(null)}
                    onSend={handleSend}
                    onFocus={() => selectedChannel && markRead(selectedChannel.id)}
                  />
                </>
              )}
            </>
          ) : (
            <EmptyState message={groupList.length === 0 ? t('server.createFirst') : t('group.select')} />
          )}

          {/* VoiceRoom — persists across channel switches, hidden via display */}
          {voicePresence && (
            <div
              className="flex-1 flex flex-col overflow-hidden min-h-0"
              style={{ display: selectedChannel?.id === voicePresence.channelId ? 'flex' : 'none' }}
            >
              <VoiceRoom
                channelId={voicePresence.channelId}
                channelName={voicePresence.channelName}
                groupName={voicePresence.groupName}
              />
            </div>
          )}
        </div>

        {/* Боковые панели */}
        {selectedChannel?.type === 'text' && sidePanel === 'search' && (
          <SearchPanel
            chatId={selectedChannel.id}
            onClose={() => setSidePanel(null)}
            onJumpTo={(msg) => {
              setSidePanel(null);
              messageListRef.current?.jumpTo(msg.id, msg.created_at);
            }}
          />
        )}
        {selectedChannel?.type === 'text' && sidePanel === 'media' && (
          <MediaPanel chatId={selectedChannel.id} onClose={() => setSidePanel(null)} />
        )}
        {sidePanel === 'members' && selectedGroup && (
          <MemberListPanel
            groupId={selectedGroup.id}
            onClose={() => setSidePanel(null)}
          />
        )}
      </div>

      {createServerOpen && (
        <CreateServerModal
          onClose={() => setCreateServerOpen(false)}
          onCreate={(name) => createGroupMutation.mutate(name)}
        />
      )}

      {groupSettingsOpen && selectedGroup && (
        <GroupSettingsModal
          group={selectedGroup}
          channels={channelList}
          onClose={() => setGroupSettingsOpen(false)}
          onGroupUpdated={(g) => {
            queryClient.setQueryData<Group[]>(['groups'], (old) => old?.map((x) => (x.id === g.id ? g : x)) ?? [g]);
          }}
          onChannelsChanged={() => queryClient.invalidateQueries({ queryKey: ['chats', selectedGroupId] })}
        />
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

    </div>
  );
}
