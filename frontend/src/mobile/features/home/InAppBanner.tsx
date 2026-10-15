// iOS InAppBannerView — global top overlay Mounted once by
// MobileApp (outside the receded card stack, z 500 — drawn above sheets).
//  · single slot: a new banner replaces the current one in place and restarts the 4 s timer
//  · hidden while the incoming-call card is visible (the timer keeps running; slides back in after)
//  · tap anywhere (card + its 10/6 px outer margins) → close modals, navigate to the chat (QuickRoute)
//  · swipe up (> 20 px; any drag ≥ 12 px cancels the tap) → dismiss; the card does not follow the finger
// Also hosts the shell data sync (useShellSync) since it is the one always-mounted mobile component.
// @refresh reset
// (dev/HMR only: useShellSync / useIncomingCallVisible live in plain .ts modules, which get no Fast Refresh
// hook signatures — an edit that adds a hook there would otherwise re-render this component with a
// different hook list and crash it. Remount instead.)
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { subscribeMobileBanners, type MobileBannerEvent } from '../../../hooks/useUnreadCounts';
import { mobileNav } from '../../nav/NavStack';
import { present } from '../../present/PresentationProvider';
import { Avatar } from '../../ui';
import { useIncomingCallVisible } from '../voice/voiceActions';
import { useShellSync } from './homeData';
import './home.css';

const AUTO_HIDE_MS = 4000;
const OUT_MS = 380;

/** Global top banner for new messages (single slot, 4s, swipe-up dismiss). Mounted once by MobileApp. */
export function InAppBanner() {
  useShellSync();
  const callVisible = useIncomingCallVisible();
  const [banner, setBanner] = useState<MobileBannerEvent | null>(null);
  const [active, setActive] = useState(false);
  const [entered, setEntered] = useState(false);
  const timer = useRef<number | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const clearTimer = () => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const dismiss = useCallback(() => {
    clearTimer();
    setActive(false);
  }, []);

  useEffect(
    () =>
      subscribeMobileBanners((b) => {
        setBanner(b);
        setActive(true);
        clearTimer();
        timer.current = window.setTimeout(() => {
          timer.current = null;
          setActive(false);
        }, AUTO_HIDE_MS);
      }),
    [],
  );
  useEffect(() => () => clearTimer(), []);

  const visible = !!banner && active && !callVisible;

  // slide in on (re)appearance: commit the off-screen style first, then transition to the shown one
  useLayoutEffect(() => {
    if (!visible) {
      setEntered(false);
      return;
    }
    if (entered) return;
    void wrapRef.current?.offsetHeight;
    setEntered(true);
  }, [visible, entered]);

  // after the out-transition of a dismissed banner, drop it
  useEffect(() => {
    if (active || !banner) return;
    const id = window.setTimeout(() => setBanner(null), OUT_MS);
    return () => window.clearTimeout(id);
  }, [active, banner]);

  // ── gestures: tap vs. swipe-up (no live translation, like iOS) ──
  // The tap is handled on `click`, not on pointerup: hiding the banner (pointer-events: none) on pointerup
  // would hand the click that follows a touch to whatever lies underneath — e.g. the back button of the
  // chat that the tap just pushed.
  const start = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const lastMoved = useRef(false);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary) return;
    start.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - s.x, e.clientY - s.y) >= 12) s.moved = true;
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    start.current = null;
    if (!s || s.id !== e.pointerId || !banner) return;
    const dy = e.clientY - s.y;
    lastMoved.current = s.moved || Math.hypot(e.clientX - s.x, dy) >= 12;
    if (lastMoved.current && dy < -20) dismiss();
  };
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    // a drag (swipe-up or any move ≥ 12px) never taps
    if (lastMoved.current) {
      lastMoved.current = false;
      return;
    }
    if (!banner || !visible || e.button !== 0) return;
    const b = banner;
    dismiss();
    void present.dismissAll().then(() => {
      mobileNav.navigate({ name: 'chat', chatId: b.chatId, title: b.routeTitle, groupId: b.groupId });
    });
  };

  if (!banner) return null;
  return (
    <div
      ref={wrapRef}
      className="m-home-banner-wrap"
      data-in={entered && visible ? 'true' : 'false'}
      aria-hidden={!visible}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        start.current = null;
        lastMoved.current = true;
      }}
      onClick={onClick}
    >
      <div className="m-home-banner" role="button" aria-label={`${banner.title}. ${banner.body}`}>
        <Avatar src={banner.avatar} name={banner.authorName} size={38} />
        <div className="m-home-banner-text" key={banner.id}>
          <div className="m-home-banner-title">{banner.title}</div>
          <div className="m-home-banner-body">{banner.body}</div>
        </div>
      </div>
    </div>
  );
}
