import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Hash, Volume2, ChevronDown, Settings, LogIn, Cog, User as UserIcon, Search, Phone } from 'lucide-react';
import type { Chat, User } from '../../types';
import { useAuthStore } from '../../store/authStore';
import { useSessionStore } from '../../store/sessionStore';
import { VoicePresencePanel } from './VoicePresencePanel';
import { SettingsModal } from '../settings/SettingsModal';
import { voiceApi, type VoiceParticipantInfo } from '../../api/voice';
import { authApi } from '../../api/auth';
import { useT } from '../../i18n';

const STATUS_OPTIONS = [
  { value: 'online', color: 'bg-green-500' },
  { value: 'idle', color: 'bg-yellow-500' },
  { value: 'dnd', color: 'bg-red-500' },
  { value: 'invisible', color: 'bg-gray-500' },
] as const;

function statusColor(status: string) {
  return STATUS_OPTIONS.find((s) => s.value === status)?.color ?? 'bg-green-500';
}

interface ChannelSidebarProps {
  groupName: string;
  channels: Chat[];
  selectedChannelId: string | null;
  onSelectChannel: (id: string) => void;
  canManage: boolean;
  onOpenSettings: () => void;
  unreadByChat?: Record<string, number>;
  isPersonal?: boolean;
  // DM-режим: в шапке кнопка «Позвонить» вместо настроек
  isDm?: boolean;
  dmPeerName?: string;
  onStartCall?: () => void;
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
    staleTime: 60_000,
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

export function UserPanel({ user }: { user: User }) {
  const t = useT();
  const setUser = useAuthStore((s) => s.setUser);
  // Локальный флаг для клика по шестерёнке + синк из глобального стора (CommandPalette)
  const [settingsOpen, setSettingsOpen] = useState(false);
  const uiSettingsOpen = useSessionStore((s) => s.uiSettingsOpen);
  const uiSettingsTab = useSessionStore((s) => s.uiSettingsTab);
  const closeSettings = useSessionStore((s) => s.closeSettings);
  const showSettings = settingsOpen || uiSettingsOpen;
  const [statusOpen, setStatusOpen] = useState(false);
  const [customText, setCustomText] = useState(user.status_text || '');
  const initials = (user.display_name || user.username).slice(0, 2).toUpperCase();
  const currentStatus = user.status || 'online';

  const changeStatus = (status: string) => {
    setStatusOpen(false);
    authApi.updateStatus(status, customText || null).then((updated) => setUser(updated));
  };

  const saveCustomText = () => {
    authApi.updateStatus(currentStatus, customText || null).then((updated) => setUser(updated));
  };

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
          <button
            onClick={() => setStatusOpen((v) => !v)}
            className={`absolute bottom-0 right-0 w-2.5 h-2.5 ${statusColor(currentStatus)} rounded-full border-2 border-[var(--bg-secondary)] cursor-pointer hover:scale-125 transition-transform`}
            title={t('status.setStatus')}
          />
          {statusOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setStatusOpen(false)} />
              <div className="absolute bottom-full left-0 mb-2 w-52 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-xl z-40 py-1">
                <div className="px-2 py-1.5">
                  <input
                    value={customText}
                    onChange={(e) => setCustomText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { saveCustomText(); setStatusOpen(false); } }}
                    onBlur={saveCustomText}
                    maxLength={128}
                    placeholder={t('status.customText')}
                    className="w-full px-2 py-1 rounded bg-[var(--bg-input)] text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                    autoFocus
                  />
                </div>
                <div className="border-t border-[var(--border-color)]">
                  {STATUS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => changeStatus(opt.value)}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-white/5 transition-colors ${currentStatus === opt.value ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}
                    >
                      <span className={`w-2.5 h-2.5 rounded-full ${opt.color}`} />
                      {t(`status.${opt.value}`)}
                    </button>
                  ))}
                </div>
                {customText && (
                  <div className="border-t border-[var(--border-color)]">
                    <button
                      onClick={() => { setCustomText(''); authApi.updateStatus(currentStatus, null).then((u) => { setUser(u); setStatusOpen(false); }); }}
                      className="w-full px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-white/5 transition-colors text-left"
                    >
                      {t('status.clear')}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)] truncate leading-none">
            {user.display_name}
          </p>
          <p className="text-xs text-[var(--text-muted)] truncate">
            {user.status_text || `@${user.username}`}
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

      {showSettings && (
        <SettingsModal
          initialTab={uiSettingsTab ?? undefined}
          onClose={() => { setSettingsOpen(false); closeSettings(); }}
        />
      )}
    </>
  );
}

// Кнопка-псевдоинпут открывающая глобальную палитру поиска.
// Показывает «⌘K» / «Ctrl+K» в зависимости от платформы.
function PaletteButton() {
  const t = useT();
  const openPalette = useSessionStore((s) => s.openPalette);
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <button
      onClick={openPalette}
      className="mx-2 mt-2 mb-1 flex items-center gap-2 px-2.5 py-1.5 rounded bg-[var(--bg-input)] hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors text-sm"
      title={t('palette.open')}
    >
      <Search size={14} className="shrink-0" />
      <span className="flex-1 text-left truncate">{t('palette.quickSearch')}</span>
      <kbd className="text-[10px] border border-[var(--border-color)] rounded px-1 py-0.5 text-[var(--text-muted)]">
        {isMac ? '⌘K' : 'Ctrl+K'}
      </kbd>
    </button>
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
  isPersonal,
  isDm,
  dmPeerName,
  onStartCall,
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
      {/* Шапка сервера / DM */}
      <div className="group/header flex items-center justify-between px-4 py-3 font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-input)] border-b border-[var(--border-color)] transition-colors cursor-default">
        <span className="truncate">
          {isDm ? (dmPeerName ?? groupName) : isPersonal ? t('saved.title') : groupName}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {isDm && onStartCall && (
            <button
              onClick={onStartCall}
              title={t('dms.call')}
              className="p-1 rounded text-[var(--text-muted)] hover:text-green-400 hover:bg-white/5 transition-colors"
            >
              <Phone size={16} />
            </button>
          )}
          {!isDm && canManage && (
            <button
              onClick={onOpenSettings}
              title={isPersonal ? t('saved.manageChats') : t('server.settings')}
              className="opacity-0 group-hover/header:opacity-100 p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all"
            >
              <Cog size={16} />
            </button>
          )}
          {!isPersonal && !isDm && <ChevronDown size={16} className="text-[var(--text-muted)]" />}
        </div>
      </div>

      {/* Кнопка глобального поиска (палитра команд) */}
      <PaletteButton />

      {/* Каналы */}
      <div className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-4">
        {textChannels.length > 0 && (
          <section>
            {!isPersonal && (
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] px-2 mb-1">
                {t('group.text')}
              </p>
            )}
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
                  joinVoice(ch.id, ch.name, groupName, ch.group_id);
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
