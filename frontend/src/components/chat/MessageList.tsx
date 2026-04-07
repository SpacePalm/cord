import { useEffect, useRef, useState, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Pencil, Trash2, Forward, Check, CornerUpLeft, Reply, Play, Pause, Copy } from 'lucide-react';
import { messagesApi } from '../../api/messages';
import { pollsApi } from '../../api/polls';
import { useAuthStore } from '../../store/authStore';
import { ForwardModal } from './ForwardModal';
import { renderContent, Spoiler as _Spoiler } from '../../utils/renderContent';
import { useProtectedUrl, toProtectedUrl } from '../../hooks/useProtectedUrl';
import type { Message, ReplyTo, Poll } from '../../types';


const PAGE = 50;

// ---------------------------------------------------------------------------
// Lightbox
// ---------------------------------------------------------------------------
function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20">
        <X size={20} />
      </button>
      <img
        src={url} alt="просмотр"
        className="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// VoicePlayer
// ---------------------------------------------------------------------------
function VoicePlayer({ url }: { url: string }) {
  const protectedUrl = useProtectedUrl(toProtectedUrl(url));
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.play();
      setPlaying(true);
    }
  };

  const handleTimeUpdate = () => {
    const el = audioRef.current;
    if (!el || !el.duration) return;
    setCurrentTime(el.currentTime);
    setProgress((el.currentTime / el.duration) * 100);
  };

  const handleEnded = () => { setPlaying(false); setProgress(0); setCurrentTime(0); };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audioRef.current;
    if (!el) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    el.currentTime = ratio * el.duration;
  };

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  };

  if (!protectedUrl) {
    return (
      <div className="flex items-center gap-2 mt-1 px-3 py-2 rounded-lg bg-[var(--bg-secondary)] max-w-xs">
        <div className="w-8 h-8 rounded-full bg-white/10 animate-pulse shrink-0" />
        <div className="flex-1 h-1.5 bg-white/10 rounded-full" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 mt-1 px-3 py-2 rounded-lg bg-[var(--bg-secondary)] max-w-xs">
      <audio
        ref={audioRef}
        src={protectedUrl}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        onLoadedMetadata={(e) => setDuration((e.target as HTMLAudioElement).duration)}
      />
      <button
        onClick={toggle}
        className="shrink-0 w-8 h-8 rounded-full bg-[var(--accent)] flex items-center justify-center text-white hover:opacity-90 transition-opacity"
      >
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <div className="flex-1 min-w-0">
        <div
          className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden cursor-pointer"
          onClick={handleSeek}
        >
          <div
            className="h-full bg-[var(--accent)] rounded-full transition-[width] duration-100"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between mt-0.5 text-xs text-[var(--text-muted)]">
          <span>{fmt(currentTime)}</span>
          <span>{duration ? fmt(duration) : '—'}</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AttachmentView
// ---------------------------------------------------------------------------
const AUDIO_RE = /\.(webm|ogg|mp3|wav|m4a|aac|opus)$/i;
const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg)$/i;

function ProtectedImage({ url, onZoom }: { url: string; onZoom: (u: string) => void }) {
  const src = useProtectedUrl(toProtectedUrl(url));
  if (!src) {
    return <div className="mt-1 h-32 w-48 rounded bg-white/5 animate-pulse" />;
  }
  return (
    <button onClick={() => onZoom(src)} className="block mt-1 rounded overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
      <img src={src} alt="вложение" className="max-h-64 max-w-sm rounded object-cover hover:brightness-90 transition-[filter] cursor-zoom-in" />
    </button>
  );
}

function ProtectedFileLink({ url }: { url: string }) {
  const rawName = decodeURIComponent(url.split('/').pop() ?? 'файл');
  const displayName = rawName.replace(/^[0-9a-f]{8}_/, '');
  const [progress, setProgress] = useState<number | null>(null);

  const handleDownload = (e: React.MouseEvent) => {
    e.preventDefault();
    if (progress !== null) return; // уже скачивается

    const token = localStorage.getItem('access_token');
    const xhr = new XMLHttpRequest();
    xhr.open('GET', toProtectedUrl(url));
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.responseType = 'blob';

    xhr.addEventListener('progress', (ev) => {
      if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
      else setProgress(-1); // indeterminate
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(xhr.response);
        a.download = displayName;
        a.click();
        URL.revokeObjectURL(a.href);
      }
      setProgress(null);
    });

    xhr.addEventListener('error', () => setProgress(null));
    xhr.addEventListener('abort', () => setProgress(null));

    setProgress(0);
    xhr.send();
  };

  return (
    <div className="inline-flex flex-col mt-1 max-w-xs">
      <a
        href={toProtectedUrl(url)}
        onClick={handleDownload}
        className="inline-flex items-center gap-2 px-3 py-2 rounded bg-[var(--bg-secondary)] text-[var(--accent)] text-sm hover:underline cursor-pointer"
      >
        📎 {displayName}
        {progress !== null && progress >= 0 && (
          <span className="text-xs text-[var(--text-muted)] ml-auto shrink-0">{progress}%</span>
        )}
      </a>
      {progress !== null && (
        <div className="h-1 rounded-full bg-white/10 overflow-hidden mt-1 mx-1">
          {progress >= 0 ? (
            <div
              className="h-full bg-[var(--accent)] rounded-full transition-[width] duration-200"
              style={{ width: `${progress}%` }}
            />
          ) : (
            <div className="h-full w-1/3 bg-[var(--accent)] rounded-full animate-[indeterminate_1.2s_ease-in-out_infinite]" />
          )}
        </div>
      )}
    </div>
  );
}

