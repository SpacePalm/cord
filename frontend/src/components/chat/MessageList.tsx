import { useEffect, useRef, useState, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Pencil, Trash2, Forward, Check, CornerUpLeft, Reply, Play, Pause, Copy, Pin, CheckSquare, MoreHorizontal, Smile } from 'lucide-react';
import { messagesApi } from '../../api/messages';
import { pollsApi } from '../../api/polls';
import { useAuthStore } from '../../store/authStore';
import { ForwardModal } from './ForwardModal';
import { renderContent, Spoiler as _Spoiler } from '../../utils/renderContent';
import { EMOJI_TABS } from './ChatInput';
import { useProtectedUrl, toProtectedUrl } from '../../hooks/useProtectedUrl';
import type { Message, ReplyTo, Poll } from '../../types';
import { useT, useLocale } from '../../i18n';
import { useUserActionsPopover } from '../UserActionsPopover';


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
    if (!el || !el.duration || !isFinite(el.duration)) return;
    setCurrentTime(el.currentTime);
    setProgress((el.currentTime / el.duration) * 100);
  };

  const handleLoadedMetadata = () => {
    const el = audioRef.current;
    if (!el) return;
    if (isFinite(el.duration)) {
      setDuration(el.duration);
    } else {
      // WebM на некоторых браузерах возвращает Infinity — прокручиваем до конца чтобы узнать длину
      el.currentTime = 1e10;
      el.addEventListener('timeupdate', function fix() {
        if (isFinite(el.duration)) {
          setDuration(el.duration);
          el.currentTime = 0;
          el.removeEventListener('timeupdate', fix);
        }
      });
    }
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
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        onLoadedMetadata={handleLoadedMetadata}
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
const AUDIO_RE = /\.(webm|ogg|mp3|wav|m4a|mp4|aac|opus)$/i;
const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg)$/i;

function ProtectedImage({ url, onZoom }: { url: string; onZoom: (u: string) => void }) {
  const src = useProtectedUrl(toProtectedUrl(url));
  if (!src) {
    return <div className="mt-1 h-32 w-48 rounded bg-white/5 animate-pulse" />;
  }
  return (
    <button onClick={() => onZoom(src)} className="block mt-1 rounded overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
      <img src={src} alt="вложение" loading="lazy" className="max-h-64 max-w-sm rounded object-cover hover:brightness-90 transition-[filter] cursor-zoom-in" />
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
// LinkEmbed — OpenGraph preview card
// ---------------------------------------------------------------------------
function LinkEmbed({ embed }: { embed: { url: string; title: string; description: string; image: string | null; site_name: string | null } }) {
  return (
    <a
      href={embed.url}
      target="_blank"
      rel="noreferrer noopener"
      className="flex gap-3 mt-1 p-2.5 rounded-lg bg-[var(--bg-secondary)] border-l-2 border-[var(--accent)] hover:bg-[var(--bg-input)] transition-colors max-w-md overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex-1 min-w-0">
        {embed.site_name && (
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide mb-0.5">{embed.site_name}</p>
        )}
        <p className="text-sm font-medium text-[var(--accent)] truncate">{embed.title}</p>
        {embed.description && (
          <p className="text-xs text-[var(--text-secondary)] mt-0.5 line-clamp-2">{embed.description}</p>
        )}
      </div>
      {embed.image && (
        <img src={embed.image} alt="" loading="lazy" className="w-16 h-16 rounded object-cover shrink-0" />
      )}
    </a>
  );
}

// ---------------------------------------------------------------------------
// Popup — portal-based dropdown that auto-flips up/down
function Popup({ anchorRef, children, onClose, width = 280 }: {
  anchorRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  onClose: () => void;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ position: 'fixed', opacity: 0 });

  useEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const popupH = 220; // approximate height
    const openUp = spaceBelow < popupH && rect.top > popupH;

    setStyle({
      position: 'fixed',
      right: Math.max(4, window.innerWidth - rect.right),
      ...(openUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      width,
      opacity: 1,
    });
  }, [anchorRef, width]);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [onClose]);

  return createPortal(
    <div ref={ref} style={style}
      className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-xl z-50">
      {children}
    </div>,
    document.body,
  );
}

