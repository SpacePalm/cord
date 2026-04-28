import { useState } from 'react';
import hljs from 'highlight.js/lib/core';

// Register popular languages (keeps bundle small)
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import sql from 'highlight.js/lib/languages/sql';
import java from 'highlight.js/lib/languages/java';
import cpp from 'highlight.js/lib/languages/cpp';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('java', java);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c', cpp);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('rs', rust);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);

// ---------------------------------------------------------------------------
// Spoiler
// ---------------------------------------------------------------------------
export function Spoiler({ text }: { text: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      onClick={(e) => { e.stopPropagation(); setRevealed(true); }}
      className={`rounded px-0.5 cursor-pointer transition-colors ${
        revealed
          ? 'bg-white/10'
          : 'bg-[var(--text-muted)] text-[var(--text-muted)] select-none hover:bg-[var(--text-secondary)] hover:text-[var(--text-secondary)]'
      }`}
      title={revealed ? undefined : 'Click to reveal'}
    >
      {text}
    </span>
  );
}

// ---------------------------------------------------------------------------
// CodeBlock — syntax-highlighted fenced code block
// ---------------------------------------------------------------------------
function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  let html: string;
  try {
    html = lang && hljs.getLanguage(lang)
      ? hljs.highlight(code, { language: lang }).value
      : hljs.highlightAuto(code).value;
  } catch {
    html = code.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group my-1 rounded-lg overflow-hidden bg-black/30 border border-white/5">
      {lang && (
        <div className="px-3 py-1 text-[10px] text-[var(--text-muted)] bg-white/5 border-b border-white/5">
          {lang}
        </div>
      )}
      <button
        onClick={handleCopy}
        className="absolute top-1 right-1 px-2 py-0.5 rounded text-[10px] bg-white/10 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/20"
      >
        {copied ? '✓' : 'Copy'}
      </button>
      <pre className="p-3 overflow-x-auto text-sm leading-relaxed">
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// renderContent — code blocks, inline code, URL, **bold**, *italic*, ||spoiler||
// ---------------------------------------------------------------------------
const CODE_BLOCK_RE = /```(\w*)\n?([\s\S]*?)```/g;
// Lookbehind (?<!\w) защищает от ложных срабатываний на e-mail и подобных:
// `email@example.com` не превращается в упоминание.
const INLINE_RE = /(`[^`\n]+?`|\|\|(.+?)\|\||\*\*(.+?)\*\*|\*([^*\n]+?)\*|_([^_\n]+?)_|https?:\/\/[^\s<>"']+|(?<!\w)@[A-Za-z0-9_]{2,32})/gs;

function renderInline(text: string, selfUsername?: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const re = new RegExp(INLINE_RE.source, INLINE_RE.flags);
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const full = m[0];

    if (full.startsWith('`') && full.endsWith('`')) {
      nodes.push(
        <code key={key++} className="px-1.5 py-0.5 rounded bg-black/30 text-sm font-mono text-[var(--text-primary)]">
          {full.slice(1, -1)}
        </code>
      );
    } else if (full.startsWith('||') && full.endsWith('||')) {
      nodes.push(<Spoiler key={key++} text={full.slice(2, -2)} />);
    } else if (full.startsWith('**') && full.endsWith('**')) {
      nodes.push(<strong key={key++} className="font-bold text-[var(--text-primary)]">{full.slice(2, -2)}</strong>);
    } else if ((full.startsWith('*') && full.endsWith('*')) || (full.startsWith('_') && full.endsWith('_'))) {
      nodes.push(<em key={key++}>{full.slice(1, -1)}</em>);
    } else if (full.startsWith('http')) {
      const url = full.replace(/[.,;:!?)'"]+$/, '');
      const tail = full.slice(url.length);
      nodes.push(
        <a key={key++} href={url} target="_blank" rel="noreferrer noopener"
          className="text-[var(--accent)] hover:underline break-all"
          onClick={(e) => e.stopPropagation()}>
          {url}
        </a>
      );
      if (tail) nodes.push(tail);
    } else if (full.startsWith('@')) {
      const username = full.slice(1);
      const isSelf = !!selfUsername && username.toLowerCase() === selfUsername.toLowerCase();
      nodes.push(
        <span
          key={key++}
          className={isSelf
            ? 'rounded px-1 -mx-0.5 bg-[var(--accent)]/25 text-[var(--accent)] font-semibold'
            : 'text-[var(--accent)] font-medium hover:underline cursor-pointer'
          }
        >
          {full}
        </span>
      );
    }
    last = m.index + full.length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function renderContent(text: string, selfUsername?: string): React.ReactNode[] {
  // First split by fenced code blocks
  const parts: React.ReactNode[] = [];
  const re = new RegExp(CODE_BLOCK_RE.source, CODE_BLOCK_RE.flags);
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(...renderInline(text.slice(last, m.index), selfUsername));
    }
    parts.push(<CodeBlock key={`cb${key++}`} lang={m[1] || undefined} code={m[2].replace(/\n$/, '')} />);
    last = m.index + m[0].length;
  }

  if (last < text.length) {
    parts.push(...renderInline(text.slice(last), selfUsername));
  }

  return parts;
}

// Есть ли в тексте маркеры форматирования или ссылки
const HAS_FORMAT_RE = /(\*\*|\*[^*]|_[^_]|\|\||`|```|https?:\/\/)/;
export function hasFormatting(text: string): boolean {
  return HAS_FORMAT_RE.test(text);
}
