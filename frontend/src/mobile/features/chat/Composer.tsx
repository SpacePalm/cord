// Chat composer (iOS MessageListContent.composer).
// VStack(spacing 6) padding 8/12 on --bg-secondary:
//   recording ? VoiceRecordingBar : [ComposeBanner] [AttachmentStrip] [MentionList] FormattingBar InputRow
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type MouseEvent,
  type RefObject,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Member } from '../../../types';
import { groupsApi } from '../../../api/groups';
import { useSessionStore } from '../../../store/sessionStore';
import { useWs } from '../../../hooks/useWebSocket';
import { useMT } from '../../i18n';
import { Icon } from '../../ui/Icon';
import { Avatar } from '../../ui/Avatar';
import { MenuButton } from '../../present/MenuButton';
import { present, type MenuItem } from '../../present/PresentationProvider';
import { openEmojiGrid } from '../actions/EmojiGrid';
import { ChartBarGlyph, FaceSmilingGlyph, MicFillGlyph, TrashGlyph } from './glyphs';
import { formatVoiceTime, useVoiceRecorder } from './useVoiceRecorder';

export type ComposeMode =
  | { kind: 'new' }
  | { kind: 'edit'; id: string }
  | { kind: 'reply'; id: string; author: string; preview: string };

export interface ComposerHandle {
  /** Programmatic draft change (edit fill) — also sends `typing`, like iOS onChange(of: draft). */
  setDraft(text: string): void;
}

export interface ComposerProps {
  chatId: string;
  /** Channel group → @mention autocomplete. */
  mentionGroupId?: string;
  myId?: string;
  mode: ComposeMode;
  onModeChange: (m: ComposeMode) => void;
  /** Submit; draft / attachments are already cleared. */
  onSubmit: (text: string, files: File[], mode: ComposeMode) => void;
  onSendVoice: (file: File, mode: ComposeMode) => void;
  onOpenPoll: () => void;
  inputRef: RefObject<HTMLTextAreaElement>;
  onInputFocus: () => void;
  /** false while the screen is covered → an active recording is cancelled. */
  active: boolean;
}

const MAX_ATTACHMENTS = 10;
const MAX_PHOTOS_PER_PICK = 5;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MIN_H = 40;
const MAX_H = 128;
const EMPTY_FILES: File[] = [];
const MENTION_RE = /(?:^|\s)@([\p{L}0-9_]{0,32})$/u;
const MENTION_TAIL_RE = /@[\p{L}0-9_]{0,32}$/u;

/** Stable per-File React key: an index-based key would remount (and re-create the object URL of) every
 *  tile after a removed one. */
const fileKeys = new WeakMap<File, number>();
let fileKeySeq = 0;
function fileKey(f: File): number {
  let k = fileKeys.get(f);
  if (k === undefined) fileKeys.set(f, (k = ++fileKeySeq));
  return k;
}

function isSvg(f: File): boolean {
  return /\.svg$/i.test(f.name) || f.type === 'image/svg+xml' || f.type === 'image/svg';
}

