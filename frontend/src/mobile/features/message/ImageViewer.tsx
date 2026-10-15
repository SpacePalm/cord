// iOS `ImageViewer` (Media/MediaViews.swift), presented as a fullScreenCover: black, image aspect-fit;
// pinch (live scale unclamped, committed clamp 1…6 on release, no snap animation), pan only when the committed
// scale > 1 (unbounded; offset survives pinching back to 1), double-tap toggles 1 ⇄ 2.5 (animated, resets the
// offset), single tap inert, no swipe-to-dismiss. Top bar (.title3 white, padding 16 inside the safe area):
// xmark | Spacer | doc.on.doc (PNG to the clipboard, no feedback) | square.and.arrow.up (share sheet).
import './message.css';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { present, type SheetCtx } from '../../present/PresentationProvider';
import { Icon, Spinner } from '../../ui';
import { useMT } from '../../i18n';
import { attachmentFileName, loadResource, shareOrDownload, toAuthedUrl, useProtectedResource } from './media';

/**
 * Full-screen black image viewer (pinch 1–6×, double-tap 1↔2.5×, pan; xmark | copy | share).
 * `url` is a protected attachment URL (/api/media/messages/...) or a public one.
 */
export function openImageViewer(url: string): void {
  // start (or reuse) the fetch right away so the cover usually opens with the decoded image
  loadResource(url).catch(() => {});
  present.presentFullScreen((ctx) => <ImageViewer url={url} ctx={ctx} />);
}

/** PNG blob for the clipboard (most targets only accept image/png). */
function toPngBlob(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return Promise.resolve(blob);
  return new Promise<Blob>((resolve, reject) => {
    const img = new Image();
    const src = URL.createObjectURL(blob);
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const g = c.getContext('2d');
        if (!g) throw new Error('no 2d context');
        g.drawImage(img, 0, 0);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(src);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(src);
      reject(new Error('decode failed'));
    };
    img.src = src;
  });
}

function fileNameFor(url: string, blob: Blob): string {
  const raw = attachmentFileName(url).replace(/^[0-9a-fA-F]{8}_/, '');
  if (raw && /\.[a-z0-9]{2,5}$/i.test(raw)) return raw;
  const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/\+.*$/, '');
  return `${raw || 'image'}.${ext}`;
}

interface Xf {
  s: number;
  x: number;
  y: number;
}

