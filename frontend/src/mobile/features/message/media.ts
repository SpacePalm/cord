// Attachment helpers for the mobile message row (iOS `MediaKind`, `API.Media.displayName`,
// `env.images.image(attachmentPath:)`, `env.api.data(for:onProgress:)`).
// Protected attachments (`/media/messages/{mid}/{file}`) are fetched from `/api/media/messages/…` with the
// Bearer token (same as web `useProtectedUrl`), with one 401 → refresh → retry, and cached for the session as
// blob: URLs so the feed, the context-menu preview, the Media grid and the full-screen viewer share one copy.
import { useEffect, useState } from 'react';
import { tryRefresh } from '../../../api/client';
import { getMediaBlob, onMediaCacheCleared } from '../media/mediaCache';

// ───────────────────────────── classification ─────────────────────────────

export type AttachmentKind = 'image' | 'voice' | 'file';

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'bmp']);
const AUDIO_EXT = new Set(['webm', 'ogg', 'mp3', 'wav', 'm4a', 'mp4', 'aac', 'flac']);

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Last path component (query/hash stripped), URI-decoded. */
export function attachmentFileName(path: string): string {
  const clean = path.split(/[?#]/)[0];
  const parts = clean.split('/').filter(Boolean);
  return safeDecode(parts[parts.length - 1] ?? clean);
}

/** iOS `API.Media.displayName(forFilename:)`: drops a leading `{8 hex}_` server prefix. */
export function attachmentDisplayName(path: string): string {
  const file = attachmentFileName(path);
  if (file.length > 9 && /^[0-9a-fA-F]{8}_/.test(file)) return file.slice(9);
  return file;
}

function extOf(path: string): string {
  const name = attachmentFileName(path);
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** iOS `MediaKind.isImage`: png jpg jpeg gif webp heic heif bmp (svg → file chip). */
export function isImageAttachment(path: string): boolean {
  return IMAGE_EXT.has(extOf(path));
}

/** iOS `MediaKind.isVoice`: display name (after the `{8hex}_` prefix) starts with `voice_`. */
export function isVoiceAttachment(path: string): boolean {
  return attachmentDisplayName(path).startsWith('voice_');
}

/** iOS `MediaKind.isAudio` (audio/video by extension; voice notes are a subset). */
export function isAudioAttachment(path: string): boolean {
  return AUDIO_EXT.has(extOf(path));
}

/** Row rendering kind (iOS order: image → voice → everything else is a file chip). */
export function classifyAttachment(path: string): AttachmentKind {
  if (isImageAttachment(path)) return 'image';
  if (isVoiceAttachment(path)) return 'voice';
  return 'file';
}

/** `/media/messages/…` → `/api/media/messages/…` (authed endpoint); other URLs unchanged. */
export function toAuthedUrl(url: string): string {
  if (url.startsWith('/media/messages/')) return '/api' + url;
  return url;
}

export function needsAuth(url: string): boolean {
  return url.startsWith('/api/');
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('access_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ───────────────────────────── blob cache ─────────────────────────────

export interface LoadedResource {
  blob: Blob;
  /** blob: URL (lives for the session, never revoked — like web `useProtectedUrl`). */
  src: string;
}

type Entry = { status: 'loading'; promise: Promise<LoadedResource> } | { status: 'ok'; res: LoadedResource } | { status: 'error' };

const cache = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

function notify(key: string) {
  listeners.get(key)?.forEach((l) => l());
}

async function fetchBlob(url: string): Promise<Blob> {
  const auth = needsAuth(url);
  // iOS AuthedImageLoader → MediaCache: attachment IMAGES are kept in the shared on-disk media cache
  // (features/media/mediaCache — LRU + user limit), which Settings → Storage measures and clears.
  // Voice notes / files are not disk-cached on iOS either.
  if (auth && isImageAttachment(url)) return getMediaBlob(url);
  let r = await fetch(url, { headers: auth ? authHeaders() : {} });
  if (r.status === 401 && auth && (await tryRefresh())) r = await fetch(url, { headers: authHeaders() });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.blob();
}

/** Already-loaded resource for `url` (normalised), if any. */
export function peekResource(url: string): LoadedResource | null {
  const e = cache.get(toAuthedUrl(url));
  return e?.status === 'ok' ? e.res : null;
}

/** Loads (or returns the cached / in-flight) resource. A failed load is retried on the next call. */
export function loadResource(url: string): Promise<LoadedResource> {
  const key = toAuthedUrl(url);
  const e = cache.get(key);
  if (e?.status === 'ok') return Promise.resolve(e.res);
  if (e?.status === 'loading') return e.promise;
  if (key.startsWith('blob:') || key.startsWith('data:')) {
    const promise = fetch(key)
      .then((r) => r.blob())
      .then((blob) => {
        const res = { blob, src: key };
        cache.set(key, { status: 'ok', res });
        notify(key);
        return res;
      });
    cache.set(key, { status: 'loading', promise });
    return promise;
  }
  const promise = fetchBlob(key).then(
    (blob) => {
      const res = { blob, src: URL.createObjectURL(blob) };
      cache.set(key, { status: 'ok', res });
      notify(key);
      return res;
    },
    (err) => {
      cache.set(key, { status: 'error' });
      notify(key);
      throw err;
    },
  );
  cache.set(key, { status: 'loading', promise });
  return promise;
}

export interface ResourceState {
  status: 'loading' | 'ok' | 'error';
  src: string;
  blob: Blob | null;
}

/**
 * `useProtectedUrl` with a status (iOS AuthedAsyncImage needs a failure state). `url` may be a stored path,
 * an `/api/media/…` URL, a blob:/data: URL or a public URL. Pass '' / null to stay idle.
 */
export function useProtectedResource(url: string | null | undefined, opts?: { enabled?: boolean }): ResourceState {
  const key = url ? toAuthedUrl(url) : '';
  const enabled = opts?.enabled ?? true;
  const [, force] = useState(0);

  useEffect(() => {
    if (!key) return;
    let alive = true;
    const update = () => {
      if (alive) force((n) => n + 1);
    };
    let set = listeners.get(key);
    if (!set) listeners.set(key, (set = new Set()));
    set.add(update);
    if (enabled) {
      const e = cache.get(key);
      // a previous failure is retried when a new consumer mounts (iOS re-runs `.task` per appearance)
      if (!e || e.status === 'error') {
        if (e?.status === 'error') cache.delete(key);
        loadResource(key).catch(() => {});
        update();
      }
    }
    return () => {
      alive = false;
      set?.delete(update);
    };
  }, [key, enabled]);

  const e = key ? cache.get(key) : undefined;
  if (e?.status === 'ok') return { status: 'ok', src: e.res.src, blob: e.res.blob };
  if (e?.status === 'error') return { status: 'error', src: '', blob: null };
  return { status: 'loading', src: '', blob: null };
}

// ───────────────────────────── download with progress ─────────────────────────────

const downloaded = new Map<string, Blob>();

/** Blob of a file downloaded earlier in this session (instant share on a second tap). */
export function peekDownloaded(url: string): Blob | null {
  const key = toAuthedUrl(url);
  return downloaded.get(key) ?? peekResource(key)?.blob ?? null;
}

/**
 * Authenticated GET with progress (0…1, monotonic — iOS `TransferProgress`). One 401 → refresh → retry.
 */
export function downloadWithProgress(url: string, onProgress: (p: number) => void): Promise<Blob> {
  const key = toAuthedUrl(url);
  const cached = peekDownloaded(key);
  if (cached) {
    onProgress(1);
    return Promise.resolve(cached);
  }
  let best = 0;
  const report = (p: number) => {
    if (p >= best) {
      best = p;
      onProgress(p);
    }
  };
  const attempt = (retry: boolean): Promise<Blob> =>
    new Promise<Blob>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', key);
      if (needsAuth(key)) {
        const h = authHeaders();
        if (h.Authorization) xhr.setRequestHeader('Authorization', h.Authorization);
      }
      xhr.responseType = 'blob';
      xhr.addEventListener('progress', (ev) => {
        if (ev.lengthComputable && ev.total > 0) report(ev.loaded / ev.total);
      });
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          report(1);
          resolve(xhr.response as Blob);
        } else if (xhr.status === 401 && retry && needsAuth(key)) {
          tryRefresh().then((ok) => (ok ? attempt(false).then(resolve, reject) : reject(new Error('401'))), reject);
        } else reject(new Error(`HTTP ${xhr.status}`));
      });
      xhr.addEventListener('error', () => reject(new Error('network')));
      xhr.addEventListener('abort', () => reject(new Error('abort')));
      xhr.send();
    });
  return attempt(true).then((blob) => {
    downloaded.set(key, blob);
    return blob;
  });
}

