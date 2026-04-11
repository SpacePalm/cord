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

import { useRef, useEffect, useCallback, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Paperclip, X, FileText, Send, CornerUpLeft, Mic, MicOff, BarChart2, Plus, Trash2, Code } from 'lucide-react';
import { useSessionStore } from '../../store/sessionStore';
import { renderContent, hasFormatting } from '../../utils/renderContent';
import type { Message } from '../../types';
import { useT } from '../../i18n';

interface PollDraft {
  question: string;
  options: string[];
}

interface ChatInputProps {
  channelId: string;
  channelName: string;
  replyTo?: Message | null;
  onClearReply?: () => void;
  onFocus?: () => void;
  onTyping?: () => void;
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

const EMOJI_TABS = [
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

export function ChatInput({ channelId, channelName, replyTo, onClearReply, onFocus, onTyping, onSend }: ChatInputProps) {
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
  const codeBtnRef = useRef<HTMLButtonElement>(null);

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
  }, [channelId]);

  const adjustHeight = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  const lastTypingRef = useRef(0);
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(channelId, e.target.value);
    adjustHeight(e.target);
    if (onTyping && Date.now() - lastTypingRef.current > 2000) {
      lastTypingRef.current = Date.now();
      onTyping();
    }
  };

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

    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [draft, attachments, channelId, replyTo, pollOpen, pollDraft, onSend, clearDraft, clearAttachments, onClearReply]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const imageFiles: File[] = [];
    for (const item of e.clipboardData.items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          const ext = item.type.split('/')[1] ?? 'png';
          imageFiles.push(new File([file], `screenshot-${Date.now()}.${ext}`, { type: item.type }));
        }
      }
    }
    if (imageFiles.length > 0) { e.preventDefault(); addAttachments(channelId, imageFiles); }
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
            <p className="text-[10px] text-[var(--text-muted)] mb-1 uppercase tracking-wide">{t('chat.preview')}</p>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed break-words whitespace-pre-wrap">
              {renderContent(draft)}
            </p>
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
              onPaste={handlePaste}
              onFocus={onFocus}
              placeholder={`${t('chat.writeTo')}${channelName}`}
              rows={1}
              className="flex-1 bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)] text-sm outline-none resize-none leading-5 py-1"
              style={{ maxHeight: '200px' }}
            />

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
