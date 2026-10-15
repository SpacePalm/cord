// Port of iOS `MessageContentFormatter` / `MessageBodyView` / `CodeBlockView` / `CodeHighlighter`
// (Features/Chat/MessageContentFormatter.swift).
// Regexes are the iOS ones (NSRegularExpression/ICU semantics): `.` never crosses a newline, `\w`/`\d`/`\b`
// are Unicode-aware (emulated with \p{…} classes), first match wins, no nesting. Fenced-code language class is
// the iOS one (`[a-zA-Z0-9_+#.-]*`), so ```c++ / ```c# / ```objective-c keep their full language label.
import { Fragment, memo, useMemo, useState, type ReactNode } from 'react';
import { Icon, haptic } from '../../ui';
import { useMT } from '../../i18n';

// ───────────────────────────── segmentation ─────────────────────────────

export type MessageSegment = { type: 'text'; text: string } | { type: 'code'; lang: string | null; body: string };

const FENCE_RE = /```([a-zA-Z0-9_+#.-]*)\n?([\s\S]*?)```/g;

/** iOS `MessageContentFormatter.segments`: inline text runs and fenced code blocks. */
export function splitSegments(content: string): MessageSegment[] {
  if (!content.includes('```')) return [{ type: 'text', text: content }];
  const segs: MessageSegment[] = [];
  let last = 0;
  FENCE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FENCE_RE.exec(content))) {
    if (m.index > last) segs.push({ type: 'text', text: content.slice(last, m.index) });
    const lang = m[1] ?? '';
    let body = m[2] ?? '';
    if (body.endsWith('\n')) body = body.slice(0, -1); // one trailing newline before the closing ```
    segs.push({ type: 'code', lang: lang || null, body });
    last = m.index + m[0].length;
    if (m[0].length === 0) FENCE_RE.lastIndex++;
  }
  if (last < content.length) segs.push({ type: 'text', text: content.slice(last) });
  return segs.length ? segs : [{ type: 'text', text: content }];
}

// ───────────────────────────── inline tokens ─────────────────────────────

/** ICU `\w`: alphabetic, marks, decimal digits, connector punctuation, ZWNJ/ZWJ. */
const W = '[\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}\\u200C\\u200D]';

const INLINE_RE = new RegExp(
  '(`[^`\\n]+?`)' +
    '|(\\|\\|.+?\\|\\|)' +
    '|(\\*\\*.+?\\*\\*)' +
    '|(\\*[^*\\n]+?\\*)' +
    '|(https?://[^\\s<>"\']+)' +
    '|((?<!' + W + ')@[A-Za-z0-9_]{2,32})',
  'gu',
);
const SPOILER_RE = /\|\|.+?\|\|/u;

export type InlineToken =
  | { t: 'text'; s: string }
  | { t: 'code'; s: string }
  | { t: 'spoiler'; s: string }
  | { t: 'bold'; s: string }
  | { t: 'italic'; s: string }
  | { t: 'link'; s: string }
  | { t: 'mention'; s: string };

/** iOS `MessageContentFormatter.attributed` as a token list. */
export function tokenizeInline(text: string): InlineToken[] {
  const out: InlineToken[] = [];
  let last = 0;
  INLINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_RE.exec(text))) {
    if (m.index > last) out.push({ t: 'text', s: text.slice(last, m.index) });
    const tok = m[0];
    if (m[1] !== undefined) out.push({ t: 'code', s: tok.slice(1, -1) });
    else if (m[2] !== undefined) out.push({ t: 'spoiler', s: tok.slice(2, -2) });
    else if (m[3] !== undefined) out.push({ t: 'bold', s: tok.slice(2, -2) });
    else if (m[4] !== undefined) out.push({ t: 'italic', s: tok.slice(1, -1) });
    else if (m[5] !== undefined) out.push({ t: 'link', s: tok });
    else out.push({ t: 'mention', s: tok });
    last = m.index + tok.length;
    if (tok.length === 0) INLINE_RE.lastIndex++;
  }
  if (last < text.length) out.push({ t: 'text', s: text.slice(last) });
  return out;
}

