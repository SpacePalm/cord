// ForwardModal — выбор целевого канала для пересылки сообщений

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Search, Send } from 'lucide-react';
import { groupsApi } from '../../api/groups';
import { messagesApi } from '../../api/messages';
import type { Message } from '../../types';
import { useT } from '../../i18n';

interface ForwardModalProps {
  messages: Message[];
  onClose: () => void;
}

export function ForwardModal({ messages, onClose }: ForwardModalProps) {
  const t = useT();
  const [search, setSearch] = useState('');
  const [targetChatId, setTargetChatId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: groups = [] } = useQuery({
    queryKey: ['groups'],
    queryFn: groupsApi.list,
  });

  // Загружаем каналы для всех групп
  const { data: allChats = [] } = useQuery({
    queryKey: ['all-chats-for-forward', groups.map((g) => g.id).join(',')],
    queryFn: async () => {
      const results = await Promise.all(groups.map((g) => groupsApi.listChats(g.id)));
      return results.flatMap((chats, i) =>
        chats
          .filter((c) => c.type === 'text')
          .map((c) => ({ ...c, groupName: groups[i].name }))
      );
    },
    enabled: groups.length > 0,
  });

  const forwardMutation = useMutation<void>({
    mutationFn: async () => {
      if (messages.length === 1) {
        await messagesApi.forward(targetChatId!, messages[0].id);
      } else {
        await messagesApi.forwardBulk(
          targetChatId!,
          messages.map((m) => m.id),
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', targetChatId] });
      onClose();
    },
  });

  const filtered = allChats.filter((c) => {
    const term = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(term) ||
      (c as typeof c & { groupName: string }).groupName.toLowerCase().includes(term)
    );
  });

  // Группируем по серверу
  const byGroup: Record<string, typeof filtered> = {};
  for (const c of filtered) {
    const gn = (c as typeof c & { groupName: string }).groupName;
    (byGroup[gn] ??= []).push(c);
  }

  const title = messages.length > 1
    ? t('chat.forwardSelected')
    : t('chat.forward');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-96 bg-[var(--bg-secondary)] rounded-xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
          <span className="font-semibold text-[var(--text-primary)]">
            {title}
            {messages.length > 1 && (
              <span className="ml-2 text-xs font-normal text-[var(--text-muted)]">
                ({messages.length})
              </span>
            )}
          </span>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-[var(--bg-input)]">
            <Search size={14} className="text-[var(--text-muted)] shrink-0" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('group.find')}
              className="flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            />
          </div>
        </div>

        {/* Channel list */}
        <div className="flex-1 overflow-y-auto max-h-72 py-2">
          {Object.entries(byGroup).map(([groupName, chats]) => (
            <div key={groupName}>
              <p className="px-4 py-1 text-xs font-semibold uppercase text-[var(--text-muted)] tracking-wide">
                {groupName}
              </p>
              {chats.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setTargetChatId(c.id === targetChatId ? null : c.id)}
                  className={`w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
                    targetChatId === c.id
                      ? 'bg-[var(--accent)] text-white'
                      : 'text-[var(--text-secondary)] hover:bg-white/5 hover:text-[var(--text-primary)]'
                  }`}
                >
                  # {c.name}
                </button>
              ))}
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="text-center text-sm text-[var(--text-muted)] py-8">{t('group.notFound')}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-[var(--border-color)] flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            {t('cancel')}
          </button>
          <button
            onClick={() => forwardMutation.mutate()}
            disabled={!targetChatId || forwardMutation.isPending}
            className="px-4 py-2 rounded bg-[var(--accent)] text-white text-sm flex items-center gap-2 hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={14} />
            {t('chat.forwardBtn')}
          </button>
        </div>
      </div>
    </div>
  );
}