/** Keep the textarea focused (and the keyboard up) when tapping composer controls. */
function keepFocus(e: MouseEvent) {
  if ((e.target as HTMLElement | null)?.closest?.('textarea, input')) return;
  const ae = document.activeElement;
  if (ae && ae.tagName === 'TEXTAREA' && (ae as HTMLElement).classList.contains('m-chat-input')) e.preventDefault();
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(props, ref) {
  const { chatId, mentionGroupId, myId, mode, onModeChange, inputRef } = props;
  const t = useMT();
  // the context value is a fresh object on every provider render — depend on its (stable) functions only,
  // otherwise the unmount cleanup below fires stop_typing mid-typing and resets the 3s throttle
  const { sendTyping, sendStopTyping } = useWs();
  const draft = useSessionStore((s) => s.drafts[chatId] ?? '');
  const attachments = useSessionStore((s) => s.attachments[chatId]) ?? EMPTY_FILES;
  const recorder = useVoiceRecorder();
  const photoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const isEditing = mode.kind === 'edit';

  // ── typing notifications: `typing` at most every 3s, `stop_typing` 4s after the last change ──
  const typingSentAt = useRef(0);
  const stopTimer = useRef(0);
  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (!typingSentAt.current || now - typingSentAt.current > 3000) {
      typingSentAt.current = now;
      sendTyping(chatId);
    }
    window.clearTimeout(stopTimer.current);
    stopTimer.current = window.setTimeout(() => {
      stopTimer.current = 0;
      typingSentAt.current = 0;
      sendStopTyping(chatId);
    }, 4000);
  }, [sendTyping, sendStopTyping, chatId]);
  const stopTypingNow = useCallback(() => {
    if (!stopTimer.current) return;
    window.clearTimeout(stopTimer.current);
    stopTimer.current = 0;
    typingSentAt.current = 0;
    sendStopTyping(chatId);
  }, [sendStopTyping, chatId]);
  useEffect(() => () => stopTypingNow(), [stopTypingNow]);

  const updateDraft = useCallback(
    (text: string) => {
      const s = useSessionStore.getState();
      if (text) s.setDraft(chatId, text);
      else s.clearDraft(chatId);
      if (text.trim()) notifyTyping();
    },
    [chatId, notifyTyping],
  );
  useImperativeHandle(ref, () => ({ setDraft: updateDraft }), [updateDraft]);

  // ── autogrow 1…5 lines (40…128px) ──
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = '0px';
    const sh = el.scrollHeight;
    el.style.height = `${Math.min(MAX_H, Math.max(MIN_H, sh))}px`;
    el.style.overflowY = sh > MAX_H + 1 ? 'auto' : 'hidden';
  }, [draft, inputRef, recorder.recording]);

  // ── attachments ──
  const addFiles = useCallback(
    (files: File[], kind: 'photo' | 'file') => {
      const current = useSessionStore.getState().attachments[chatId]?.length ?? 0;
      const room = Math.max(0, MAX_ATTACHMENTS - current);
      if (!room) return;
      let list: File[];
      if (kind === 'photo') {
        list = files
          .slice(0, MAX_PHOTOS_PER_PICK)
          .filter((f) => !isSvg(f))
          .map((f, i) => new File([f], `photo_${i + 1}.jpg`, { type: 'image/jpeg', lastModified: f.lastModified }));
      } else {
        list = files.filter((f) => f.size <= MAX_FILE_BYTES && !isSvg(f));
      }
      if (list.length) useSessionStore.getState().addAttachments(chatId, list.slice(0, room));
    },
    [chatId],
  );

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files: File[] = [];
    const seen = new Set<string>();
    const add = (f: File | null) => {
      if (!f) return;
      const k = `${f.name}|${f.size}|${f.type}`;
      if (seen.has(k)) return;
      seen.add(k);
      files.push(f);
    };
    Array.from(e.clipboardData.files).forEach(add);
    Array.from(e.clipboardData.items).forEach((it) => {
      if (it.kind === 'file') add(it.getAsFile());
    });
    if (!files.length) return;
    e.preventDefault();
    addFiles(files, 'file');
  };

  // ── mentions (channels only; members re-fetched whenever the composer appears) ──
  const { data: members } = useQuery<Member[]>({
    queryKey: ['group-members', mentionGroupId],
    queryFn: () => groupsApi.getMembers(mentionGroupId!),
    enabled: !!mentionGroupId,
    refetchOnMount: 'always',
  });
  const mentionMatches = useMemo<Member[]>(() => {
    if (!mentionGroupId || !members || !members.length) return [];
    const m = MENTION_RE.exec(draft);
    if (!m) return [];
    const lq = (m[1] ?? '').toLowerCase();
    const prefixHit = (x: Member) => x.username.toLowerCase().startsWith(lq) || x.display_name.toLowerCase().startsWith(lq);
    const pool = members.filter((x) => x.user_id !== myId);
    const filtered = lq ? pool.filter((x) => x.username.toLowerCase().includes(lq) || x.display_name.toLowerCase().includes(lq)) : pool;
    return [...filtered]
      .sort((a, b) => {
        const ap = prefixHit(a);
        const bp = prefixHit(b);
        if (ap !== bp) return ap ? -1 : 1;
        return a.display_name.localeCompare(b.display_name, undefined, { sensitivity: 'accent' });
      })
      .slice(0, 6);
  }, [draft, members, mentionGroupId, myId]);

  const insertMention = (m: Member) => {
    const cur = useSessionStore.getState().drafts[chatId] ?? '';
    const next = MENTION_TAIL_RE.test(cur) ? cur.replace(MENTION_TAIL_RE, `@${m.username} `) : `${cur}@${m.username} `;
    updateDraft(next);
    inputRef.current?.focus();
  };

  // ── formatting (wraps the WHOLE draft, iOS) ──
  const wrap = (marker: string) => {
    const cur = useSessionStore.getState().drafts[chatId] ?? '';
    updateDraft(`${marker}${cur}${marker}`);
    inputRef.current?.focus();
  };
  const wrapBlock = () => {
    const cur = useSessionStore.getState().drafts[chatId] ?? '';
    updateDraft('```\n' + cur + '\n```');
    inputRef.current?.focus();
  };
  // composer menus open upward: first declared item closest to the button (menuOrder .priority)
  // the iOS labels contain a double space ("Жирный  **текст**") — keep it visible in HTML
  const fmtLabel = (key: string) => t(key).replace(/ {2}/g, '\u00a0 ');
  const formatItems: MenuItem[] = [
    { label: fmtLabel('chat.formatCode'), onSelect: () => wrap('`') },
    { label: fmtLabel('chat.formatSpoiler'), onSelect: () => wrap('||') },
    { label: fmtLabel('chat.formatItalic'), onSelect: () => wrap('*') },
    { label: fmtLabel('chat.formatBold'), onSelect: () => wrap('**') },
  ];
  const attachItems: MenuItem[] = [
    { label: t('chat.attachFile'), icon: 'doc', onSelect: () => fileInput.current?.click() },
    { label: t('chat.attachPhoto'), icon: 'photo', onSelect: () => photoInput.current?.click() },
  ];

  // ── send / edit / voice ──
  const canSend = draft.trim().length > 0 || attachments.length > 0;
  const trailingIsMic = !isEditing && !canSend;

  const submit = () => {
    if (!canSend) return;
    const text = draft;
    const current = mode;
    const files = attachments;
    const s = useSessionStore.getState();
    s.clearDraft(chatId);
    s.clearAttachments(chatId);
    stopTypingNow();
    props.onSubmit(text, files, current);
  };

  const startRecording = async () => {
    const ok = await recorder.start();
    if (!ok) {
      present.alert({ title: t('voice.micDenied'), actions: [{ label: t('common.close'), role: 'cancel' }] });
    }
  };
  const sendVoice = async () => {
    const file = await recorder.stop();
    if (file) props.onSendVoice(file, mode);
  };

  // auto-cancel: screen covered / app backgrounded
  const { cancel: cancelRecording, recording } = recorder;
  useEffect(() => {
    if (!props.active && recording) cancelRecording();
  }, [props.active, recording, cancelRecording]);
  useEffect(() => {
    if (!recording) return;
    const onHide = () => {
      if (document.visibilityState !== 'visible') cancelRecording();
    };
    const onPageHide = () => cancelRecording();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [recording, cancelRecording]);

  const placeholder =
    mode.kind === 'edit' ? t('chat.placeholderEdit') : mode.kind === 'reply' ? t('chat.placeholderReply') : t('chat.placeholderMessage');

  if (recorder.recording) {
    return (
      <div className="m-chat-composer">
        <div className="m-chat-rec">
          <span className="m-chat-rec-mic" aria-hidden>
            <MicFillGlyph height={20} color="var(--danger)" />
          </span>
          <span className="m-chat-rec-time">{formatVoiceTime(recorder.elapsed)}</span>
          <span className="m-chat-spacer" />
          <button type="button" className="m-chat-rec-trash" aria-label={t('chat.m.cancelRecording')} onClick={() => recorder.cancel()}>
            <TrashGlyph size={24} color="var(--danger)" />
          </button>
          <button type="button" className="m-chat-trailing is-circle" aria-label={t('chat.send')} onClick={() => void sendVoice()}>
            <Icon name="arrow.up.circle.fill" size={38} color="var(--accent)" />
          </button>
        </div>
      </div>
    );
  }

  let banner: string | null = null;
  if (mode.kind === 'edit') banner = t('chat.editing');
  else if (mode.kind === 'reply') {
    const full = t('chat.replyBanner', mode.author, mode.preview);
    const nl = full.indexOf('\n');
    banner = nl >= 0 ? `${full.slice(0, nl)}…` : full;
  }

  return (
    <div className="m-chat-composer">
      {banner != null && (
        <div className="m-chat-banner">
          <Icon name={mode.kind === 'edit' ? 'pencil' : 'arrowshape.turn.up.left'} size={21} color="var(--accent)" />
          <span className="m-chat-banner-text">{banner}</span>
          <button
            type="button"
            className="m-chat-banner-x"
            aria-label={t('chat.m.cancelCompose')}
            onMouseDown={keepFocus}
            onClick={() => {
              if (mode.kind === 'edit') updateDraft('');
              onModeChange({ kind: 'new' });
            }}
          >
            <Icon name="xmark.circle.fill" size={23} color="var(--text-muted)" />
          </button>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="m-chat-strip">
          <div className="m-chat-strip-inner">
            {attachments.map((f, i) => (
              <AttachmentTile
                key={`${fileKey(f)}.${attachments.slice(0, i).filter((x) => x === f).length}`}
                file={f}
                removeLabel={t('chat.m.removeAttachment')}
                onRemove={() => useSessionStore.getState().removeAttachment(chatId, i)}
              />
            ))}
          </div>
        </div>
      )}

      {mentionMatches.length > 0 && (
        <div className="m-chat-mentions" role="listbox">
          {mentionMatches.map((m) => (
            <button key={m.user_id} type="button" role="option" aria-selected={false} className="m-chat-mention" onMouseDown={keepFocus} onClick={() => insertMention(m)}>
              <Avatar
                src={m.image_path || null}
                name={m.display_name}
                size={24}
                statusDot={{ status: m.status, isOnline: m.is_online, size: 8, ring: 'var(--bg-input)', offset: 0 }}
              />
              <span className="m-chat-mention-name">{m.display_name}</span>
              <span className="m-chat-mention-user">@{m.username}</span>
            </button>
          ))}
        </div>
      )}

      <div className="m-chat-fmt" onMouseDown={keepFocus}>
        <MenuButton items={formatItems} ariaLabel="Aa">
          <span className="m-chat-fmt-aa">Aa</span>
        </MenuButton>
        <button type="button" className="m-chat-fmt-btn is-braces" aria-label={t('chat.m.codeBlock')} onClick={wrapBlock}>
          <Icon name="curlybraces" size={19} strokeWidth={1.6} />
        </button>
        <button
          type="button"
          className="m-chat-fmt-btn is-smile"
          aria-label={t('chat.m.emoji')}
          onClick={(e) => {
            const anchor = e.currentTarget;
            openEmojiGrid(anchor, (emoji) => updateDraft((useSessionStore.getState().drafts[chatId] ?? '') + emoji));
          }}
        >
          <FaceSmilingGlyph size={15} />
        </button>
        <button type="button" className="m-chat-fmt-btn is-chart" aria-label={t('pollComposer.title')} onClick={props.onOpenPoll}>
          <ChartBarGlyph size={18.6} />
        </button>
      </div>

      <div className="m-chat-inputrow" onMouseDown={keepFocus}>
        {!isEditing && (
          <MenuButton items={attachItems}>
            <button type="button" className="m-chat-attach" aria-label={t('chat.attach')}>
              <Icon name="paperclip" size={24} />
            </button>
          </MenuButton>
        )}
        <textarea
          ref={inputRef}
          className="m-chat-input"
          rows={1}
          value={draft}
          placeholder={placeholder}
          enterKeyHint="enter"
          autoCapitalize="sentences"
          autoCorrect="on"
          spellCheck
          onChange={(e) => updateDraft(e.target.value)}
          onFocus={props.onInputFocus}
          onPaste={onPaste}
        />
        {trailingIsMic ? (
          <button type="button" className="m-chat-trailing is-mic" aria-label={t('chat.recordVoice')} onClick={() => void startRecording()}>
            <MicFillGlyph height={29} color="var(--accent)" />
          </button>
        ) : (
          <button
            type="button"
            className="m-chat-trailing is-circle"
            aria-label={t('chat.send')}
            disabled={!canSend}
            onClick={submit}
          >
            <Icon
              name={isEditing ? 'checkmark.circle.fill' : 'arrow.up.circle.fill'}
              size={38}
              color={canSend ? 'var(--accent)' : 'var(--ios-label-4)'}
            />
          </button>
        )}
      </div>

      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) addFiles(Array.from(e.target.files), 'photo');
          e.target.value = '';
        }}
      />
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) addFiles(Array.from(e.target.files), 'file');
          e.target.value = '';
        }}
      />
    </div>
  );
});

