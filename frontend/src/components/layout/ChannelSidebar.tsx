import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Hash, Volume2, ChevronDown, Settings, LogIn, Cog, User as UserIcon } from 'lucide-react';
import type { Chat, User } from '../../types';
import { useAuthStore } from '../../store/authStore';
import { useSessionStore } from '../../store/sessionStore';
import { VoicePresencePanel } from './VoicePresencePanel';
import { SettingsModal } from '../settings/SettingsModal';
import { voiceApi, type VoiceParticipantInfo } from '../../api/voice';
import { useT } from '../../i18n';

interface ChannelSidebarProps {
  groupName: string;
  channels: Chat[];
  selectedChannelId: string | null;
  onSelectChannel: (id: string) => void;
  canManage: boolean;
  onOpenSettings: () => void;
  unreadByChat?: Record<string, number>;
}

function TextChannelItem({ channel, selected, onClick, unreadCount = 0 }: {
  channel: Chat;
  selected: boolean;
  onClick: () => void;
  unreadCount?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors text-left
        ${selected
          ? 'bg-[var(--bg-input)] text-[var(--text-primary)]'
          : unreadCount > 0
            ? 'font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-input)]'
            : 'text-[var(--text-muted)] hover:bg-[var(--bg-input)] hover:text-[var(--text-secondary)]'
        }
      `}
    >
      <Hash size={16} className="shrink-0" />
      <span className="truncate">{channel.name}</span>
      {unreadCount > 0 && (
        <span className="ml-auto bg-[var(--danger)] text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center shrink-0">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  );
}

function VoiceChannelItem({ channel, selected, active, onSelect, onJoin }: {
  channel: Chat;
  selected: boolean;
  active: boolean;
  onSelect: () => void;
  onJoin: () => void;
}) {
  const t = useT();
  // Для канала, в котором мы сейчас — берём из Zustand (мгновенно обновляется).
  // Для остальных — запрашиваем с бэкенда через LiveKit API.
  const voicePresence = useSessionStore((s) => s.voicePresence);
  const localParticipants = useSessionStore((s) => s.voiceParticipants);
  const isLocal = voicePresence?.channelId === channel.id;

  const { data: remoteParticipants } = useQuery<VoiceParticipantInfo[]>({
    queryKey: ['voice-participants', channel.id],
    queryFn: () => voiceApi.listParticipants(channel.id),
    enabled: !isLocal,
    refetchInterval: 30000,
    staleTime: 25000,
  });

  const participants = isLocal ? localParticipants : (remoteParticipants ?? []);

  return (
    <div>
      <div
        className={`
          group flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors cursor-pointer
          ${selected || active
            ? 'bg-[var(--bg-input)] text-[var(--text-primary)]'
            : 'text-[var(--text-muted)] hover:bg-[var(--bg-input)] hover:text-[var(--text-secondary)]'
          }
        `}
        onClick={onSelect}
      >
        <Volume2 size={16} className={`shrink-0 ${active ? 'text-green-400' : ''}`} />
        <span className="truncate flex-1">{channel.name}</span>

        <button
          onClick={(e) => { e.stopPropagation(); onJoin(); }}
          title={active ? t('group.alreadyConnected') : t('group.joinVoice')}
          className={`
            shrink-0 p-0.5 rounded transition-colors
            ${active
              ? 'text-green-400'
              : 'opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }
          `}
        >
          <LogIn size={14} />
        </button>
      </div>

      {/* Список участников */}
      {participants.length > 0 && (
        <div className="ml-5 mt-0.5 mb-1 flex flex-col gap-0.5">
          {participants.map((p) => {
            const initials = (p.name || '?').slice(0, 2).toUpperCase();
            return (
              <div key={p.identity} className="flex items-center gap-1.5 px-2 py-0.5 text-xs text-[var(--text-muted)]">
                {p.image_path ? (
                  <img src={p.image_path} alt="" className="w-4 h-4 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="w-4 h-4 rounded-full bg-[var(--accent)] flex items-center justify-center text-white shrink-0" style={{ fontSize: 7 }}>
                    {initials}
                  </div>
                )}
                <span className="truncate">{p.name}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function UserPanel({ user }: { user: User }) {
  const t = useT();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const initials = (user.display_name || user.username).slice(0, 2).toUpperCase();

  return (
    <>
      <div className="flex items-center gap-2 p-2">
        <div className="relative shrink-0">
          {user.image_path ? (
            <img
              src={user.image_path}
              alt="avatar"
              className="w-8 h-8 rounded-full object-cover"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-[var(--accent)] flex items-center justify-center text-white text-xs font-bold">
              {initials}
            </div>
          )}
          <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-[var(--bg-secondary)]" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)] truncate leading-none">
            {user.display_name}
          </p>
          <p className="text-xs text-[var(--text-muted)] truncate">
            @{user.username}
          </p>
        </div>

        <button
          onClick={() => setSettingsOpen(true)}
          className="p-1 rounded hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          title={t('settings.profileSettings')}
        >
          <Settings size={16} />
        </button>
      </div>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </>
  );
}

export function ChannelSidebar({
  groupName,
  channels,
  selectedChannelId,
  onSelectChannel,
  canManage,
  onOpenSettings,
  unreadByChat,
}: ChannelSidebarProps) {
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const voicePresence = useSessionStore((s) => s.voicePresence);
  const joinVoice = useSessionStore((s) => s.joinVoice);

  const textChannels = channels.filter((c) => c.type === 'text');
  const voiceChannels = channels.filter((c) => c.type === 'voice');

  return (
    <div
      className="w-60 flex flex-col flex-1 md:flex-initial"
      style={{ background: 'var(--bg-secondary)' }}
    >
      {/* Шапка сервера */}
      <div className="group/header flex items-center justify-between px-4 py-3 font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-input)] border-b border-[var(--border-color)] transition-colors cursor-default">
        <span className="truncate">{groupName}</span>
        <div className="flex items-center gap-1 shrink-0">
          {canManage && (
            <button
              onClick={onOpenSettings}
              title={t('server.settings')}
              className="opacity-0 group-hover/header:opacity-100 p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all"
            >
              <Cog size={16} />
            </button>
          )}
          <ChevronDown size={16} className="text-[var(--text-muted)]" />
        </div>
      </div>

      {/* Каналы */}
      <div className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-4">
        {textChannels.length > 0 && (
          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] px-2 mb-1">
              {t('group.text')}
            </p>
            {textChannels.map((ch) => (
              <TextChannelItem
                key={ch.id}
                channel={ch}
                selected={selectedChannelId === ch.id}
                onClick={() => onSelectChannel(ch.id)}
                unreadCount={unreadByChat?.[ch.id] ?? 0}
              />
            ))}
          </section>
        )}

        {voiceChannels.length > 0 && (
          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] px-2 mb-1">
              {t('group.voice')}
            </p>
            {voiceChannels.map((ch) => (
              <VoiceChannelItem
                key={ch.id}
                channel={ch}
                selected={selectedChannelId === ch.id}
                active={voicePresence?.channelId === ch.id}
                onSelect={() => onSelectChannel(ch.id)}
                onJoin={() => {
                  joinVoice(ch.id, ch.name, groupName);
                  onSelectChannel(ch.id);
                }}
              />
            ))}
          </section>
        )}

        {channels.length === 0 && (
          <p className="text-sm text-[var(--text-muted)] px-2 py-4 text-center">
            {t('server.noGroups')}
          </p>
        )}
      </div>

      {/* Панель голосового канала (если подключён) */}
      <VoicePresencePanel />

      {/* Панель пользователя */}
      {user && (
        <div className="border-t border-[var(--border-color)]">
          <UserPanel user={user} />
        </div>
      )}
    </div>
  );
}
