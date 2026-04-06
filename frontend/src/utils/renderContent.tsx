import { useState } from 'react';

// ---------------------------------------------------------------------------
// Spoiler — скрытый текст, открывается по клику
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
      title={revealed ? undefined : 'Нажми, чтобы показать'}
    >
      {text}
    </span>
  );
}

// ---------------------------------------------------------------------------
// renderContent — URL, **bold**, *italic*, _italic_, ||spoiler||
// ---------------------------------------------------------------------------
const FORMAT_RE = /(\|\|(.+?)\|\||\*\*(.+?)\*\*|\*([^*\n]+?)\*|_([^_\n]+?)_|https?:\/\/[^\s<>"']+)/gs;

export function renderContent(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const re = new RegExp(FORMAT_RE.source, FORMAT_RE.flags);
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const full = m[0];

    if (full.startsWith('||') && full.endsWith('||')) {
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
    }
    last = m.index + full.length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

// Есть ли в тексте маркеры форматирования или ссылки
const HAS_FORMAT_RE = /(\*\*|\*[^*]|_[^_]|\|\||https?:\/\/)/;
export function hasFormatting(text: string): boolean {
  return HAS_FORMAT_RE.test(text);
}
