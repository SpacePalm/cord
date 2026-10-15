// Date helpers for the feed (iOS `Date.formatted(...)` equivalents).

/** Parses an API timestamp; null when it cannot be parsed (iOS `ISO8601.date(from:)` → nil). */
export function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const timeFmt = new Map<string, Intl.DateTimeFormat>();
const dayFmt = new Map<string, Intl.DateTimeFormat>();

/** `date.formatted(date: .omitted, time: .shortened)` → "14:05" (ru) / "2:05 PM" (en). */
export function formatMessageTime(iso: string | null | undefined, locale: string): string | null {
  const d = parseDate(iso);
  if (!d) return null;
  let f = timeFmt.get(locale);
  if (!f) timeFmt.set(locale, (f = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' })));
  return f.format(d);
}

/** `date.formatted(.dateTime.day().month(.wide))` → "8 октября" / "October 8" (never a year). */
export function formatDayLabel(iso: string | null | undefined, locale: string): string {
  const d = parseDate(iso);
  if (!d) return '';
  let f = dayFmt.get(locale);
  if (!f) dayFmt.set(locale, (f = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' })));
  return f.format(d);
}

export function sameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