// ReactionPicker — tabbed emoji picker (same layout as ChatInput)
function ReactionPicker({ anchorRef, onSelect, onClose }: {
  anchorRef: React.RefObject<HTMLElement | null>;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState(0);

  return (
    <Popup anchorRef={anchorRef} onClose={onClose} width={280}>
      <div className="flex border-b border-[var(--border-color)]">
        {EMOJI_TABS.map((t, i) => (
          <button key={i} onClick={() => setTab(i)}
            className={`flex-1 py-1.5 text-sm transition-colors ${tab === i ? 'bg-white/10' : 'hover:bg-white/5'}`}>
            {t.icon}
          </button>
        ))}
      </div>
      <div className="h-40 overflow-y-auto p-1.5">
        <div className="grid grid-cols-8 gap-0.5">
          {EMOJI_TABS[tab].emojis.map((e) => (
            <button key={e} onClick={() => { onSelect(e); onClose(); }}
              className="w-8 h-8 rounded hover:bg-white/10 text-lg flex items-center justify-center">
              {e}
            </button>
          ))}
        </div>
      </div>
    </Popup>
  );
}

// ReactionBar — grouped reactions below a message
function ReactionBar({ msg, onReact }: { msg: Message; onReact: (emoji: string) => void }) {
  const currentUserId = useAuthStore((s) => s.user?.id);
  if (!msg.reactions || msg.reactions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {msg.reactions.map((group) => {
        const isMine = group.users.some((u) => u.user_id === currentUserId);
        return (
          <button
            key={group.emoji}
            onClick={() => onReact(group.emoji)}
            className={`group/reaction relative flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs border transition-colors ${
              isMine
                ? 'bg-[var(--accent)]/15 border-[var(--accent)]/40 text-[var(--accent)]'
                : 'bg-white/5 border-[var(--border-color)] text-[var(--text-muted)] hover:border-[var(--accent)]/40'
            }`}
          >
            <span>{group.emoji}</span>
            <span className="font-medium">{group.users.length}</span>
            {/* Avatars tooltip on hover */}
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/reaction:flex flex-col items-center pointer-events-none z-40">
              <div className="flex items-center gap-0.5 px-2 py-1 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)] shadow-lg">
                {group.users.slice(0, 8).map((u) => (
                  u.image_path ? (
                    <img key={u.user_id} src={u.image_path} alt={u.display_name}
                      className="w-5 h-5 rounded-full object-cover" title={u.display_name} />
                  ) : (
                    <div key={u.user_id} title={u.display_name}
                      className="w-5 h-5 rounded-full bg-[var(--accent)] flex items-center justify-center text-white text-[8px] font-bold">
                      {u.display_name.slice(0, 1).toUpperCase()}
                    </div>
                  )
                ))}
                {group.users.length > 8 && (
                  <span className="text-[10px] text-[var(--text-muted)] ml-0.5">+{group.users.length - 8}</span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MessageContextMenu — открывается по ПКМ, позиционируется у курсора
// ---------------------------------------------------------------------------
function MessageContextMenu({
  x, y, msg, isOwn, onEdit, onDelete, onForward, onReply, onPin, onSelect, onReact, onClose,
}: {
  x: number; y: number; msg: Message; isOwn: boolean;
  onEdit: () => void; onDelete: () => void; onForward: () => void; onReply: () => void; onPin: () => void;
  onSelect: () => void; onReact: (emoji: string) => void; onClose: () => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const reactBtnRef = useRef<HTMLButtonElement>(null);
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties>({ position: 'fixed', left: x, top: y, opacity: 0 });

  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    const left = x + w > window.innerWidth - 4 ? Math.max(4, window.innerWidth - w - 4) : x;
    const top = y + h > window.innerHeight - 4 ? Math.max(4, y - h) : y;
    setStyle({ position: 'fixed', left, top, opacity: 1 });
  }, [x, y]);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);

  const handleCopy = () => {
    navigator.clipboard.writeText(msg.content ?? '').catch(() => {});
    onClose();
  };

  const menuItem = 'flex items-center gap-2 w-full px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-white/10 hover:text-[var(--text-primary)] transition-colors';
  const menuItemDanger = 'flex items-center gap-2 w-full px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--danger)]/15 hover:text-red-400 transition-colors';

  return createPortal(
    <div ref={ref} style={style}
      className="min-w-[180px] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-xl z-50 py-1"
      onContextMenu={(e) => e.preventDefault()}
    >
      <button ref={reactBtnRef} onClick={() => setReactionPickerOpen((v) => !v)} className={menuItem}>
        <Smile size={14} /> {t('chat.react')}
      </button>
      {reactionPickerOpen && (
        <ReactionPicker
          anchorRef={reactBtnRef}
          onSelect={(emoji) => { onReact(emoji); onClose(); }}
          onClose={() => setReactionPickerOpen(false)}
        />
      )}
      <button onClick={() => { onReply(); onClose(); }} className={menuItem}>
        <Reply size={14} /> {t('chat.reply')}
      </button>
      {isOwn && (
        <button onClick={() => { onEdit(); onClose(); }} className={menuItem}>
          <Pencil size={14} /> {t('chat.edit')}
        </button>
      )}
      <button onClick={handleCopy} className={menuItem}>
        <Copy size={14} /> {t('chat.copy')}
      </button>
      <button onClick={() => { onPin(); onClose(); }} className={menuItem}>
        <Pin size={14} className={msg.is_pinned ? 'text-yellow-400' : ''} />
        {msg.is_pinned ? t('chat.unpin') : t('chat.pin')}
      </button>
      <button onClick={() => { onForward(); onClose(); }} className={menuItem}>
        <Forward size={14} /> {t('chat.forwardBtn')}
      </button>
      <button onClick={() => { onSelect(); onClose(); }} className={menuItem}>
        <CheckSquare size={14} /> {t('chat.select')}
      </button>
      <div className="h-px bg-[var(--border-color)] my-1" />
      <button onClick={() => { onDelete(); onClose(); }} className={menuItemDanger}>
        <Trash2 size={14} /> {t('chat.delete')}
      </button>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// MessageActions
// ---------------------------------------------------------------------------
function MessageActions({
  msg, isOwn, onEdit, onDelete, onForward, onReply, onPin, onSelect, onReact,
}: {
  msg: Message; isOwn: boolean;
  onEdit: () => void; onDelete: () => void; onForward: () => void; onReply: () => void; onPin: () => void;
  onSelect: () => void; onReact: (emoji: string) => void;
}) {
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const reactBtnRef = useRef<HTMLButtonElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);

  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(msg.content ?? '').catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const menuItem = 'flex items-center gap-2 w-full px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-white/10 hover:text-[var(--text-primary)] transition-colors';
  const canCopy = !!msg.content;

  return (
    <div className="absolute right-4 -top-4 hidden group-hover:flex items-center gap-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-md px-1 py-0.5 z-10">
      <button ref={reactBtnRef} onClick={() => setReactionPickerOpen((v) => !v)} title={t('chat.react')}
        className="p-1.5 rounded hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
        <Smile size={14} />
      </button>
      {reactionPickerOpen && (
        <ReactionPicker
          anchorRef={reactBtnRef}
          onSelect={(emoji) => { onReact(emoji); setReactionPickerOpen(false); }}
          onClose={() => setReactionPickerOpen(false)}
        />
      )}
      <button onClick={onReply} title={t('chat.reply')}
        className="p-1.5 rounded hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
        <Reply size={14} />
      </button>
      {isOwn && (
        <button onClick={onEdit} title={t('chat.edit')}
          className="p-1.5 rounded hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
          <Pencil size={14} />
        </button>
      )}
      {canCopy && (
        <button onClick={handleCopy} title={t('chat.copy')}
          className="p-1.5 rounded hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
          {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
        </button>
      )}
      <button onClick={onDelete} title={t('chat.delete')}
        className="p-1.5 rounded hover:bg-white/10 text-[var(--text-muted)] hover:text-red-400 transition-colors">
        <Trash2 size={14} />
      </button>
      <button ref={moreBtnRef} onClick={() => setMenuOpen((v) => !v)} title={t('chat.more')}
        className="p-1.5 rounded hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
        <MoreHorizontal size={14} />
      </button>
      {menuOpen && (
        <Popup anchorRef={moreBtnRef} onClose={() => setMenuOpen(false)} width={176}>
          <div className="py-1">
            <button onClick={() => { onPin(); setMenuOpen(false); }} className={menuItem}>
              <Pin size={14} className={msg.is_pinned ? 'text-yellow-400' : ''} />
              {msg.is_pinned ? t('chat.unpin') : t('chat.pin')}
            </button>
            <button onClick={() => { onForward(); setMenuOpen(false); }} className={menuItem}>
              <Forward size={14} /> {t('chat.forwardBtn')}
            </button>
            <button onClick={() => { onSelect(); setMenuOpen(false); }} className={menuItem}>
              <CheckSquare size={14} /> {t('chat.select')}
            </button>
          </div>
        </Popup>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MessageItem
// ---------------------------------------------------------------------------
function MessageItem({
  msg, prevMsg, highlighted, onZoom, onForward, onDelete, onReply, onScrollTo, onPin,
  selecting, selected, onToggleSelect, onReact,
}: {
  msg: Message; prevMsg?: Message; highlighted: boolean;
  onZoom: (url: string) => void; onForward: (msg: Message) => void;
  onDelete: (msg: Message) => void; onReply: (msg: Message) => void;
  onScrollTo: (messageId: string) => void; onPin: (msg: Message) => void;
  selecting: boolean; selected: boolean; onToggleSelect: (msg: Message) => void;
  onReact: (msg: Message, emoji: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const locale = useLocale();
  const isOwn = msg.author_id === currentUserId;
  const userActions = useUserActionsPopover();

  const openAuthorMenu = (e: React.MouseEvent) => {
    userActions.openAt({
      id: msg.author_id,
      username: msg.author_username,
      display_name: msg.author_display_name || msg.author_username,
      image_path: msg.author_image_path,
    }, e);
  };

  const sameAuthor =
    prevMsg?.author_id === msg.author_id &&
    new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime() < 5 * 60 * 1000;

  const showDateDivider =
    !prevMsg ||
    new Date(prevMsg.created_at).toDateString() !== new Date(msg.created_at).toDateString();

  const date = new Date(msg.created_at).toLocaleDateString(locale, { day: 'numeric', month: 'long' });
  const time = new Date(msg.created_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

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
        onClick={selecting ? () => onToggleSelect(msg) : undefined}
        onContextMenu={(e) => {
          if (selecting || editing) return;
          e.preventDefault();
          setCtxMenu({ x: e.clientX, y: e.clientY });
        }}
        className={`relative flex gap-3 px-4 group rounded transition-colors duration-700 ${sameAuthor ? 'mt-0.5' : 'mt-4'} ${selecting ? 'cursor-pointer' : ''} ${selected ? 'bg-[var(--accent)]/10' : highlighted ? 'bg-white/10' : 'hover:bg-white/[.03]'}`}
      >
        {selecting && (
          <div className="flex items-center shrink-0 self-center">
            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${selected ? 'bg-[var(--accent)] border-[var(--accent)]' : 'border-[var(--text-muted)]'}`}>
              {selected && <Check size={12} className="text-white" />}
            </div>
          </div>
        )}
        {!selecting && (
          <MessageActions
            msg={msg} isOwn={isOwn}
            onEdit={() => setEditing(true)}
            onDelete={() => onDelete(msg)}
            onForward={() => onForward(msg)}
            onReply={() => onReply(msg)}
            onPin={() => onPin(msg)}
            onSelect={() => onToggleSelect(msg)}
            onReact={(emoji) => onReact(msg, emoji)}
          />
        )}

        {sameAuthor ? (
          <div className="w-9 shrink-0" />
        ) : (
          <button
            type="button"
            onClick={openAuthorMenu}
            className="shrink-0 mt-0.5 rounded-full hover:ring-2 hover:ring-[var(--accent)] transition-all"
            title={msg.author_display_name || msg.author_username}
          >
            {msg.author_image_path ? (
              <img src={msg.author_image_path} alt="" className="w-9 h-9 rounded-full object-cover" />
            ) : (
              <div className="w-9 h-9 rounded-full bg-[var(--accent)] flex items-center justify-center text-white text-xs font-bold">
                {(msg.author_display_name || msg.author_username).slice(0, 2).toUpperCase()}
              </div>
            )}
          </button>
        )}

        <div className="flex-1 min-w-0">
          {!sameAuthor && (
            <div className="flex items-baseline gap-2 mb-0.5">
              <button
                type="button"
                onClick={openAuthorMenu}
                className="font-medium text-[var(--text-primary)] text-sm hover:underline"
              >
                {msg.author_display_name || msg.author_username}
              </button>
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
                <div className="text-sm text-[var(--text-secondary)] leading-relaxed break-words whitespace-pre-wrap">
                  {renderContent(msg.content)}
                  {msg.is_edited && (
                    <span className="ml-1 text-xs text-[var(--text-muted)]">(изм.)</span>
                  )}
                  {msg.is_pinned && (
                    <Pin size={10} className="inline ml-1 text-yellow-400" />
                  )}
                </div>
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
              {msg.embeds && msg.embeds.length > 0 && (
                <div className="flex flex-col gap-1">
                  {msg.embeds.map((embed, i) => (
                    <LinkEmbed key={i} embed={embed} />
                  ))}
                </div>
              )}
              <ReactionBar msg={msg} onReact={(emoji) => onReact(msg, emoji)} />
            </>
          )}
        </div>

        {sameAuthor && !editing && (
          <span className="text-xs text-[var(--text-muted)] opacity-0 group-hover:opacity-100 self-center shrink-0 transition-opacity">
            {time}
          </span>
        )}
      </div>
      {ctxMenu && (
        <MessageContextMenu
          x={ctxMenu.x} y={ctxMenu.y} msg={msg} isOwn={isOwn}
          onEdit={() => setEditing(true)}
          onDelete={() => onDelete(msg)}
          onForward={() => onForward(msg)}
          onReply={() => onReply(msg)}
          onPin={() => onPin(msg)}
          onSelect={() => onToggleSelect(msg)}
          onReact={(emoji) => onReact(msg, emoji)}
          onClose={() => setCtxMenu(null)}
        />
      )}
      {userActions.element}
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
  const t = useT();
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [forwardMsgs, setForwardMsgs] = useState<Message[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selecting = selectedIds.size > 0;
  const [olderMessages, setOlderMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [jumped, setJumped] = useState(false);
  const [hasNewer, setHasNewer] = useState(false);
  const [loadingNewer, setLoadingNewer] = useState(false);

  useEffect(() => {
    setOlderMessages([]);
    setHasMore(true);
    setHasNewer(false);
    setJumped(false);
  }, [chatId]);

  const { data: latest = [], isLoading } = useQuery({
    queryKey: ['messages', chatId],
    queryFn: () => messagesApi.list(chatId, undefined, undefined, PAGE),
    staleTime: 60_000,
  });

  const messages = useMemo(() => {
    if (jumped) return olderMessages;
    const latestIds = new Set(latest.map((m) => m.id));
    return [...olderMessages.filter((m) => !latestIds.has(m.id)), ...latest];
  }, [olderMessages, latest, jumped]);

  const oldestCursor = messages[0]?.created_at;
  const newestCursor = jumped ? messages[messages.length - 1]?.created_at : null;

  const loadMore = useCallback(async () => {
    if (!oldestCursor || loadingMore || !hasMore) return;
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    const prevTop = el?.scrollTop ?? 0;
    setLoadingMore(true);
    try {
      const older = await messagesApi.list(chatId, oldestCursor, undefined, PAGE);
      if (older.length < PAGE) setHasMore(false);
      setOlderMessages((prev) => [...older, ...prev]);
      // После рендера — восстановить позицию скролла
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight + prevTop;
      });
    } finally {
      setLoadingMore(false);
    }
  }, [oldestCursor, loadingMore, hasMore, chatId]);

  const loadNewer = useCallback(async () => {
    if (!newestCursor || loadingNewer) return;
    setLoadingNewer(true);
    try {
      const newer = await messagesApi.list(chatId, undefined, newestCursor, PAGE);
      if (newer.length < PAGE) {
        setJumped(false);
        setHasNewer(false);
      }
      setOlderMessages((prev) => [...prev, ...newer]);
    } finally {
      setLoadingNewer(false);
    }
  }, [newestCursor, loadingNewer, chatId]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Подгрузка старых — скролл близко к верху
    if (el.scrollTop < 100 && hasMore && !loadingMore) {
      loadMore();
    }
    // Подгрузка новых — скролл близко к низу (только в jumped-режиме)
    if (jumped && hasNewer && !loadingNewer) {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distFromBottom < 100) {
        loadNewer();
      }
    }
  }, [hasMore, loadingMore, loadMore, jumped, hasNewer, loadingNewer, loadNewer]);

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
    if (!confirm(t('chat.deleteConfirm'))) return;
    messagesApi.delete(msg.chat_id, msg.id).then(() => {
      queryClient.invalidateQueries({ queryKey: ['messages', chatId] });
      setOlderMessages((prev) => prev.filter((m) => m.id !== msg.id));
    });
  }, [chatId, queryClient]);

  const handleZoom = useCallback((url: string) => setLightboxUrl(url), []);
  const handleForward = useCallback((msg: Message) => setForwardMsgs([msg]), []);
  const handleReply = useCallback((msg: Message) => onReply(msg), [onReply]);

  const handleToggleSelect = useCallback((msg: Message) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(msg.id)) next.delete(msg.id);
      else next.add(msg.id);
      return next;
    });
  }, []);

  const handleCancelSelection = useCallback(() => setSelectedIds(new Set()), []);

  const handleBulkDelete = useCallback(() => {
    const count = selectedIds.size;
    if (!confirm(t('chat.deleteSelectedConfirm', { count: String(count) }))) return;
    messagesApi.deleteBulk(chatId, Array.from(selectedIds)).then(() => {
      queryClient.invalidateQueries({ queryKey: ['messages', chatId] });
      setOlderMessages((prev) => prev.filter((m) => !selectedIds.has(m.id)));
      setSelectedIds(new Set());
    });
  }, [selectedIds, chatId, queryClient, t]);

  const handleBulkForward = useCallback(() => {
    const selected = messages.filter((m) => selectedIds.has(m.id));
    setForwardMsgs(selected);
  }, [selectedIds, messages]);
  const handleReact = useCallback((msg: Message, emoji: string) => {
    messagesApi.react(msg.chat_id, msg.id, emoji).then(() => {
      queryClient.invalidateQueries({ queryKey: ['messages', chatId] });
    });
  }, [chatId, queryClient]);

  const handlePin = useCallback((msg: Message) => {
    const fn = msg.is_pinned ? messagesApi.unpin : messagesApi.pin;
    fn(msg.chat_id, msg.id).then(() => {
      queryClient.invalidateQueries({ queryKey: ['messages', chatId] });
      queryClient.invalidateQueries({ queryKey: ['pinned', chatId] });
    });
  }, [chatId, queryClient]);

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

  const jumpToLatest = useCallback(() => {
    setOlderMessages([]);
    setHasMore(true);
    setJumped(false);
    queryClient.invalidateQueries({ queryKey: ['messages', chatId] });
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 150);
  }, [chatId, queryClient]);

  useImperativeHandle(ref, () => ({
    jumpTo: async (msgId: string, createdAt: string) => {
      // Сообщение уже в DOM — просто скроллим
      if (scrollAndHighlight(msgId)) return;

      // Загружаем сообщения вокруг целевого: PAGE/2 до и PAGE/2 после
      const targetTime = new Date(createdAt).getTime();
      const justAfter = new Date(targetTime + 1).toISOString();
      try {
        const before = await messagesApi.list(chatId, justAfter, undefined, PAGE);
        const after = await messagesApi.list(chatId, undefined, createdAt, PAGE);
        // before возвращает в хронологическом порядке, after тоже
        const combined = [...before, ...after.filter((m) => !before.some((b) => b.id === m.id))];
        setOlderMessages(combined);
        setHasMore(before.length >= PAGE);
        setHasNewer(true);
        setJumped(true);
      } catch {
        return;
      }

      setTimeout(() => scrollAndHighlight(msgId), 150);
    },
  }), [chatId, scrollAndHighlight]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-muted)] text-sm">
        {t('chat.loading')}
      </div>
    );
  }

  return (
    <>
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto py-2">
        {messages.length > 0 && (
          <div className="flex justify-center my-2">
            {loadingMore ? (
              <div className="w-4 h-4 rounded-full border-2 border-[var(--text-muted)] border-t-transparent animate-spin" />
            ) : !hasMore ? (
              <p className="text-xs text-[var(--text-muted)]">{t('chat.historyStart')}</p>
            ) : null}
          </div>
        )}

        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-[var(--text-muted)]">
            <span className="text-4xl">💬</span>
            <p className="text-sm">{t('chat.empty')}</p>
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
            onPin={handlePin}
            selecting={selecting}
            selected={selectedIds.has(msg.id)}
            onToggleSelect={handleToggleSelect}
            onReact={handleReact}
          />
        ))}
        {loadingNewer && (
          <div className="flex justify-center my-2">
            <div className="w-4 h-4 rounded-full border-2 border-[var(--text-muted)] border-t-transparent animate-spin" />
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      {jumped && (
        <div className="shrink-0 flex justify-center py-2 border-t border-[var(--border-color)]">
          <button
            onClick={jumpToLatest}
            className="px-4 py-1.5 rounded-full text-xs font-medium bg-[var(--accent)] text-[var(--accent-text)] hover:opacity-90 transition-opacity"
          >
            ↓ {t('chat.jumpToLatest')}
          </button>
        </div>
      )}

      {selecting && (
        <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-t border-[var(--border-color)] bg-[var(--bg-secondary)]">
          <span className="text-sm text-[var(--text-secondary)]">
            {t('chat.selected', { count: String(selectedIds.size) })}
          </span>
          <div className="flex-1" />
          <button
            onClick={handleBulkForward}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm bg-[var(--accent)] text-[var(--accent-text)] hover:bg-[var(--accent-hover)] transition-colors"
          >
            <Forward size={14} />
            {t('chat.forwardBtn')}
          </button>
          <button
            onClick={handleBulkDelete}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm bg-red-500/80 text-white hover:bg-red-500 transition-colors"
          >
            <Trash2 size={14} />
            {t('chat.deleteSelected')}
          </button>
          <button
            onClick={handleCancelSelection}
            className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {lightboxUrl && <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
      {forwardMsgs.length > 0 && (
        <ForwardModal
          messages={forwardMsgs}
          onClose={() => { setForwardMsgs([]); setSelectedIds(new Set()); }}
        />
      )}
    </>
  );
});
MessageList.displayName = 'MessageList';
