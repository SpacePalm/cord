// Панель списка Direct Messages. Заменяет ChannelSidebar когда dmMode=true.
// Показывает DM-беседы в порядке свежести с превью последнего сообщения.

import { useQuery } from '@tanstack/react-query';
import { MessageCircle, Search } from 'lucide-react';
import { dmsApi, type DMItem } from '../../api/dms';
import { useAuthStore } from '../../store/authStore';
import { useSessionStore } from '../../store/sessionStore';
import { useT, useLocale } from '../../i18n';
import { VoicePresencePanel } from './VoicePresencePanel';
import { UserPanel } from './ChannelSidebar';

interface Props {
  selectedChannelId: string | null;
  onSelect: (dm: DMItem) => void;
  onExpandCall?: () => void;
}

function DMRow({ dm, selected, onClick, locale }: {
  dm: DMItem;
  selected: boolean;
  onClick: () => void;
  locale: string;
}) {
  const t = useT();
  const initials = (dm.peer.display_name || dm.peer.username).slice(0, 2).toUpperCase();
  const timeText = dm.last_message_at
    ? new Date(dm.last_message_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : '';
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded transition-colors text-left ${
        selected
          ? 'bg-[var(--bg-input)]'
          : 'hover:bg-white/5'
      }`}
    >
      <div className="relative shrink-0">
        {dm.peer.image_path ? (
          <img src={dm.peer.image_path} alt="" className="w-9 h-9 rounded-full object-cover" />
        ) : (
          <div className="w-9 h-9 rounded-full bg-[var(--accent)] flex items-center justify-center text-white text-xs font-bold">
            {initials}
          </div>
        )}
        {/* Статус-точка: серая если не в сети или invisible;
            иначе — цвет по выбранному статусу */}
        <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[var(--bg-secondary)] ${
          !dm.peer.is_online || dm.peer.status === 'invisible' ? 'bg-gray-500'
          : dm.peer.status === 'idle' ? 'bg-yellow-500'
          : dm.peer.status === 'dnd' ? 'bg-red-500'
          : 'bg-green-500'
        }`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`text-sm truncate ${selected ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-primary)]'}`}>
            {dm.peer.display_name || dm.peer.username}
          </span>
          {timeText && (
            <span className="text-[10px] text-[var(--text-muted)] shrink-0">{timeText}</span>
          )}
        </div>
        <p className={`text-xs truncate ${dm.unread_count > 0 ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-muted)]'}`}>
          {dm.last_message || t('dms.noMessages')}
        </p>
      </div>
      {dm.unread_count > 0 && (
        <span className="ml-auto bg-[var(--danger)] text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center shrink-0">
          {dm.unread_count > 99 ? '99+' : dm.unread_count}
        </span>
      )}
    </button>
  );
}

export function DMListPanel({ selectedChannelId, onSelect, onExpandCall }: Props) {
  const t = useT();
  const locale = useLocale();
  const user = useAuthStore((s) => s.user);
  const openPalette = useSessionStore((s) => s.openPalette);

  const { data: dms, isLoading } = useQuery({
    queryKey: ['dms'],
    queryFn: dmsApi.list,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  return (
    <div className="w-60 flex flex-col flex-1 md:flex-initial" style={{ background: 'var(--bg-secondary)' }}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-color)]">
        <MessageCircle size={16} className="text-[var(--text-muted)]" />
        <span className="font-semibold text-[var(--text-primary)] flex-1 truncate">{t('dms.title')}</span>
      </div>

      {/* Кнопка "Новый чат" — открывает палитру сразу на фильтре "Люди" */}
      <button
        onClick={openPalette}
        className="mx-2 mt-2 mb-1 flex items-center gap-2 px-2.5 py-1.5 rounded bg-[var(--bg-input)] hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors text-sm"
      >
        <Search size={14} />
        <span className="flex-1 text-left">{t('dms.newChat')}</span>
      </button>

      <div className="flex-1 overflow-y-auto px-1 py-1">
        {isLoading && <p className="text-sm text-[var(--text-muted)] px-3 py-4 text-center">{t('loading')}</p>}
        {!isLoading && (dms ?? []).length === 0 && (
          <p className="text-sm text-[var(--text-muted)] px-3 py-8 text-center">
            {t('dms.empty')}
          </p>
        )}
        {(dms ?? []).map((dm) => (
          <DMRow
            key={dm.group_id}
            dm={dm}
            locale={locale}
            selected={selectedChannelId === dm.chat_id}
            onClick={() => onSelect(dm)}
          />
        ))}
      </div>

      {/* Панель текущего голосового звонка (mute/disconnect) — если активен */}
      <VoicePresencePanel onExpand={onExpandCall} />

      {/* Панель пользователя — статус и настройки. Та же что в ChannelSidebar. */}
      {user && (
        <div className="border-t border-[var(--border-color)]">
          <UserPanel user={user} />
        </div>
      )}
    </div>
  );
}