function ImageViewer({ url, ctx }: { url: string; ctx: SheetCtx }) {
  const t = useMT();
  const res = useProtectedResource(url);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [decoded, setDecoded] = useState(false);

  // committed transform (iOS @State scale / offset) + live gesture parts (@GestureState pinch / drag)
  const committed = useRef<Xf>({ s: 1, x: 0, y: 0 });
  const live = useRef({ pinch: 1, dx: 0, dy: 0 });

  const paint = (animate: boolean) => {
    const el = imgRef.current;
    if (!el) return;
    const c = committed.current;
    const l = live.current;
    el.style.transition = animate ? 'transform 350ms cubic-bezier(0.2, 0.9, 0.25, 1)' : 'none';
    el.style.transform = `translate3d(${c.x + l.dx}px, ${c.y + l.dy}px, 0) scale(${c.s * l.pinch})`;
  };

  useLayoutEffect(() => {
    paint(false);
  });

  // gestures (pointer events; touch-action:none on the stage)
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const pts = new Map<number, { x: number; y: number }>();
    let mode: 'none' | 'pan' | 'pinch' = 'none';
    let startDist = 1;
    let panStart = { x: 0, y: 0 };
    let lastTap = { t: 0, x: 0, y: 0 };
    let downAt = { t: 0, x: 0, y: 0 };
    let moved = false;

    const dist = () => {
      const [a, b] = Array.from(pts.values());
      return Math.hypot(a.x - b.x, a.y - b.y) || 1;
    };
    const endPinch = () => {
      const c = committed.current;
      c.s = Math.max(1, Math.min(c.s * live.current.pinch, 6));
      live.current.pinch = 1;
      paint(false);
    };
    const endPan = () => {
      const c = committed.current;
      c.x += live.current.dx;
      c.y += live.current.dy;
      live.current.dx = 0;
      live.current.dy = 0;
      paint(false);
    };
    const beginPan = (p: { x: number; y: number }) => {
      mode = 'pan';
      panStart = { ...p };
    };

    const down = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest('.m-msg-viewer-bar')) return;
      e.preventDefault();
      try {
        stage.setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) {
        downAt = { t: performance.now(), x: e.clientX, y: e.clientY };
        moved = false;
        beginPan({ x: e.clientX, y: e.clientY });
      } else if (pts.size === 2) {
        if (mode === 'pan') endPan();
        mode = 'pinch';
        startDist = dist();
        moved = true;
      }
    };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 10) moved = true;
      if (mode === 'pinch' && pts.size >= 2) {
        live.current.pinch = dist() / startDist;
        paint(false);
      } else if (mode === 'pan' && committed.current.s > 1) {
        live.current.dx = e.clientX - panStart.x;
        live.current.dy = e.clientY - panStart.y;
        paint(false);
      }
    };
    const up = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (mode === 'pinch') {
        if (pts.size < 2) {
          endPinch();
          // the remaining finger continues as a (possible) pan from where it is
          const rest = Array.from(pts.values())[0];
          if (rest) beginPan(rest);
          else mode = 'none';
        }
        return;
      }
      if (mode === 'pan') {
        endPan();
        mode = 'none';
      }
      if (e.type === 'pointercancel' || moved) return;
      // tap → double-tap detection (iOS: single tap does nothing)
      const now = performance.now();
      if (now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
        lastTap = { t: 0, x: 0, y: 0 };
        const c = committed.current;
        c.s = c.s > 1 ? 1 : 2.5;
        c.x = 0;
        c.y = 0;
        paint(true);
      } else lastTap = { t: now, x: e.clientX, y: e.clientY };
    };
    const noGesture = (e: Event) => e.preventDefault(); // iOS Safari page pinch
    stage.addEventListener('pointerdown', down);
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener('gesturestart', noGesture);
    stage.addEventListener('gesturechange', noGesture);
    return () => {
      stage.removeEventListener('pointerdown', down);
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerup', up);
      stage.removeEventListener('pointercancel', up);
      stage.removeEventListener('gesturestart', noGesture);
      stage.removeEventListener('gesturechange', noGesture);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const blob = res.blob;

  const copy = () => {
    if (!blob) return;
    try {
      const CI = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
      if (!CI || !navigator.clipboard?.write) return;
      // Promise-valued item keeps Safari's user-activation requirement satisfied while converting to PNG
      void navigator.clipboard.write([new CI({ 'image/png': toPngBlob(blob) })]).catch(() => {});
    } catch {
      /* no feedback on iOS either */
    }
  };

  const share = () => {
    if (!blob) return;
    void shareOrDownload(blob, fileNameFor(toAuthedUrl(url), blob));
  };

  return (
    <div className="m-msg-viewer">
      <div className="m-msg-viewer-stage" ref={stageRef}>
        {res.src ? (
          <img
            ref={imgRef}
            className="m-msg-viewer-img"
            src={res.src}
            alt=""
            draggable={false}
            style={decoded ? undefined : { opacity: 0 }}
            onLoad={() => setDecoded(true)}
          />
        ) : null}
        {res.status === 'error' ? (
          <div className="m-msg-viewer-msg">
            <Icon name="photo" size={15} />
            <span>{t('media.loadFailed')}</span>
          </div>
        ) : !decoded ? (
          <div className="m-msg-viewer-msg">
            <Spinner color="#fff" />
          </div>
        ) : null}
      </div>
      <div className="m-msg-viewer-bar">
        <button type="button" className="m-msg-viewer-btn" aria-label={t('common.close')} onClick={() => void ctx.dismiss()}>
          <Icon name="xmark" size={32} strokeWidth={2.1} />
        </button>
        <span className="m-msg-viewer-spacer" />
        <button type="button" className="m-msg-viewer-btn" aria-label={t('chat.copy')} disabled={!blob} onClick={copy}>
          <Icon name="doc.on.doc" size={24} strokeWidth={1.7} />
        </button>
        <button type="button" className="m-msg-viewer-btn" aria-label={t('message.share')} disabled={!blob} onClick={share}>
          <Icon name="square.and.arrow.up" size={24} strokeWidth={1.7} />
        </button>
      </div>
    </div>
  );
}