// ───────────────────────────── share / save ─────────────────────────────

/** Triggers a plain browser download of `blob` named `filename`. */
export function downloadBlob(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  const href = URL.createObjectURL(blob);
  a.href = href;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 30_000);
}

/**
 * iOS `ShareSheet(items: [file])` → Web Share Level 2 (`navigator.share({files})`), else a download.
 * `navigator.share` needs a live user activation; when it was consumed by a long download the browser throws
 * NotAllowedError and we fall back to the download.
 */
export async function shareOrDownload(blob: Blob, filename: string): Promise<void> {
  const type = blob.type || 'application/octet-stream';
  let file: File | null = null;
  try {
    file = new File([blob], filename, { type });
  } catch {
    file = null;
  }
  const nav = navigator as Navigator & { canShare?: (d: { files?: File[] }) => boolean };
  if (file && typeof nav.share === 'function' && typeof nav.canShare === 'function') {
    let can = false;
    try {
      can = nav.canShare({ files: [file] });
    } catch {
      can = false;
    }
    if (can) {
      try {
        await nav.share({ files: [file] });
        return;
      } catch (err) {
        // the user closed the share sheet → done; anything else (no activation, unsupported) → download
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
  }
  downloadBlob(blob, filename);
}

// ───────────────────────────── cache clearing ─────────────────────────────

// Settings → Storage "Clear" / logout: drop every in-memory copy that is not on screen right now (revoking
// its blob: URL) so the memory is released and the next view re-reads through the (now empty) media cache.
// Entries with live subscribers keep their URL — revoking it would break images that are displayed.
onMediaCacheCleared(() => {
  for (const [key, e] of Array.from(cache.entries())) {
    if (e.status === 'loading' || listeners.get(key)?.size) continue;
    if (e.status === 'ok' && e.res.src !== key && e.res.src.startsWith('blob:')) URL.revokeObjectURL(e.res.src);
    cache.delete(key);
  }
  downloaded.clear();
});