export function hasSpoiler(text: string): boolean {
  return SPOILER_RE.test(text);
}

// ───────────────────────────── code highlighter ─────────────────────────────

/** ICU `\b` (transition between \w and \W). */
const WB = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`;
const KEYWORDS =
  'func|let|var|if|else|for|while|return|import|from|class|struct|enum|def|function|const|public|private|protected|static|new|await|async|try|catch|throw|switch|case|break|continue|in|is|nil|null|None|true|false|True|False|self|this|extends|implements|interface|type|export|default';
const CODE_RE = new RegExp(
  '(//[^\\n]*|#[^\\n]*|/\\*[\\s\\S]*?\\*/)' + // 1 comment
    '|("[^"\\n]*"|\'[^\'\\n]*\')' + // 2 string
    `|${WB}(${KEYWORDS})${WB}` + // 3 keyword
    `|${WB}(\\p{Nd}+\\.?\\p{Nd}*)${WB}`, // 4 number
  'gu',
);

const HL_COLOR = ['', 'var(--text-muted)', 'var(--ios-green)', 'var(--accent)', 'var(--ios-orange)'];

/** iOS `CodeHighlighter.highlight`: comments muted, strings green, keywords accent, numbers orange. */
export function highlightCode(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  CODE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CODE_RE.exec(code))) {
    if (m[0].length === 0) {
      CODE_RE.lastIndex++;
      continue;
    }
    if (m.index > last) out.push(code.slice(last, m.index));
    const g = m[1] !== undefined ? 1 : m[2] !== undefined ? 2 : m[3] !== undefined ? 3 : 4;
    out.push(
      <span key={k++} style={{ color: HL_COLOR[g] }}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

// ───────────────────────────── clipboard ─────────────────────────────

/** Plain-text clipboard write (async Clipboard API, execCommand fallback for older WebKit / http). */
export function copyText(text: string): void {
  const fallback = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    } catch {
      /* noop */
    }
  };
  try {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(fallback);
    else fallback();
  } catch {
    fallback();
  }
}

// ───────────────────────────── views ─────────────────────────────

/** `CodeBlockView`: language label + copy button header, horizontally scrolling highlighted body. */
export const CodeBlock = memo(function CodeBlock({ lang, code }: { lang: string | null; code: string }) {
  const t = useMT();
  const [copied, setCopied] = useState(false);
  const html = useMemo(() => highlightCode(code), [code]);
  return (
    <div className="m-msg-code">
      <div className="m-msg-code-head">
        {lang ? <span className="m-msg-code-lang">{lang}</span> : null}
        <span className="m-msg-code-spacer" />
        <button
          type="button"
          className={'m-msg-code-copy' + (copied ? ' is-copied' : '')}
          aria-label={copied ? t('message.copied') : t('chat.copy')}
          onClick={(e) => {
            e.stopPropagation();
            copyText(code);
            setCopied(true); // iOS never switches back to the copy glyph
            haptic('light');
          }}
        >
          <Icon name={copied ? 'checkmark' : 'doc.on.doc'} size={13} strokeWidth={copied ? 2.6 : 2} />
        </button>
      </div>
      <div className="m-msg-code-body" data-hscroll="">
        <pre className="m-msg-code-pre">{html}</pre>
      </div>
    </div>
  );
});

/* Emoji-presentation runs (incl. FE0F forms, skin tones, ZWJ sequences, flags). Text-presentation symbols such
   as the reply line's "↩︎" (U+21A9 U+FE0E) are not matched. */
const EMOJI_RE =
  /(?:\p{Regional_Indicator}{2}|(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}️)(?:\p{Emoji_Modifier}|️|‍(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}️?))*)+/gu;

/**
 * SwiftUI/CoreText grows a line that contains an emoji to the Apple Color Emoji metrics (ascent 1.0 + descent
 * 0.3125 em → 22.3 instead of 20.3 at 17pt); a fixed CSS line-height ignores fallback fonts, so emoji runs get
 * their own inline box with that line height (`.m-msg-emo`).
 */
export function withEmoji(s: string): ReactNode {
  EMOJI_RE.lastIndex = 0;
  if (!EMOJI_RE.test(s)) return s;
  EMOJI_RE.lastIndex = 0;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = EMOJI_RE.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    out.push(
      <span key={m.index} className="m-msg-emo">
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

function renderTokens(tokens: InlineToken[], reveal: boolean): ReactNode[] {
  return tokens.map((tok, i) => {
    switch (tok.t) {
      case 'text': {
        const v = withEmoji(tok.s);
        return typeof v === 'string' ? v : <Fragment key={i}>{v}</Fragment>;
      }
      case 'code':
        return (
          <span key={i} className="m-msg-icode">
            {tok.s}
          </span>
        );
      case 'spoiler':
        return (
          <span key={i} className={'m-msg-spoiler' + (reveal ? ' is-revealed' : '')}>
            {withEmoji(tok.s)}
          </span>
        );
      case 'bold':
        return (
          <strong key={i} className="m-msg-bold">
            {withEmoji(tok.s)}
          </strong>
        );
      case 'italic':
        return (
          <em key={i} className="m-msg-italic">
            {withEmoji(tok.s)}
          </em>
        );
      case 'link':
        return (
          <a
            key={i}
            className="m-msg-link"
            href={tok.s}
            target="_blank"
            rel="noopener noreferrer"
            draggable={false}
            onClick={(e) => e.stopPropagation()}
          >
            {tok.s}
          </a>
        );
      case 'mention':
        return (
          <span key={i} className="m-msg-mention">
            {tok.s}
          </span>
        );
    }
    return null;
  });
}

/** One inline text run (`textRun` in MessageBodyView): tap anywhere on it toggles the message's spoilers. */
const TextRun = memo(function TextRun({
  text,
  reveal,
  onToggleSpoiler,
}: {
  text: string;
  reveal: boolean;
  onToggleSpoiler?: () => void;
}) {
  const tokens = useMemo(() => tokenizeInline(text), [text]);
  const spoiler = useMemo(() => tokens.some((x) => x.t === 'spoiler'), [tokens]);
  return (
    <div
      className={'m-msg-text' + (spoiler ? ' has-spoiler' : '')}
      onClick={spoiler && onToggleSpoiler ? () => onToggleSpoiler() : undefined}
    >
      {renderTokens(tokens, reveal)}
      {/* SwiftUI Text draws an empty last line for a trailing "\n" (e.g. "Код:\n```…"); CSS pre-wrap does not */}
      {text.endsWith('\n') ? '​' : null}
    </div>
  );
});

export interface MessageBodyProps {
  content: string;
  revealSpoilers: boolean;
  onToggleSpoiler?: () => void;
}

/** `MessageBodyView`: single text run fast path, else text runs + code blocks stacked with 6px spacing. */
export const MessageBody = memo(function MessageBody({ content, revealSpoilers, onToggleSpoiler }: MessageBodyProps) {
  const segs = useMemo(() => splitSegments(content), [content]);
  if (segs.length === 1 && segs[0].type === 'text') {
    return <TextRun text={segs[0].text} reveal={revealSpoilers} onToggleSpoiler={onToggleSpoiler} />;
  }
  return (
    <div className="m-msg-body">
      {segs.map((seg, i) =>
        seg.type === 'code' ? (
          <CodeBlock key={i} lang={seg.lang} code={seg.body} />
        ) : seg.text.trim() ? (
          <TextRun key={i} text={seg.text} reveal={revealSpoilers} onToggleSpoiler={onToggleSpoiler} />
        ) : null,
      )}
    </div>
  );
});