function AttachmentView({ url, onZoom }: { url: string; onZoom: (u: string) => void }) {
  if (AUDIO_RE.test(url) || url.includes('voice_')) {
    return <VoicePlayer url={url} />;
  }
  if (IMAGE_RE.test(url)) {
    return <ProtectedImage url={url} onZoom={onZoom} />;
  }
  return <ProtectedFileLink url={url} />;
}


// ---------------------------------------------------------------------------
// PollView
// ---------------------------------------------------------------------------
function PollView({ poll, messageId, chatId }: { poll: Poll; messageId: string; chatId: string }) {
  const queryClient = useQueryClient();

  const voteMutation = useMutation({
    mutationFn: ({ optionId }: { optionId: string }) =>
      pollsApi.vote(poll.id, optionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['messages', chatId] }),
  });

  const unvoteMutation = useMutation({
    mutationFn: () => pollsApi.unvote(poll.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['messages', chatId] }),
  });

  const handleOptionClick = (optionId: string) => {
    if (voteMutation.isPending || unvoteMutation.isPending) return;
    if (poll.user_voted_option_id === optionId) {
      unvoteMutation.mutate();
    } else {
      voteMutation.mutate({ optionId });
    }
  };

  const total = poll.total_votes;

  return (
    <div className="mt-2 rounded-lg border border-[var(--border-color)] overflow-hidden max-w-sm">
      <div className="px-3 pt-2.5 pb-1.5 bg-[var(--bg-secondary)]">
        <p className="text-sm font-medium text-[var(--text-primary)]">{poll.question}</p>
      </div>
      <div className="divide-y divide-[var(--border-color)]">
        {poll.options.map((opt) => {
          const pct = total > 0 ? Math.round((opt.votes_count / total) * 100) : 0;
          const isVoted = poll.user_voted_option_id === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => handleOptionClick(opt.id)}
              className="w-full text-left px-3 py-2 relative overflow-hidden hover:bg-white/5 transition-colors group"
            >
              {/* Progress bar background */}
              <div
                className={`absolute inset-y-0 left-0 transition-[width] duration-500 ${isVoted ? 'bg-[var(--accent)]/20' : 'bg-white/5'}`}
                style={{ width: `${pct}%` }}
              />
              <div className="relative flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 transition-colors ${
                    isVoted ? 'border-[var(--accent)] bg-[var(--accent)]' : 'border-[var(--text-muted)] group-hover:border-[var(--accent)]'
                  }`} />
                  <span className={`text-sm truncate ${isVoted ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)]'}`}>
                    {opt.text}
                  </span>
                </div>
                <span className="text-xs text-[var(--text-muted)] shrink-0">{pct}%</span>
              </div>
            </button>
          );
        })}
      </div>
      <div className="px-3 py-1.5 bg-[var(--bg-secondary)] text-xs text-[var(--text-muted)]">
        {total} {total === 1 ? 'голос' : total >= 2 && total <= 4 ? 'голоса' : 'голосов'}
        {poll.user_voted_option_id && (
          <button
            onClick={() => unvoteMutation.mutate()}
            className="ml-2 text-[var(--accent)] hover:underline"
          >
            Отозвать голос
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReplyBanner
// ---------------------------------------------------------------------------
function ReplyBanner({ reply, onClick }: { reply: ReplyTo; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-stretch gap-2 mb-1 text-left w-full hover:brightness-125 transition-[filter] cursor-pointer"
    >
      <div className="w-0.5 rounded bg-[var(--text-muted)] shrink-0" />
      <div className="text-xs text-[var(--text-muted)] min-w-0">
        <span className="font-medium text-[var(--text-secondary)]">{reply.author_display_name}</span>
        {reply.content && (
          <p className="mt-0.5 line-clamp-1 italic">{reply.content}</p>
        )}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// ForwardedBanner
// ---------------------------------------------------------------------------
function ForwardedBanner({ msg }: { msg: Message }) {
  if (!msg.forwarded_from) return null;
  const fwd = msg.forwarded_from;
  return (
    <div className="flex items-stretch gap-2 mt-1 mb-1">
      <div className="w-0.5 rounded bg-[var(--accent)] shrink-0" />
      <div className="text-xs text-[var(--text-muted)]">
        <span className="font-medium text-[var(--text-secondary)]">{fwd.author_display_name}</span>
        {' '}в <span className="font-medium">#{fwd.chat_name}</span>
        {fwd.content && <p className="mt-0.5 italic line-clamp-2">{fwd.content}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EditForm
// ---------------------------------------------------------------------------
function EditForm({ msg, onDone }: { msg: Message; onDone: () => void }) {
  const [value, setValue] = useState(msg.content ?? '');
  const queryClient = useQueryClient();

  const editMutation = useMutation({
    mutationFn: () => messagesApi.edit(msg.chat_id, msg.id, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', msg.chat_id] });
      onDone();
    },
  });

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); editMutation.mutate(); }
    if (e.key === 'Escape') onDone();
  };

  return (
    <div className="mt-1">
      <textarea
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKey}
        rows={2}
        className="w-full px-3 py-2 rounded bg-[var(--bg-input)] text-sm text-[var(--text-primary)] resize-none outline-none focus:ring-1 focus:ring-[var(--accent)]"
      />
      <div className="flex items-center gap-2 mt-1 text-xs text-[var(--text-muted)]">
        Enter — сохранить · Esc — отмена
        <button onClick={() => editMutation.mutate()} disabled={editMutation.isPending}
          className="ml-auto px-2 py-1 rounded bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] flex items-center gap-1 disabled:opacity-50">
          <Check size={12} /> Сохранить
        </button>
        <button onClick={onDone} className="px-2 py-1 rounded hover:bg-white/5 text-[var(--text-muted)]">
          Отмена
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MessageActions
// ---------------------------------------------------------------------------
function MessageActions({
  msg, isOwn, onEdit, onDelete, onForward, onReply,
}: {
  msg: Message; isOwn: boolean;
  onEdit: () => void; onDelete: () => void; onForward: () => void; onReply: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const text = msg.content ?? '';
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  return (
    <div className="absolute right-4 -top-4 hidden group-hover:flex items-center gap-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-md px-1 py-0.5 z-10">
      <button onClick={onReply} title="Reply"
        className="p-1.5 rounded hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
        <Reply size={14} />
      </button>
      <button onClick={handleCopy} title="Copy"
        className="p-1.5 rounded hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
        {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
      </button>
      {isOwn && (
        <button onClick={onEdit} title="Edit"
          className="p-1.5 rounded hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
          <Pencil size={14} />
        </button>
      )}
      <button onClick={onForward} title="Forward"
        className="p-1.5 rounded hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
        <Forward size={14} />
      </button>
      <button onClick={onDelete} title="Delete"
        className="p-1.5 rounded hover:bg-white/10 text-[var(--text-muted)] hover:text-red-400 transition-colors">
        <Trash2 size={14} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MessageItem
// ---------------------------------------------------------------------------
function MessageItem({
  msg, prevMsg, highlighted, onZoom, onForward, onDelete, onReply, onScrollTo,
}: {
  msg: Message; prevMsg?: Message; highlighted: boolean;
  onZoom: (url: string) => void; onForward: (msg: Message) => void;
  onDelete: (msg: Message) => void; onReply: (msg: Message) => void;
  onScrollTo: (messageId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const isOwn = msg.author_id === currentUserId;

  const sameAuthor =
    prevMsg?.author_id === msg.author_id &&
    new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime() < 5 * 60 * 1000;

  const showDateDivider =
    !prevMsg ||
    new Date(prevMsg.created_at).toDateString() !== new Date(msg.created_at).toDateString();

  const date = new Date(msg.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  const time = new Date(msg.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  return (
    <>
      {showDateDivider && (
        <div className="flex items-center gap-3 my-4 px-4">
          <div className="flex-1 h-px bg-[var(--border-color)]" />
          <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">{date}</span>
          <div className="flex-1 h-px bg-[var(--border-color)]" />
        </div>
      )}

      <div
        id={`msg-${msg.id}`}
        className={`relative flex gap-3 px-4 group rounded transition-colors duration-700 ${sameAuthor ? 'mt-0.5' : 'mt-4'} ${highlighted ? 'bg-white/10' : 'hover:bg-white/[.03]'}`}
      >
        <MessageActions
          msg={msg} isOwn={isOwn}
          onEdit={() => setEditing(true)}
          onDelete={() => onDelete(msg)}
          onForward={() => onForward(msg)}
          onReply={() => onReply(msg)}
        />

        {sameAuthor ? (
          <div className="w-9 shrink-0" />
        ) : msg.author_image_path ? (
          <img src={msg.author_image_path} alt="" className="w-9 h-9 rounded-full object-cover shrink-0 mt-0.5" />
        ) : (
          <div className="w-9 h-9 rounded-full bg-[var(--accent)] flex items-center justify-center text-white text-xs font-bold shrink-0 mt-0.5">
            {(msg.author_display_name || msg.author_username).slice(0, 2).toUpperCase()}
          </div>
        )}

        <div className="flex-1 min-w-0">
          {!sameAuthor && (
            <div className="flex items-baseline gap-2 mb-0.5">
              <span className="font-medium text-[var(--text-primary)] text-sm">
                {msg.author_display_name || msg.author_username}
              </span>
              <span className="text-xs text-[var(--text-muted)]">{time}</span>
            </div>
          )}

          {msg.reply_to && (
            <ReplyBanner reply={msg.reply_to} onClick={() => onScrollTo(msg.reply_to!.message_id)} />
          )}
          <ForwardedBanner msg={msg} />

          {editing ? (
            <EditForm msg={msg} onDone={() => setEditing(false)} />
          ) : (
            <>
              {msg.content && (
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed break-words whitespace-pre-wrap">
                  {renderContent(msg.content)}
                  {msg.is_edited && (
                    <span className="ml-1 text-xs text-[var(--text-muted)]">(изм.)</span>
                  )}
                </p>
              )}
              {msg.poll && (
                <PollView poll={msg.poll} messageId={msg.id} chatId={msg.chat_id} />
              )}
              {msg.attachments.length > 0 && (
                <div className="flex flex-col gap-1 mt-1">
                  {msg.attachments.map((url) => (
                    <AttachmentView key={url} url={url} onZoom={onZoom} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {sameAuthor && !editing && (
          <span className="text-xs text-[var(--text-muted)] opacity-0 group-hover:opacity-100 self-center shrink-0 transition-opacity">
            {time}
          </span>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// MessageList
// ---------------------------------------------------------------------------
interface MessageListProps {
  chatId: string;
  onReply: (msg: Message) => void;
}

export interface MessageListHandle {
  jumpTo: (msgId: string, createdAt: string) => void;
}

export const MessageList = forwardRef<MessageListHandle, MessageListProps>(
function MessageList({ chatId, onReply }, ref) {
  const queryClient = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [forwardMsg, setForwardMsg] = useState<Message | null>(null);
  const [olderMessages, setOlderMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  useEffect(() => {
    setOlderMessages([]);
    setHasMore(true);
  }, [chatId]);

  const { data: latest = [], isLoading } = useQuery({
    queryKey: ['messages', chatId],
    queryFn: () => messagesApi.list(chatId, undefined, undefined, PAGE),
    staleTime: 60_000,
  });

  const messages = useMemo(() => {
    const latestIds = new Set(latest.map((m) => m.id));
    return [...olderMessages.filter((m) => !latestIds.has(m.id)), ...latest];
  }, [olderMessages, latest]);

  const oldestCursor = messages[0]?.created_at;

  const loadMore = async () => {
    if (!oldestCursor || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const older = await messagesApi.list(chatId, oldestCursor, undefined, PAGE);
      if (older.length < PAGE) setHasMore(false);
      setOlderMessages((prev) => [...older, ...prev]);
    } finally {
      setLoadingMore(false);
    }
  };

  const prevLenRef = useRef(0);
  useEffect(() => {
    if (latest.length > prevLenRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevLenRef.current = latest.length;
  }, [latest.length]);

  useEffect(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView(), 0);
  }, [chatId]);

  const handleDelete = useCallback((msg: Message) => {
    if (!confirm('Удалить сообщение?')) return;
    messagesApi.delete(msg.chat_id, msg.id).then(() => {
      queryClient.invalidateQueries({ queryKey: ['messages', chatId] });
      setOlderMessages((prev) => prev.filter((m) => m.id !== msg.id));
    });
  }, [chatId, queryClient]);

  const handleZoom = useCallback((url: string) => setLightboxUrl(url), []);
  const handleForward = useCallback((msg: Message) => setForwardMsg(msg), []);
  const handleReply = useCallback((msg: Message) => onReply(msg), [onReply]);

  const handleScrollTo = useCallback((messageId: string) => {
    const el = document.getElementById(`msg-${messageId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightId(messageId);
    setTimeout(() => setHighlightId(null), 1500);
  }, []);

  const scrollAndHighlight = useCallback((msgId: string) => {
    const el = document.getElementById(`msg-${msgId}`);
    if (!el) return false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightId(msgId);
    setTimeout(() => setHighlightId(null), 1800);
    return true;
  }, []);

  useImperativeHandle(ref, () => ({
    jumpTo: async (msgId: string, createdAt: string) => {
      // Сообщение уже в DOM — просто скроллим
      if (scrollAndHighlight(msgId)) return;

      // Не в DOM — грузим батч, в котором должно быть это сообщение.
      // before = created_at + 1ms даёт PAGE сообщений, заканчивающихся на target.
      const justAfter = new Date(new Date(createdAt).getTime() + 1).toISOString();
      try {
        const batch = await messagesApi.list(chatId, justAfter, undefined, PAGE);
        setOlderMessages(batch);
        setHasMore(batch.length >= PAGE);
      } catch {
        return;
      }

      // Ждём рендер, потом скроллим
      setTimeout(() => scrollAndHighlight(msgId), 120);
    },
  }), [chatId, scrollAndHighlight]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-muted)] text-sm">
        Загрузка сообщений…
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto py-2">
        {messages.length > 0 && (
          <div className="flex justify-center my-2">
            {hasMore ? (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="px-4 py-1.5 rounded text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {loadingMore ? (
                  <><div className="w-3 h-3 rounded-full border border-[var(--text-muted)] border-t-transparent animate-spin" /> Загрузка…</>
                ) : (
                  <><CornerUpLeft size={12} /> Загрузить старые сообщения</>
                )}
              </button>
            ) : (
              <p className="text-xs text-[var(--text-muted)]">Начало истории</p>
            )}
          </div>
        )}

        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-[var(--text-muted)]">
            <span className="text-4xl">💬</span>
            <p className="text-sm">Здесь пока нет сообщений. Напиши первым!</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageItem
            key={msg.id}
            msg={msg}
            prevMsg={messages[i - 1]}
            highlighted={highlightId === msg.id}
            onZoom={handleZoom}
            onForward={handleForward}
            onDelete={handleDelete}
            onReply={handleReply}
            onScrollTo={handleScrollTo}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {lightboxUrl && <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
      {forwardMsg && <ForwardModal message={forwardMsg} onClose={() => setForwardMsg(null)} />}
    </>
  );
});
MessageList.displayName = 'MessageList';
