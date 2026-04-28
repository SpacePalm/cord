// BookmarksPanel — глобальный список закладок пользователя.
//
// Отличается от PinnedMessages тем, что:
//  • показывает закладки из ВСЕХ чатов, а не только текущего,
//  • виден только владельцу (личные, не общие),
//  • группирует по чату, чтобы было видно откуда пришла закладка.
//
// Прыжок к закладке переключает чат через те же session-store механизмы,
// что использует CommandPalette (setLastGroup/setLastChannel + setPendingJumpTo).

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Bookmark as BookmarkIcon, Hash } from 'lucide-react';
import { bookmarksApi, type Bookmark } from '../../api/bookmarks';
import { useSessionStore } from '../../store/sessionStore';
import { useT, useLocale } from '../../i18n';
import { renderContent } from '../../utils/renderContent';
import { useAuthStore } from '../../store/authStore';

interface Props {
  onClose: () => void;
}

export function BookmarksPanel({ onClose }: Props) {
  const t = useT();
  const locale = useLocale();
  const selfUsername = useAuthStore((s) => s.user?.username);
  const setLastGroup = useSessionStore((s) => s.setLastGroup);
  const setLastChannel = useSessionStore((s) => s.setLastChannel);
  const setPendingJumpTo = useSessionStore((s) => s.setPendingJumpTo);

  const { data: bookmarks = [], isLoading } = useQuery<Bookmark[]>({
    queryKey: ['my-bookmarks'],
    queryFn: () => bookmarksApi.listMine(),
    staleTime: 30_000,
  });

  const jumpTo = useCallback((b: Bookmark) => {
    setLastGroup(b.chat.group_id);
    setLastChannel(b.chat.id);
    setPendingJumpTo({ chatId: b.chat.id, messageId: b.message.id, createdAt: b.message.created_at });
    onClose();
  }, [setLastGroup, setLastChannel, setPendingJumpTo, onClose]);

  return (
    <div className="w-80 flex flex-col bg-[var(--bg-secondary)] border-l border-[var(--border-color)] h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)] shrink-0">
        <span className="font-semibold text-[var(--text-primary)] text-sm flex items-center gap-2">
          <BookmarkIcon size={14} className="text-yellow-400" />
          {t('chat.bookmarks')}
        </span>
        <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex justify-center py-8">
            <div className="w-4 h-4 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
          </div>
        )}
        {!isLoading && bookmarks.length === 0 && (
          <p className="text-center text-sm text-[var(--text-muted)] mt-12 px-4">
            {t('chat.bookmarksEmpty')}
          </p>
        )}
        {bookmarks.map((b) => {
          const time = new Date(b.message.created_at).toLocaleString(locale, {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
          });
          return (
            <button
              key={b.message.id}
              type="button"
              onClick={() => jumpTo(b)}
              className="w-full text-left px-4 py-3 border-b border-[var(--border-color)] hover:bg-white/[.05] transition-colors group"
            >
              <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] mb-1">
                <Hash size={11} />
                <span className="truncate">{b.chat.name}</span>
                <span className="ml-auto shrink-0">{time}</span>
              </div>
              <div className="flex items-baseline gap-2 mb-0.5">
                <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                  {b.message.author_display_name || b.message.author_username}
                </span>
              </div>
              {b.message.content && (
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed break-words line-clamp-3">
                  {renderContent(b.message.content, selfUsername)}
                </p>
              )}
              {b.message.attachments.length > 0 && (
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  📎 {b.message.attachments.length}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
