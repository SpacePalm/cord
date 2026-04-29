// Парсер операторов поиска: вытаскивает `from:`/`has:`/`before:`/`after:`/`in:`
// из строки запроса. Остаток — обычный текстовый поиск.
//
// Используется простым режимом палитры. В расширенном режиме фильтры задаются
// визуально (чекбоксы, мультиселекты), а строка содержит только текст.
//
// Поддержка операторов:
//   from:<username>      — автор
//   has:image|file|link|voice|poll
//   before:YYYY-MM-DD
//   after:YYYY-MM-DD
//   in:<channel>         — название канала (без `#`)
//   pinned:true          — только закреплённые
//   "точная фраза"       — кавычки сохраняются в q как есть, для websearch_to_tsquery

export type HasFilter = 'image' | 'file' | 'link' | 'voice' | 'poll';

export interface SearchFilters {
  from?: string;          // username
  before?: string;
  after?: string;
  has?: HasFilter[];
  in?: string;            // channel name (no #)
  pinnedOnly?: boolean;
}

export interface ParsedQuery {
  q: string;
  filters: SearchFilters;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HAS_VALID = new Set<HasFilter>(['image', 'file', 'link', 'voice', 'poll']);

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    while (i < n && /\s/.test(input[i])) i++;
    if (i >= n) break;
    if (input[i] === '"') {
      const start = i;
      i++;
      while (i < n && input[i] !== '"') i++;
      if (i < n) i++;
      tokens.push(input.slice(start, i));
    } else {
      const start = i;
      while (i < n && !/\s/.test(input[i])) i++;
      tokens.push(input.slice(start, i));
    }
  }
  return tokens;
}

export function parseSearchQuery(input: string): ParsedQuery {
  const filters: SearchFilters = {};
  const rest: string[] = [];

  for (const token of tokenize(input)) {
    if (token.startsWith('"')) {
      rest.push(token);
      continue;
    }

    const colon = token.indexOf(':');
    if (colon <= 0 || colon >= token.length - 1) {
      rest.push(token);
      continue;
    }

    const op = token.slice(0, colon).toLowerCase();
    const raw = token.slice(colon + 1);

    switch (op) {
      case 'from': {
        const v = raw.replace(/^@/, '').trim();
        if (v) filters.from = v; else rest.push(token);
        break;
      }
      case 'before':
      case 'after': {
        if (ISO_DATE_RE.test(raw)) filters[op] = raw;
        else rest.push(token);
        break;
      }
      case 'has': {
        const v = raw.toLowerCase();
        if ((HAS_VALID as Set<string>).has(v)) {
          filters.has = filters.has ? [...filters.has, v as HasFilter] : [v as HasFilter];
        } else rest.push(token);
        break;
      }
      case 'in': {
        const v = raw.replace(/^#/, '').trim();
        if (v) filters.in = v; else rest.push(token);
        break;
      }
      case 'pinned': {
        if (raw.toLowerCase() === 'true') filters.pinnedOnly = true;
        else rest.push(token);
        break;
      }
      default:
        rest.push(token);
    }
  }

  return { q: rest.join(' ').trim(), filters };
}

export function hasFilters(f: SearchFilters): boolean {
  return !!(f.from || f.before || f.after || f.in || f.pinnedOnly || (f.has && f.has.length));
}
