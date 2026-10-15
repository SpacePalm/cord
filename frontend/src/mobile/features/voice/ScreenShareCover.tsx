// iOS `ScreenShareFullscreenView` (fullScreenCover): black, video .fit, pinch 1…6× (unclamped while
// pinching, clamped without animation on release), pan while zoomed, double-tap 1× ↔ 2.5× around the
// centre, top bar xmark + "Name · демонстрирует экран" + volume. Closes itself when the share ends.
import { useEffect, useRef, type PointerEvent as RPointerEvent } from 'react';
import { useMT } from '../../i18n';
import { Icon } from '../../ui/Icon';
import type { SheetCtx } from '../../present/PresentationProvider';
import { useVoiceStore } from './voiceStore';
import { GlyphButton, ScreenVolumeSlider, VideoView } from './VoiceBits';
import { presentVoiceFullScreen } from './voicePresent';
import './voice.css';

interface Zoom {
  scale: number;
  x: number;
  y: number;
}

function useZoom() {
  const surface = useRef<HTMLDivElement | null>(null);
  const content = useRef<HTMLDivElement | null>(null);
  const st = useRef({
    z: { scale: 1, x: 0, y: 0 } as Zoom,
    live: { scale: 1, x: 0, y: 0 } as Zoom,
    pointers: new Map<number, { x: number; y: number }>(),
    pinch: null as null | { dist: number; base: number },
    pan: null as null | { x: number; y: number; bx: number; by: number },
    tap: null as null | { t: number; x: number; y: number; moved: boolean },
    lastTap: 0,
  });

  const apply = (z: Zoom, animate: boolean) => {
    const el = content.current;
    if (!el) return;
    el.style.transition = animate ? 'transform 500ms cubic-bezier(0.25, 0.1, 0.25, 1)' : 'none';
    el.style.transform = `translate(${z.x}px, ${z.y}px) scale(${z.scale})`;
  };

  const dist = () => {
    const ps = [...st.current.pointers.values()];
    if (ps.length < 2) return 0;
    return Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
  };

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    const s = st.current;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (s.pointers.size === 2) {
      s.pan = null;
      s.tap = null;
      s.pinch = { dist: dist() || 1, base: s.z.scale };
    } else if (s.pointers.size === 1) {
      s.tap = { t: performance.now(), x: e.clientX, y: e.clientY, moved: false };
      s.pan = s.z.scale > 1 ? { x: e.clientX, y: e.clientY, bx: s.z.x, by: s.z.y } : null;
    }
  };

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const s = st.current;
    if (!s.pointers.has(e.pointerId)) return;
    s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (s.tap && Math.hypot(e.clientX - s.tap.x, e.clientY - s.tap.y) > 10) s.tap.moved = true;
    if (s.pinch && s.pointers.size >= 2) {
      // live pinch is not clamped (iOS `scale * pinch`)
      s.live = { ...s.z, scale: s.pinch.base * (dist() / s.pinch.dist) };
      apply(s.live, false);
    } else if (s.pan) {
      s.live = { scale: s.z.scale, x: s.pan.bx + (e.clientX - s.pan.x), y: s.pan.by + (e.clientY - s.pan.y) };
      apply(s.live, false);
    }
  };

  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    const s = st.current;
    if (!s.pointers.has(e.pointerId)) return;
    s.pointers.delete(e.pointerId);
    if (s.pinch) {
      if (s.pointers.size < 2) {
        const scale = Math.max(1, Math.min(6, s.live.scale));
        s.z = scale <= 1 ? { scale: 1, x: 0, y: 0 } : { ...s.live, scale };
        s.live = s.z;
        s.pinch = null;
        apply(s.z, false); // jumps to the clamped value (no animation), like iOS
        const rest = [...s.pointers.values()][0];
        s.pan = rest && s.z.scale > 1 ? { x: rest.x, y: rest.y, bx: s.z.x, by: s.z.y } : null;
      }
      return;
    }
    if (s.pan) {
      s.z = s.live;
      s.pan = null;
    }
    const tap = s.tap;
    s.tap = null;
    if (e.type === 'pointerup' && tap && !tap.moved && performance.now() - tap.t < 300) {
      const now = performance.now();
      if (now - s.lastTap < 300) {
        s.lastTap = 0;
        s.z = s.z.scale > 1 ? { scale: 1, x: 0, y: 0 } : { scale: 2.5, x: 0, y: 0 };
        s.live = s.z;
        apply(s.z, true);
      } else s.lastTap = now;
    }
  };

  return { surface, content, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp } };
}

export function ScreenShareCover({ identity, name, ctx }: { identity: string; name: string; ctx?: SheetCtx }) {
  const t = useMT();
  const track = useVoiceStore((s) => s.members.find((m) => m.id === identity)?.screenTrack ?? null);
  const ended = !track;
  const { surface, content, handlers } = useZoom();

  // auto-dismiss when the participant stops sharing or leaves
  useEffect(() => {
    if (ended) void ctx?.dismiss();
  }, [ended, ctx]);

  return (
    <div className="m-voice-cover">
      <div className="m-voice-cover-surface" ref={surface} {...handlers}>
        {track ? (
          <div className="m-voice-cover-content" ref={content}>
            <VideoView track={track} fit="contain" />
          </div>
        ) : (
          <div className="m-voice-cover-ended ios-t-body">{t('voice.screenEnded')}</div>
        )}
      </div>
      <div className="m-voice-cover-bar">
        <GlyphButton onPress={() => void ctx?.dismiss()} ariaLabel={t('common.close')}>
          <Icon name="xmark" size={24} strokeWidth={2.2} />
        </GlyphButton>
        <span className="ios-t-subheadline ios-truncate m-voice-cover-title">
          {name + ' · ' + t('voice.sharingScreen')}
        </span>
        {!ended && <ScreenVolumeSlider identity={identity} width={110} />}
      </div>
    </div>
  );
}

export function openScreenShareCover(identity: string, name: string): void {
  presentVoiceFullScreen((ctx) => <ScreenShareCover identity={identity} name={name} ctx={ctx} />);
}