/** Strip tile: 56×56 thumbnail (images that decode) or a file pill; always-visible remove badge. */
function AttachmentTile({ file, onRemove, removeLabel }: { file: File; onRemove: () => void; removeLabel: string }) {
  const isImage = file.type.startsWith('image/');
  const [url, setUrl] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    if (!isImage) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file, isImage]);
  const thumb = isImage && !broken;
  return (
    <div className={`m-chat-tile${thumb ? ' is-image' : ' is-file'}`}>
      {thumb ? (
        url ? <img src={url} alt="" onError={() => setBroken(true)} draggable={false} /> : null
      ) : (
        <>
          <Icon name="doc.fill" size={21} color="var(--accent)" />
          <span className="m-chat-tile-name">{middleEllipsis(file.name, 18)}</span>
        </>
      )}
      <button type="button" className="m-chat-tile-x" aria-label={removeLabel} onMouseDown={keepFocus} onClick={onRemove}>
        <span className="m-chat-tile-x-disc">
          <Icon name="xmark" size={12} strokeWidth={2.6} color="#fff" />
        </span>
      </button>
    </div>
  );
}

/** SwiftUI `.truncationMode(.middle)` approximation for the file pill (max-width 150). */
function middleEllipsis(name: string, max: number): string {
  const chars = Array.from(name);
  if (chars.length <= max) return name;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return `${chars.slice(0, head).join('')}…${chars.slice(chars.length - tail).join('')}`;
}
