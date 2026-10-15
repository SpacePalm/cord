// Grapheme helpers (Swift `Character` semantics).

interface SegmenterLike {
  segment(input: string): Iterable<{ segment: string }>;
}
type SegmenterCtor = new (locales?: string | string[], options?: { granularity: 'grapheme' | 'word' | 'sentence' }) => SegmenterLike;

let segmenter: SegmenterLike | null | undefined;

/** Latin / Greek / Cyrillic without combining marks: every UTF-16 unit is one grapheme. */
const SIMPLE = /^[\u0020-\u007e\u00a0-\u02ff\u0370-\u03ff\u0400-\u0482\u048a-\u052f]*$/;

function getSegmenter(): SegmenterLike | null {
  if (segmenter !== undefined) return segmenter;
  // tsconfig lib is ES2020 → Intl.Segmenter is not in the typings; access it through a typed cast.
  const Ctor = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
  try {
    segmenter = Ctor ? new Ctor(undefined, { granularity: 'grapheme' }) : null;
  } catch {
    segmenter = null;
  }
  return segmenter;
}

/** Splits a string into user-perceived characters (grapheme clusters); code points as a fallback. */
export function graphemes(s: string): string[] {
  if (!s) return [];
  const seg = getSegmenter();
  if (!seg) return Array.from(s);
  const out: string[] = [];
  for (const part of seg.segment(s)) out.push(part.segment);
  return out;
}

/** Swift `String(s.prefix(n))` (grapheme-safe). */
export function prefixGraphemes(s: string, n: number): string {
  if (!s) return '';
  // fast path: plain BMP text without combining marks / joiners / variation selectors
  if (SIMPLE.test(s)) return s.slice(0, n);
  return graphemes(s).slice(0, n).join('');
}

/** Swift `s.count`. */
export function graphemeCount(s: string): number {
  if (!s) return 0;
  if (SIMPLE.test(s)) return s.length;
  return graphemes(s).length;
}
