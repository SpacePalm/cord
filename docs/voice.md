[← Back to README](../README.md)

# Voice & Video

End-to-end guide to voice rooms, video calls, screen sharing, the focused-source layout, and DM calls.

- [Joining a voice room](#joining-a-voice-room)
- [Audio controls](#audio-controls)
- [Video calls](#video-calls)
- [Screen sharing](#screen-sharing)
- [Focused-source layout](#focused-source-layout)
- [Resizable strip](#resizable-strip)
- [Strip position](#strip-position)
- [Drag-and-drop source promotion](#drag-and-drop-source-promotion)
- [Per-user volume](#per-user-volume)
- [Floating call widget](#floating-call-widget)
- [Call duration timer](#call-duration-timer)
- [Connection stats](#connection-stats)
- [DM calls](#dm-calls)
- [Mobile / locked-screen behaviour](#mobile--locked-screen-behaviour)
- [Settings reference](#settings-reference)

---

## Joining a voice room

Click any voice channel in the sidebar or use the command palette (`Ctrl+K` → channel name). A LiveKit JWT is fetched from `/api/voice/token?channel_id=...`, and the browser connects directly to the LiveKit server over WebRTC (UDP 7882 primary, TCP 7881 fallback).

By default the microphone is enabled on join (`autoMic = true` in Settings → Audio). The camera is **always disabled by default** — start it explicitly with the camera button.

---

## Audio controls

The bottom controls row contains:

| Button | Action |
|---|---|
| **🎙 / 🎙×** | Mute / unmute your microphone |
| **📷 / 📷×** | Turn camera on / off (hidden if "Allow camera access" is off in Settings) |
| **🎧 / 🎧×** | Deafen — mutes all incoming audio at the WebAudio gain layer (your mic is auto-muted too) |
| **🖥** | Open the screen-share dialog (resolution, FPS, system audio) |
| **📶** | Connection stats panel (ping, bitrate, packet loss, codec) |
| **📞** | Leave the call |

---

## Video calls

Cord supports video natively — it shares the same LiveKit room as audio, so any voice channel can become a video channel by simply turning a camera on.

### Toggling the camera

The camera button is **next to the microphone** in the controls row. Click it to turn the camera on; a permission prompt appears the first time. Click again to turn off.

When your camera is on, your `ParticipantTile` switches from avatar to live video. Other participants see your video in real time; you see theirs the moment they turn theirs on.

### Selecting a camera device

**Settings → Video → Camera dropdown.** All `videoinput` devices reported by `navigator.mediaDevices.enumerateDevices()` are listed. The chosen device:

- Is stored in `localStorage` (per-device — never synchronised between machines)
- Is applied when the camera is turned on
- Can be switched **on the fly during an active call** — `room.switchActiveDevice('videoinput', id)` swaps the input without dropping the call

A live preview area below the dropdown shows what the camera sees — useful to confirm the right device before joining a meeting.

### Privacy: completely disable video

**Settings → Video → "Allow camera access" toggle (off).** When disabled:

- The camera button in the call UI is **not rendered** (not just disabled).
- The camera device dropdown and preview are hidden.
- `getUserMedia({ video: true })` is **never called**, so the browser never asks for camera permission.

This is a hard privacy mode — useful when you don't want the site to even hint that a camera is available.

### How a turned-off camera looks remotely

When you turn off your camera mid-call, LiveKit only **mutes** the track (it stays published). Cord listens to the `muted`/`unmuted` track events and immediately:

1. Swaps your `<video>` element for the avatar fallback.
2. Clears `srcObject` and calls `video.load()` so no last-frame freeze appears in Chrome / Safari.

So other participants see your avatar return the moment you turn off the camera.

---

## Screen sharing

Click the 🖥 button to open the share dialog. Configurable options:

- **Resolution:** 720p, 1080p, 1440p, or `source` (whatever the OS gives you)
- **Framerate:** 5, 15, 30, or 60 FPS
- **System audio:** include / exclude (Chrome only — in the browser dialog you also need to tick "Share audio" / "Share tab audio")

The audio track of a shared screen is published with `AudioPresets.musicHighQualityStereo`, `dtx: false`, `red: true`, `forceStereo: true` — tuned for music and game audio, not voice DTX which would clip quiet passages.

When you leave the call, screen-share `MediaStreamTrack`s are explicitly stopped — the browser's "site is recording your screen" indicator disappears immediately, no need to reload the page.

---

## Focused-source layout

When at least one screen share is active, the room switches to **focused-source mode**:

- One source occupies the **main area** (large pane).
- All other sources — screen shares **and** participant cameras/avatars — sit in a **strip** along one edge.
- Click any thumbnail in the strip to promote it to the main area.

When **no** screen share is active, the room falls back to the classic **grid** of participant tiles (no strip).

The active strip thumbnail is highlighted with an accent-coloured ring; hover on inactive thumbnails shows a swap-indicator overlay.

If the currently focused source disappears (screen share ends, participant leaves, etc.), focus automatically jumps to the next available source — first preferring any remaining screen share, then any participant.

---

## Resizable strip

The strip's size (height in horizontal layout, width in vertical) is **draggable**. A thin handle between the main pane and the strip can be grabbed with mouse or touch; cursor changes to `row-resize` or `col-resize` while dragging.

Constraints:

- **Horizontal strip (bottom / top):** min 60 px, max 60 % of container height.
- **Vertical strip (left / right):** min 100 px, max 50 % of container width.

Sizes are persisted **separately** for the horizontal and vertical axes (`voiceStripSizeHorizontal` and `voiceStripSizeVertical` in `sessionStore`) — switching position doesn't squash your preferred geometry of the other orientation.

All strip layout state lives in `localStorage` only, **never** synchronised to the backend — it's per-device by design.

---

## Strip position

The strip can sit on any of four sides: **bottom** (default), **top**, **left**, **right**.

Top-right corner of the strip has a small **position-menu button** showing the current position (`PanelBottom` / `PanelTop` / `PanelLeft` / `PanelRight`). Click → dropdown with all four options. Outside-click closes the menu.

Implementation-wise: the room container's `flex-direction` is one of `flex-col`, `flex-col-reverse`, `flex-row`, `flex-row-reverse`. Tiles inside the strip switch between `flex-row overflow-x-auto` and `flex-col overflow-y-auto` accordingly. The divider between screens and participants becomes vertical or horizontal as needed.

---

## Drag-and-drop source promotion

Any thumbnail in the strip is `draggable`. Grab a thumbnail and drop it onto the main pane — the source is promoted to focus. This is an alternative to clicking the thumbnail directly.

The drop zone accepts only the `text/cord-source` MIME type, so dragging arbitrary text or files into the call has no effect.

---

## Per-user volume

Click the **`...`** button on any participant's tile (in the strip or the grid) to open their menu:

- **Volume slider 0–300%** — applied via a Web Audio `GainNode` on the participant's remote audio MediaStream.
- **Mute / unmute that user only** — local-side, doesn't broadcast.
- **Open DM** — jumps straight to the 1-to-1 chat with that user.

Volume and per-user mute are persisted in `localStorage` under `cord-voice-user-settings` (per-device).

---

## Floating call widget

While in a call, switch to any other chat / settings page and a small floating widget appears at the top of the page. Drag it anywhere by the gripper — position is saved in `localStorage`. Click the expand icon to return to the full voice room.

The widget shows the channel name, call timer, active speaker indicator, and a hangup button. It's a real LiveKit connection — leaving via the widget runs the same cleanup (track stop, presence update, screen-share recording indicator off).

---

## Call duration timer

When the first participant joins, `cord:call:{channel_id}` is set in Redis to the current Unix-ms timestamp (with `NX` flag — only if not set). On every subsequent fetch of the LiveKit token, that timestamp is returned to the client. The timer is therefore **shared across all participants** and persists across reloads.

When the last participant leaves (`/api/voice/leave` with zero remaining participants), the Redis key is cleared and the next call gets a fresh start time.

---

## Connection stats

The 📶 button opens a panel with live LiveKit transport metrics:

- Round-trip ping
- Audio + video bitrate per direction
- Packet loss
- Active codec
- Connection quality label (poor / good / excellent)

Useful for triaging "my audio is choppy" complaints.

---

## DM calls

Direct messages support 1-to-1 calls with a proper telephony-style flow.

### Initiating

Click the 📞 icon in the DM header or "Call" in the user popover. The backend:

1. Lazily creates a voice channel inside the DM group (if not exists).
2. Generates a LiveKit token, you join the room.
3. Sends WebSocket `incoming_call` to the peer.

### Receiving

The callee sees an **incoming-call overlay** in the bottom-right with:

- Caller's avatar + display name
- "Accept" — joins the room.
- "Decline" — sends WS `call_declined`, caller's session ends + toast appears.

A looping ringtone plays (Web Audio API, no audio files) at the ringtone volume from Settings → Notifications. An OS notification is also fired (with `requireInteraction: true` so it doesn't auto-dismiss).

### Cancelling before pickup

If the caller hangs up before the peer accepts, WS `call_cancelled` is sent — callee's overlay closes and ringtone stops.

### Event dedup

All call-related WS events are deduped by call/message ID, so React StrictMode, HMR, or multi-tab scenarios won't show the same overlay twice.

---

## Mobile / locked-screen behaviour

WebRTC on mobile browsers is hostile to background tabs. Cord ships a few mitigations:

- **`disconnectOnPageLeave: false`** on mobile (`window.innerWidth < 768`). The LiveKit client default is to disconnect cleanly when `pagehide` fires (which iOS Safari triggers when the screen locks). Disabling this makes the room survive short screen-off windows, so the call doesn't drop with a series of "mic on/off" iOS sounds.
- **Wake Lock + Media Session** (`utils/voiceBackgroundGuard.ts`). Acquires `navigator.wakeLock.request('screen')` after the user-gesture join, and registers the call as Now Playing media so iOS keeps the tab in priority while audio is actively rendered.
- **`MediaStreamTrack.stop()` on leave** for screen-share tracks specifically — LiveKit's `disconnect()` doesn't always stop them on its own, so the browser's "site is recording your screen" indicator can linger; Cord stops them explicitly via the `LocalTrackCleanup` component.

What still won't survive: iOS terminating the tab after several minutes of locked screen, or low memory. That's outside the browser's WebRTC budget — only a native wrapper (Capacitor + CallKit + PushKit) can fix that completely.

Desktop minimize / tab-switch is unaffected — the call keeps running.

---

## Settings reference

### Settings → Audio

- **Input device** — microphone dropdown. Applied to LiveKit via `room.switchActiveDevice('audioinput', id)` on the fly during a call.
- **Output device** — speakers/headphones dropdown. Applied via `room.switchActiveDevice('audiooutput', id)`.
- **Mic sensitivity** — local gain 0–300 % via Web Audio `GainNode`.
- **Test mic** — live volume meter to verify the input.
- **Test speakers** — short tone routed through the selected output.
- **Auto-enable microphone** — toggle whether `audio={true}` is passed to LiveKit on join.

### Settings → Video

- **Allow camera access** — global toggle. When off, the camera button is hidden everywhere and `getUserMedia` is never called.
- **Camera** — `videoinput` device dropdown.
- **Test** — live preview.

All Audio/Video device IDs are stored in `localStorage` only — they're per-device and intentionally **not** synchronised through `preferencesSync`, because a `deviceId` from one machine is meaningless on another.

### Settings → Notifications

- **Message sound volume** — affects the in-call "user joined/left" chimes.
- **Ringtone volume** — affects DM incoming-call ring.
