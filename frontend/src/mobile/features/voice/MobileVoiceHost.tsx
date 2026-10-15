import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isAnythingPresented, present, type SheetCtx } from '../../present/PresentationProvider';
import { startVoiceEngine, stopVoiceEngine } from './voiceEngine';
import { setShowRoom, useVoiceStore } from './voiceStore';
import { dismissVoiceChildren } from './voicePresent';
import { VoiceRoomSheet } from './VoiceRoomSheet';
import { CallNotice, FloatingVoiceBar, IncomingCallCard } from './VoiceOverlays';

/** Presents / dismisses the room sheet following `showRoom` (iOS `.sheet(isPresented: $voice.showRoom)`). */
function useRoomSheet() {
  useEffect(() => {
    let ctx: SheetCtx | null = null;
    let alive = true;
    const open = () => {
      if (!alive || ctx || !useVoiceStore.getState().showRoom) return;
      const me: SheetCtx = present.presentSheet(() => <VoiceRoomSheet />, {
        detents: ['large'],
        onDismiss: () => {
          // swipe-down / back / dismissAll (navigation): collapse — the call keeps running
          if (ctx === me) {
            ctx = null;
            setShowRoom(false);
          }
        },
      });
      ctx = me;
    };
    const sync = (show: boolean) => {
      if (show && !ctx) {
        // the room is presented from the app root: close whatever sheet is up first
        if (isAnythingPresented()) void present.dismissAll().then(open);
        else open();
      } else if (!show && ctx) {
        const c = ctx;
        ctx = null;
        void dismissVoiceChildren();
        void c.dismiss();
      }
    };
    sync(useVoiceStore.getState().showRoom);
    const unsub = useVoiceStore.subscribe((s, p) => {
      if (s.showRoom !== p.showRoom) sync(s.showRoom);
    });
    return () => {
      alive = false;
      unsub();
      if (ctx) {
        const c = ctx;
        ctx = null;
        void c.dismiss();
      }
    };
  }, []);
}

/**
 * Mounted ONCE by MobileApp. Owns the LiveKit connection for the whole mobile session (survives
 * navigation), presents the voice room sheet, and renders FloatingVoiceBar, IncomingCallCard and
 * CallNotice overlays. While the floating bar is visible it sets the CSS variable
 * --ios-floating-bar-h on <html> (e.g. "62px"; "0px" otherwise) so screens can reserve space.
 */
export function MobileVoiceHost() {
  const qc = useQueryClient();
  useEffect(() => {
    startVoiceEngine(qc);
    return () => stopVoiceEngine();
  }, [qc]);
  useRoomSheet();
  return (
    <>
      <FloatingVoiceBar />
      <IncomingCallCard />
      <CallNotice />
    </>
  );
}
