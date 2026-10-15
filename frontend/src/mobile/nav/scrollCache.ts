// Scroll positions of stack screens, keyed by stack entry id. Deep screens may be unmounted by the
// nav stack (only the top few stay mounted); their Screen restores the offset on remount.
const cache = new Map<number, number>();

export function saveScroll(entryId: number | undefined, top: number): void {
  if (entryId != null) cache.set(entryId, top);
}

export function readScroll(entryId: number | undefined): number | undefined {
  return entryId == null ? undefined : cache.get(entryId);
}

export function forgetScroll(entryId: number): void {
  cache.delete(entryId);
}
