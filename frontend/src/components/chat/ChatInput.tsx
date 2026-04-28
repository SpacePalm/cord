// ChatInput — message input field.
//
// Features:
//  - Draft: text is preserved when switching channels (sessionStore.drafts)
//  - Attachments: files can be attached, preview shown immediately
//  - Enter to send, Shift+Enter for new line
//  - Textarea auto-resizes to fit content
//  - Formatting: B / I / || buttons for bold/italic/spoiler
//  - Voice messages: microphone recording button
//  - Polls: poll creation form with question and options

import { useRef, useEffect, useCallback, useState, useMemo, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Paperclip, X, FileText, Send, CornerUpLeft, Mic, MicOff, BarChart2, Plus, Trash2, Code } from 'lucide-react';
import { useSessionStore } from '../../store/sessionStore';
import { useAuthStore } from '../../store/authStore';
import { renderContent, hasFormatting } from '../../utils/renderContent';
import type { Message, Member } from '../../types';
import { useT } from '../../i18n';
import { useQuery } from '@tanstack/react-query';
import { groupsApi } from '../../api/groups';

interface PollDraft {
  question: string;
  options: string[];
}

interface ChatInputProps {
  channelId: string;
  channelName: string;
  /** ID группы, в которой находится канал — нужен для автокомплита @упоминаний. */
  groupId?: string;
  replyTo?: Message | null;
  onClearReply?: () => void;
  onFocus?: () => void;
  onTyping?: () => void;
  onStopTyping?: () => void;
  /** ↑ при пустом инпуте — попросить родителя включить редактирование последнего своего сообщения. */
  onEditLast?: () => void;
  onSend: (
    text: string,
    attachments: File[],
    replyToId?: string,
    poll?: { question: string; options: string[] },
    onProgress?: (pct: number) => void,
  ) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentPreview({ file, onRemove }: { file: File; onRemove: () => void }) {
  const t = useT();
  const isImage = file.type.startsWith('image/');
  const isAudio = file.type.startsWith('audio/') || file.name.startsWith('voice_');
  const previewUrl = isImage ? URL.createObjectURL(file) : null;

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  return (
    <div className="relative group shrink-0">
      {isImage && previewUrl ? (
        <div className="h-20 w-20 rounded overflow-hidden relative">
          <img src={previewUrl} alt={file.name} className="w-full h-full object-cover" />
          <div className="absolute inset-x-0 bottom-0 bg-black/60 px-1 py-0.5">
            <p className="text-[9px] text-white truncate leading-tight">{file.name}</p>
          </div>
        </div>
      ) : isAudio ? (
        <div className="h-16 w-36 flex items-center gap-2 px-3 bg-[var(--bg-primary)] rounded">
          <Mic size={20} className="text-[var(--accent)] shrink-0" />
          <div className="min-w-0">
            <p className="text-xs text-[var(--text-primary)] truncate font-medium">{t('chat.voiceLabel')}</p>
            <p className="text-xs text-[var(--text-muted)]">{formatFileSize(file.size)}</p>
          </div>
        </div>
      ) : (
        <div className="h-16 w-36 flex items-center gap-2 px-3 bg-[var(--bg-primary)] rounded">
          <FileText size={24} className="text-[var(--accent)] shrink-0" />
          <div className="min-w-0">
            <p className="text-xs text-[var(--text-primary)] truncate font-medium">{file.name}</p>
            <p className="text-xs text-[var(--text-muted)]">{formatFileSize(file.size)}</p>
          </div>
        </div>
      )}
      <button
        onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[var(--danger)] text-white
                   flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        title={t('chat.remove')}
      >
        <X size={12} />
      </button>
    </div>
  );
}

function ToolbarDropdown({ icon, title, items, anchorRef: _ignore }: {
  icon: React.ReactNode; title: string;
  items: { label: string; shortcut: string; action: () => void }[];
  anchorRef: RefObject<HTMLElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ bottom: number; left: number } | null>(null);

  useEffect(() => {
    if (open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ bottom: window.innerHeight - rect.top + 4, left: rect.left });
    }
  }, [open]);

  return (
    <>
      <button ref={btnRef} type="button" onClick={() => setOpen((v) => !v)} title={title}
        className={`p-1.5 rounded transition-colors ${open ? 'text-[var(--text-primary)] bg-white/10' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10'}`}
      >{icon}</button>
      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-50" onClick={() => setOpen(false)} />
          <div className="fixed z-50 w-44 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-xl py-1"
            style={{ bottom: pos.bottom, left: pos.left }}>
            {items.map((item) => (
              <button key={item.label} onClick={() => { item.action(); setOpen(false); }}
                className="w-full flex items-center justify-between px-3 py-1.5 text-xs hover:bg-white/5 transition-colors text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                <span>{item.label}</span>
                <span className="text-[var(--text-muted)] font-mono text-[10px]">{item.shortcut}</span>
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

const CODE_LANGS = [
  { value: 'js', label: 'JavaScript' },
  { value: 'ts', label: 'TypeScript' },
  { value: 'py', label: 'Python' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'json', label: 'JSON' },
  { value: 'bash', label: 'Bash' },
  { value: 'sql', label: 'SQL' },
  { value: 'java', label: 'Java' },
  { value: 'cpp', label: 'C++' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'yaml', label: 'YAML' },
  { value: '', label: 'Plain text' },
];

function CodeLangPicker({ onSelect, onClose, anchorRef }: { onSelect: (lang: string) => void; onClose: () => void; anchorRef: RefObject<HTMLElement | null> }) {
  const [pos, setPos] = useState<{ bottom: number; left: number } | null>(null);
  useEffect(() => {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setPos({ bottom: window.innerHeight - rect.top + 4, left: rect.left });
    }
  }, [anchorRef]);

  if (!pos) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-50" onClick={onClose} />
      <div className="fixed z-50 w-40 max-h-64 overflow-y-auto bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-xl py-1"
        style={{ bottom: pos.bottom, left: pos.left }}>
        {CODE_LANGS.map((lang) => (
          <button key={lang.value} onClick={() => onSelect(lang.value)}
            className="w-full text-left px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-white/5 hover:text-[var(--text-primary)] transition-colors">
            {lang.label}
          </button>
        ))}
      </div>
    </>,
    document.body,
  );
}

export const EMOJI_TABS = [
  { icon: '😀', emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😊','😇','🥰','😍','🤩','😘','😋','😛','😜','🤪','😎','🤔','🤫','🤭','🙄','😬','😏','😒','🥺','😴','😢','😭','😤','😡','🤬','😱','😰','😥','🤒','🤮','💀'] },
  { icon: '👋', emojis: ['👍','👎','👏','🙌','🤝','🙏','💪','👋','✌️','🤞','🤟','🤘','🤙','👊','✊','👌','🤌','☝️','👆','👇','👈','👉','🖕','🫶'] },
  { icon: '❤️', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','❤️‍🔥','💕','💞','💗','💖','💘','💝','♥️'] },
  { icon: '🎉', emojis: ['🎉','🎊','🔥','⭐','✨','💯','🏆','🥇','🎯','🎮','🎲','🎸','🎵','🎶','🎤','🎧','🎬','🎨','🎭'] },
  { icon: '🍕', emojis: ['🍕','🍔','🍟','🌭','🍿','🍣','🍩','🍪','🎂','🍰','🍫','🍬','☕','🍺','🍷','🥤','🧃'] },
  { icon: '✅', emojis: ['✅','❌','❓','❗','💯','⭕','🔴','🟢','🔵','🟡','⚫','⚪','▶️','⏸️','🔔','🔕','💡','📌','🔑','🔒'] },
];

function ChatEmojiPicker({ visible, onSelect, onClose, anchorRef }: { visible: boolean; onSelect: (e: string) => void; onClose: () => void; anchorRef: RefObject<HTMLElement | null> }) {
  const [tab, setTab] = useState(0);
  const [pos, setPos] = useState<{ bottom: number; left: number } | null>(null);

  useEffect(() => {
    if (visible && anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setPos({ bottom: window.innerHeight - rect.top + 4, left: rect.left });
    }
  }, [visible, anchorRef]);

  if (!visible || !pos) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-50" onClick={onClose} />
      <div className="fixed z-50 w-[280px] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-xl"
        style={{ bottom: pos.bottom, left: pos.left }}>
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
      </div>
    </>,
    document.body,
  );
}

// После этого периода бездействия шлём stop_typing, чтобы у собеседников не висел индикатор.
const TYPING_IDLE_MS = 4000;

export function ChatInput({ channelId, channelName, groupId, replyTo, onClearReply, onFocus, onTyping, onStopTyping, onEditLast, onSend }: ChatInputProps) {
  const t = useT();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const emojiBtnRef = useRef<HTMLButtonElement>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const [pollOpen, setPollOpen] = useState(false);
  const [pollDraft, setPollDraft] = useState<PollDraft>({ question: '', options: ['', ''] });
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [codeLangOpen, setCodeLangOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const codeBtnRef = useRef<HTMLButtonElement>(null);

  const selfUsername = useAuthStore((s) => s.user?.username);
  const draft = useSessionStore((s) => s.drafts[channelId] ?? '');
  const setDraft = useSessionStore((s) => s.setDraft);
  const clearDraft = useSessionStore((s) => s.clearDraft);

  const attachments = useSessionStore((s) => s.attachments[channelId]) ?? [];
  const addAttachments = useSessionStore((s) => s.addAttachments);
  const removeAttachment = useSessionStore((s) => s.removeAttachment);
  const clearAttachments = useSessionStore((s) => s.clearAttachments);

  useEffect(() => {
    if (textareaRef.current) {
      if (window.innerWidth >= 768) textareaRef.current.focus();
      adjustHeight(textareaRef.current);
    }
  }, [channelId]);

  // Reset poll when switching channels
  useEffect(() => {
    setPollOpen(false);
    setPollDraft({ question: '', options: ['', ''] });
    setMention(null);
  }, [channelId]);

  const adjustHeight = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  // ── @mention автокомплит ───────────────────────────────────────────────
  // mention.start — позиция `@` в draft; query — текст после `@` до каретки.
  // null — автокомплит выключен. Открывается при наборе `@` после пробела/начала.
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);

  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ['members', groupId],
    queryFn: () => groupsApi.getMembers(groupId!),
    enabled: !!groupId && !!mention,
    staleTime: 60_000,
  });

  // Кандидаты: префиксное совпадение по username/display_name приоритетнее substring.
  // Себя из списка убираем — упоминать самого себя бессмысленно.
  const mentionCandidates = useMemo<Member[]>(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    const filtered = members.filter((m) => {
      if (m.username === selfUsername) return false;
      if (!q) return true;
      return m.username.toLowerCase().includes(q)
          || m.display_name.toLowerCase().includes(q);
    });
    filtered.sort((a, b) => {
      const aPref = a.username.toLowerCase().startsWith(q) ? 0 : 1;
      const bPref = b.username.toLowerCase().startsWith(q) ? 0 : 1;
      if (aPref !== bPref) return aPref - bPref;
      return a.username.localeCompare(b.username);
    });
    return filtered.slice(0, 8);
  }, [members, mention, selfUsername]);

  useEffect(() => { setMentionIdx(0); }, [mention?.query]);

  // Координаты дропдауна — пересчитываются по позиции textarea при открытии/изменении.
  const [mentionPos, setMentionPos] = useState<{ bottom: number; left: number; width: number } | null>(null);
  useEffect(() => {
    if (!mention || !textareaRef.current) { setMentionPos(null); return; }
    const rect = textareaRef.current.getBoundingClientRect();
    setMentionPos({
      bottom: window.innerHeight - rect.top + 6,
      left: rect.left,
      width: Math.max(240, Math.min(rect.width, 360)),
    });
  }, [mention]);

  // Поиск активного @-токена непосредственно перед кареткой.
  // Возвращает позицию `@` и query, либо null если токена нет.
  const detectMention = (text: string, caret: number): { start: number; query: string } | null => {
    let i = caret - 1;
    while (i >= 0) {
      const ch = text[i];
      if (ch === '@') {
        // Перед @ должен быть пробел/перенос или начало строки. Иначе это часть слова (e-mail).
        const prev = i > 0 ? text[i - 1] : ' ';
        if (/\s/.test(prev) || i === 0) {
          return { start: i, query: text.slice(i + 1, caret) };
        }
        return null;
      }
      // Допустимые символы внутри username — A-Za-z0-9_; всё остальное закрывает токен.
      if (!/[A-Za-z0-9_]/.test(ch)) return null;
      i--;
    }
    return null;
  };

  const closeMention = () => setMention(null);

  const insertMention = (member: Member) => {
    if (!mention) return;
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? draft.length;
    const before = draft.slice(0, mention.start);
    const after = draft.slice(caret);
    const insert = `@${member.username} `;
    const newText = before + insert + after;
    setDraft(channelId, newText);
    closeMention();
    requestAnimationFrame(() => {
      if (!el) return;
      const pos = before.length + insert.length;
      el.focus();
      el.setSelectionRange(pos, pos);
      adjustHeight(el);
    });
  };

  // Состояние "печатает": активно от первого нажатия до TYPING_IDLE_MS без ввода или отправки.
  const typingActiveRef = useRef(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopTyping = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (typingActiveRef.current) {
      typingActiveRef.current = false;
      onStopTyping?.();
    }
  }, [onStopTyping]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setDraft(channelId, value);
    adjustHeight(e.target);
    // Детект @-токена под кареткой — открываем/обновляем дропдаун.
    const caret = e.target.selectionStart ?? value.length;
    const m = detectMention(value, caret);
    setMention(m);
    if (value.length === 0) {
      stopTyping();
      return;
    }
    if (!typingActiveRef.current) {
      typingActiveRef.current = true;
      onTyping?.();
    }
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  };

  // При перемещении каретки (стрелки, клик) — пересчитываем токен.
  const handleSelectionChange = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const caret = el.selectionStart ?? draft.length;
    const m = detectMention(draft, caret);
    setMention(m);
  };

  // При смене канала / размонтировании — гасим индикатор
  useEffect(() => {
    return () => stopTyping();
  }, [channelId, stopTyping]);

  // Formatting — wraps selected text
  const wrapSelection = useCallback((prefix: string, suffix: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = draft.slice(start, end) || 'text';
    const newText = draft.slice(0, start) + prefix + selected + suffix + draft.slice(end);
    setDraft(channelId, newText);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    });
  }, [draft, channelId, setDraft]);

  // Voice recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : '';
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      const ext = recorder.mimeType.includes('mp4') ? 'mp4' : 'webm';
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        const file = new File([blob], `voice_${Date.now()}.${ext}`, { type: recorder.mimeType });
        addAttachments(channelId, [file]);
        stream.getTracks().forEach((t) => t.stop());
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingSeconds(0);
      recordTimerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    } catch {
      alert(t('chat.noMic'));
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    setIsRecording(false);
    setRecordingSeconds(0);
  };

  const fmtSec = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  const handleSend = useCallback(() => {
    const text = draft.trim();
    const hasPoll = pollOpen && pollDraft.question.trim() && pollDraft.options.filter((o) => o.trim()).length >= 2;
    if (!text && attachments.length === 0 && !hasPoll) return;

    const pollPayload = hasPoll
      ? { question: pollDraft.question.trim(), options: pollDraft.options.filter((o) => o.trim()) }
      : undefined;

    const hasFiles = attachments.length > 0;
    const handleProgress = hasFiles
      ? (pct: number) => {
          setUploadProgress(pct);
          if (pct >= 100) setTimeout(() => setUploadProgress(null), 600);
        }
      : undefined;

    onSend(text, attachments, replyTo?.id, pollPayload, handleProgress);
    clearDraft(channelId);
    clearAttachments(channelId);
    onClearReply?.();
    setPollOpen(false);
    setPollDraft({ question: '', options: ['', ''] });
    stopTyping();

    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [draft, attachments, channelId, replyTo, pollOpen, pollDraft, onSend, clearDraft, clearAttachments, onClearReply, stopTyping]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Навигация автокомплита @упоминаний — выше всех остальных хоткеев.
    if (mention && mentionCandidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIdx((i) => Math.min(i + 1, mentionCandidates.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(mentionCandidates[mentionIdx]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMention();
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); return; }

    // Esc — отмена reply (приоритет над редактированием, которое идёт внутри сообщения).
    if (e.key === 'Escape' && replyTo) {
      e.preventDefault();
      onClearReply?.();
      return;
    }

    // ↑ при пустом инпуте — редактировать последнее своё сообщение.
    if (e.key === 'ArrowUp' && draft.length === 0 && !replyTo && onEditLast) {
      e.preventDefault();
      onEditLast();
      return;
    }

    // Ctrl/Cmd-форматирование. На Mac и Win/Linux одинаковые комбинации.
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      // Учитываем ru-раскладку: и/ш/у — те же позиции что b/i/e на en.
      if (k === 'b' || k === 'и') { e.preventDefault(); wrapSelection('**', '**'); return; }
      if (k === 'i' || k === 'ш') { e.preventDefault(); wrapSelection('*', '*'); return; }
      if (k === 'e' || k === 'у') { e.preventDefault(); wrapSelection('`', '`'); return; }
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const pastedFiles: File[] = [];
    for (const item of e.clipboardData.items) {
      if (item.kind !== 'file') continue;
      const file = item.getAsFile();
      if (!file) continue;
      if (item.type.startsWith('image/')) {
        const ext = item.type.split('/')[1] ?? 'png';
        pastedFiles.push(new File([file], `screenshot-${Date.now()}.${ext}`, { type: item.type }));
      } else {
        pastedFiles.push(file);
      }
    }
    if (pastedFiles.length > 0) { e.preventDefault(); addAttachments(channelId, pastedFiles); }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) addAttachments(channelId, files);
    e.target.value = '';
  };

  const hasContent = draft.trim().length > 0 || attachments.length > 0
    || (pollOpen && pollDraft.question.trim().length > 0 && pollDraft.options.filter((o) => o.trim()).length >= 2);

  return (
    <div className="px-4 pb-6 pt-2 shrink-0">
      <div className="rounded-lg bg-[var(--bg-input)] overflow-hidden">

        {/* Reply banner */}
        {replyTo && (
          <div className="flex items-center gap-2 px-3 pt-2 pb-1">
            <CornerUpLeft size={14} className="text-[var(--accent)] shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-xs font-medium text-[var(--accent)]">
                {replyTo.author_display_name || replyTo.author_username}
              </span>
              {replyTo.content && (
                <p className="text-xs text-[var(--text-muted)] truncate">{replyTo.content}</p>
              )}
            </div>
            <button onClick={onClearReply}
              className="p-0.5 rounded hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0"
              title={t('chat.cancelReply')}>
              <X size={14} />
            </button>
          </div>
        )}

        {/* Attachment preview */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 p-3 pb-0">
            {attachments.map((file, i) => (
              <AttachmentPreview key={`${file.name}-${i}`} file={file} onRemove={() => removeAttachment(channelId, i)} />
            ))}
          </div>
        )}

        {/* File upload progress bar */}
        {uploadProgress !== null && (
          <div className="px-3 pt-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-[var(--text-muted)]">{t('chat.uploading')}</span>
              <span className="text-xs text-[var(--text-muted)]">{uploadProgress}%</span>
            </div>
            <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--accent)] rounded-full transition-[width] duration-150"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Live formatting preview */}
        {draft.trim() && hasFormatting(draft) && (
          <div className="px-3 pt-2 pb-1">
            <button
              type="button"
              onClick={() => setPreviewOpen((v) => !v)}
              className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] uppercase tracking-wide hover:text-[var(--text-secondary)] transition-colors mb-1"
            >
              <span>{previewOpen ? '▾' : '▸'}</span>
              <span>{t('chat.preview')}</span>
            </button>
            {previewOpen && (
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed break-words whitespace-pre-wrap">
                {renderContent(draft, selfUsername)}
              </p>
            )}
          </div>
        )}

        {/* Toolbar */}
        <div className="flex items-center gap-1 px-3 pt-2">
          {/* Text formatting dropdown */}
          <ToolbarDropdown
            anchorRef={useRef(null)}
            icon={<span className="text-xs font-semibold">Aa</span>}
            title={t('chat.formatting')}
            items={[
              { label: t('chat.bold'), shortcut: '**text**', action: () => wrapSelection('**', '**') },
              { label: t('chat.italic'), shortcut: '*text*', action: () => wrapSelection('*', '*') },
              { label: t('chat.spoiler'), shortcut: '||text||', action: () => wrapSelection('||', '||') },
              { label: t('chat.inlineCode'), shortcut: '`code`', action: () => wrapSelection('`', '`') },
            ]}
          />

          {/* Emoji */}
          <button ref={emojiBtnRef} type="button" onClick={() => setEmojiPickerOpen((v) => !v)}
            className={`p-1.5 rounded transition-colors ${emojiPickerOpen ? 'text-[var(--text-primary)] bg-white/10' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10'}`}
            title="Emoji"
          >
            <span className="text-sm grayscale opacity-70">😀</span>
          </button>
          <ChatEmojiPicker visible={emojiPickerOpen} anchorRef={emojiBtnRef}
            onSelect={(emoji) => {
              const el = textareaRef.current;
              if (el) {
                const pos = el.selectionStart ?? draft.length;
                const newText = draft.slice(0, pos) + emoji + draft.slice(pos);
                setDraft(channelId, newText);
                requestAnimationFrame(() => {
                  el.focus();
                  el.setSelectionRange(pos + emoji.length, pos + emoji.length);
                });
              } else {
                setDraft(channelId, draft + emoji);
              }
            }}
            onClose={() => setEmojiPickerOpen(false)}
          />

          {/* Code block */}
          <button ref={codeBtnRef} type="button" onClick={() => setCodeLangOpen((v) => !v)}
            className={`p-1.5 rounded transition-colors ${codeLangOpen ? 'text-[var(--text-primary)] bg-white/10' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10'}`}
            title="Code"
          >
            <Code size={14} />
          </button>
          {codeLangOpen && (
            <CodeLangPicker
              anchorRef={codeBtnRef}
              onSelect={(lang) => {
                const el = textareaRef.current;
                if (!el) return;
                const start = el.selectionStart ?? 0;
                const end = el.selectionEnd ?? start;
                const selected = draft.slice(start, end);
                const block = `\`\`\`${lang}\n${selected || ''}\n\`\`\``;
                const newText = draft.slice(0, start) + block + draft.slice(end);
                setDraft(channelId, newText);
                const cursorPos = start + 3 + lang.length + 1 + (selected ? selected.length : 0);
                requestAnimationFrame(() => {
                  el.focus();
                  el.setSelectionRange(cursorPos, cursorPos);
                });
                setCodeLangOpen(false);
              }}
              onClose={() => setCodeLangOpen(false)}
            />
          )}

          {/* Poll */}
          <button type="button" onClick={() => setPollOpen((v) => !v)} title={t('chat.poll')}
            className={`p-1.5 rounded transition-colors ${pollOpen ? 'text-[var(--accent)] bg-white/10' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10'}`}
          >
            <BarChart2 size={14} />
          </button>
        </div>

        {/* Poll form */}
        {pollOpen && (
          <div className="px-3 pt-2 pb-1 border-b border-[var(--border-color)]">
            <input
              type="text"
              placeholder={t('chat.pollQuestion')}
              value={pollDraft.question}
              onChange={(e) => setPollDraft((d) => ({ ...d, question: e.target.value }))}
              className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:ring-1 focus:ring-[var(--accent)] mb-2"
              maxLength={200}
            />
            <div className="flex flex-col gap-1">
              {pollDraft.options.map((opt, i) => (
                <div key={i} className="flex items-center gap-1">
                  <span className="text-xs text-[var(--text-muted)] w-4 text-right shrink-0">{i + 1}.</span>
                  <input
                    type="text"
                    placeholder={`${t('chat.pollOption')} ${i + 1}`}
                    value={opt}
                    onChange={(e) => setPollDraft((d) => {
                      const opts = [...d.options];
                      opts[i] = e.target.value;
                      return { ...d, options: opts };
                    })}
                    className="flex-1 px-2 py-1 rounded bg-[var(--bg-primary)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
                    maxLength={200}
                  />
                  {pollDraft.options.length > 2 && (
                    <button
                      type="button"
                      onClick={() => setPollDraft((d) => ({ ...d, options: d.options.filter((_, j) => j !== i) }))}
                      className="p-0.5 text-[var(--text-muted)] hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {pollDraft.options.length < 10 && (
              <button
                type="button"
                onClick={() => setPollDraft((d) => ({ ...d, options: [...d.options, ''] }))}
                className="mt-1.5 flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
              >
                <Plus size={12} /> {t('chat.pollAdd')}
              </button>
            )}
          </div>
        )}

        {/* Recording / input row */}
        {isRecording ? (
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-sm text-red-400 font-medium flex-1">{t('chat.recording')} {fmtSec(recordingSeconds)}</span>
            <button
              onClick={stopRecording}
              className="px-3 py-1 rounded bg-red-500/20 text-red-400 text-xs hover:bg-red-500/30 transition-colors flex items-center gap-1"
            >
              <MicOff size={14} /> {t('chat.stop')}
            </button>
          </div>
        ) : (
          <div className="flex items-end gap-2 px-3 py-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 transition-colors shrink-0 mb-0.5"
              title={t('chat.attach')}
            >
              <Paperclip size={20} />
            </button>

            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileChange} />

            <textarea
              ref={textareaRef}
              value={draft}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onKeyUp={handleSelectionChange}
              onClick={handleSelectionChange}
              onPaste={handlePaste}
              onFocus={onFocus}
              onBlur={(e) => {
                stopTyping();
                // Не закрываем mention сразу — пользователь может кликать в дропдаун.
                // Поэтому отложим: если фокус ушёл вне textarea, mention закроется
                // через клик-обработчик в портале. Здесь только typing.
                void e;
              }}
              placeholder={`${t('chat.writeTo')}${channelName}`}
              rows={1}
              className="flex-1 bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)] text-sm outline-none resize-none leading-5 py-1"
              style={{ maxHeight: '200px' }}
            />

            {mention && mentionCandidates.length > 0 && mentionPos && createPortal(
              <>
                <div className="fixed inset-0 z-40" onMouseDown={closeMention} />
                <div
                  className="fixed z-50 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-xl py-1 max-h-64 overflow-y-auto"
                  style={{ bottom: mentionPos.bottom, left: mentionPos.left, width: mentionPos.width }}
                  onMouseDown={(e) => e.preventDefault() /* не теряем фокус textarea */}
                >
                  {mentionCandidates.map((m, i) => (
                    <button
                      key={m.user_id}
                      type="button"
                      onMouseEnter={() => setMentionIdx(i)}
                      onClick={() => insertMention(m)}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors ${
                        i === mentionIdx
                          ? 'bg-[var(--accent)]/15 text-[var(--text-primary)]'
                          : 'text-[var(--text-secondary)] hover:bg-white/5'
                      }`}
                    >
                      {m.image_path ? (
                        <img src={m.image_path} alt="" className="w-5 h-5 rounded-full object-cover shrink-0" />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-[var(--accent)] flex items-center justify-center text-[10px] font-bold text-white shrink-0">
                          {(m.display_name || m.username).slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <span className="font-medium truncate">{m.display_name || m.username}</span>
                      <span className="text-xs text-[var(--text-muted)] truncate">@{m.username}</span>
                      {m.is_online && <span className="ml-auto w-2 h-2 rounded-full bg-green-500 shrink-0" />}
                    </button>
                  ))}
                </div>
              </>,
              document.body,
            )}

            {/* Voice recording */}
            <button
              onClick={startRecording}
              className="p-1.5 rounded text-[var(--text-muted)] hover:text-red-400 hover:bg-white/10 transition-colors shrink-0 mb-0.5"
              title={t('chat.voice')}
            >
              <Mic size={20} />
            </button>

            <button
              onClick={handleSend}
              disabled={!hasContent}
              className={`p-1.5 rounded transition-all shrink-0 mb-0.5 ${
                hasContent ? 'text-[var(--accent)] hover:bg-white/10' : 'text-[var(--text-muted)] cursor-default'
              }`}
              title={t('chat.send')}
            >
              <Send size={20} />
            </button>
          </div>
        )}
      </div>

      <p className="text-xs text-[var(--text-muted)] mt-1 px-1">
        {t('chat.enterHint')}
      </p>
    </div>
  );
}
