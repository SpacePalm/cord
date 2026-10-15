// Public voice entry points for the other mobile areas.
// Call them directly from tap handlers (they start the mic-permission prompt / audio unlock inside
// the user gesture, as iOS Safari requires).
import { useSessionStore } from '../../../store/sessionStore';
import {
  acceptIncomingFlow,
  declineIncomingFlow,
  joinVoiceFlow,
  leaveVoiceFlow,
  resetVoice as resetVoiceEngine,
  startDmCallFlow,
} from './voiceEngine';
import { setShowRoom, useVoiceStore } from './voiceStore';

/** Tap on a voice channel row: join immediately and open the room sheet (iOS has no pre-join screen). */
export function joinVoiceChannel(opts: { channelId: string; channelName: string; groupId: string; groupName: string }): void {
  void joinVoiceFlow({ channelId: opts.channelId, name: opts.channelName, groupId: opts.groupId, groupName: opts.groupName });
}

/**
 * DM phone button / member menu "Позвонить": start a 1:1 call ("Звоним…") and open the room sheet.
 * If I'm already in this DM's call, just re-opens the room.
 */
export function startDmCall(opts: { groupId: string; peerName: string; peerImagePath?: string | null }): void {
  void startDmCallFlow(opts);
}

/** Re-open the room sheet of the active call (floating bar tap). */
export function openVoiceRoom(): void {
  const active = !!useSessionStore.getState().voicePresence || useVoiceStore.getState().permissionDenied;
  if (active) setShowRoom(true);
}

/** Collapse the room sheet (the call keeps running in the floating bar). */
export function collapseVoiceRoom(): void {
  setShowRoom(false);
}

/** Hang up the current call / voice channel. */
export function leaveVoiceCall(): void {
  leaveVoiceFlow();
}

/** Accept / decline the incoming-call card. */
export function acceptIncomingCall(): void {
  void acceptIncomingFlow();
}
export function declineIncomingCall(): void {
  declineIncomingFlow();
}

/**
 * iOS `voice.reset()` for logout: stop ringing, drop the call card / notice and leave the call.
 * Call it BEFORE the auth tokens are cleared (so /voice/leave and the DM cancel are authorised).
 * (If it isn't called, the engine still drops the call locally when the token disappears.)
 */
export function resetVoice(): void {
  resetVoiceEngine();
}

/** True while the incoming-call card is on screen (the in-app message banner hides meanwhile). */
export function useIncomingCallVisible(): boolean {
  return useVoiceStore((s) => s.incoming !== null);
}

/** True while a call / voice channel is active (connecting or connected). */
export function useInVoice(): boolean {
  return useSessionStore((s) => s.voicePresence !== null);
}

/** Channel id of the active voice room (null when not in voice) — for "I'm here" marks. */
export function useActiveVoiceChannelId(): string | null {
  return useSessionStore((s) => s.voicePresence?.channelId ?? null);
}
