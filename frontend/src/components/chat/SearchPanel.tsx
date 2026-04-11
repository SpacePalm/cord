// SearchPanel — боковая панель поиска по сообщениям канала

import { useState, useRef, useCallback, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Search, CornerDownRight } from 'lucide-react';
import { messagesApi } from '../../api/messages';
import type { Message } from '../../types';
import { useT } from '../../i18n';

interface SearchPanelProps {
  chatId: string;
  onClose: () => void;
  onJumpTo: (msg: Message) => void;
}

function highlight(text: string, q: string): ReactNode[] {
  if (!q) return [text];
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === q.toLowerCase()
      ? <mark key={i} className="bg-yellow-400/40 rounded px-0.5">{part}</mark>
      : part
  );
}

function SearchResult({ msg, q, onJump }: { msg: Message; q: string; onJump: () => void }) {
  const t = useT();
  const time = new Date(msg.created_at).toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  return (
    <button
      type="button"
      onClick={onJump}
      className="w-full text-left px-4 py-3 border-b border-[var(--border-color)] hover:bg-white/[.05] transition-colors group"
    >
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-sm font-medium text-[var(--text-primary)] shrink-0">
            {msg.author_display_name || msg.author_username}
          </span>
          <span className="text-xs text-[var(--text-muted)]">{time}</span>
        </div>
        <span className="text-xs text-[var(--accent)] opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 shrink-0">
          <CornerDownRight size={11} /> {t('search.jumpTo')}
        </span>
      </div>
      {msg.content && (
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed break-words">
          {highlight(msg.content, q)}
        </p>
      )}
      {msg.attachments.length > 0 && (
        <p className="text-xs text-[var(--text-muted)] mt-1">
          📎 {msg.attachments.length} {t('search.attachments')}
        </p>
      )}
    </button>
  );
}

export function SearchPanel({ chatId, onClose, onJumpTo }: SearchPanelProps) {
  const t = useT();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [allResults, setAllResults] = useState<Message[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const PAGE = 20;

  const handleChange = (value: string) => {
    setInput(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const q = value.trim();
      setQuery(q);
      setAllResults([]);
      setHasMore(true);
    }, 400);
  };

  const { isFetching } = useQuery({
    queryKey: ['search', chatId, query],
    queryFn: async () => {
      const res = await messagesApi.search(chatId, query, PAGE);
      setAllResults(res);
      setHasMore(res.length >= PAGE);
      return res;
    },
    enabled: query.length >= 2,
    staleTime: 10_000,
  });

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || allResults.length === 0) return;
    setLoadingMore(true);
    const oldest = allResults[allResults.length - 1];
    const more = await messagesApi.search(chatId, query, PAGE, oldest.created_at);
    setAllResults((prev) => [...prev, ...more]);
    setHasMore(more.length >= PAGE);
    setLoadingMore(false);
  }, [loadingMore, hasMore, allResults, chatId, query]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distFromBottom < 100) loadMore();
  }, [loadMore]);

  return (
    <div className="w-80 flex flex-col bg-[var(--bg-secondary)] border-l border-[var(--border-color)] h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)] shrink-0">
        <span className="font-semibold text-[var(--text-primary)] text-sm">{t('search.title')}</span>
        <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
          <X size={16} />
        </button>
      </div>

      {/* Input */}
      <div className="px-3 py-2 border-b border-[var(--border-color)] shrink-0">
        <div className="flex items-center gap-2 px-3 py-2 rounded bg-[var(--bg-input)]">
          <Search size={14} className="text-[var(--text-muted)] shrink-0" />
          <input
            autoFocus
            value={input}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={t('search.placeholder')}
            className="flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
          />
          {isFetching && (
            <div className="w-3 h-3 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin shrink-0" />
          )}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto" onScroll={handleScroll}>
        {query.length < 2 && (
          <p className="text-center text-sm text-[var(--text-muted)] mt-12">
            {t('search.minChars')}
          </p>
        )}
        {query.length >= 2 && !isFetching && allResults.length === 0 && (
          <p className="text-center text-sm text-[var(--text-muted)] mt-12">{t('search.noResults')}</p>
        )}
        {allResults.map((msg) => (
          <SearchResult key={msg.id} msg={msg} q={query} onJump={() => onJumpTo(msg)} />
        ))}
        {loadingMore && (
          <div className="flex justify-center py-3">
            <div className="w-4 h-4 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}
