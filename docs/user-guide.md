[← Back to README](../README.md)

# User Guide

- [Getting Started](#getting-started)
- [Text Chats](#text-chats)
- [Voice & Video](#voice--video) → full guide in [voice.md](voice.md)
- [Notifications](#notifications)
- [Settings](#settings)
- [Command Palette](#command-palette)
- [Direct Messages](#direct-messages)
- [Search](#search)

---

## Getting Started

1. Register at the login page (if registration is enabled) or use an invite link
2. Create a group or join an existing one via invite
3. Start chatting in text chats or join a voice chat
4. Press `Ctrl+K` to explore the command palette

---

## Text Chats

- **Send messages** — type and press Enter (Shift+Enter for new line)
- **Format text** — `**bold**`, `*italic*`, `||spoiler||`, or use toolbar buttons
- **Reply** — hover over a message and click reply, or right-click for full menu
- **Forward** — forward messages to other chats
- **Attachments** — drag & drop or click the paperclip icon (SVG blocked to prevent XSS)
- **Voice messages** — click the microphone icon to record
- **Polls** — click the chart icon to create a poll (up to 10 options)
- **Search in chat** — click the magnifying glass to search messages in the current chat
- **Global search** — press `Ctrl+K` and type
- **React to message** — hover the message, click the smile icon, pick emoji
- **Right-click any message** — opens the full context menu (react, reply, edit, copy, pin, forward, select, delete)
- **Click any user avatar/name** — popover with «Open chat» and «Call» actions
- **Edit your own message** — toolbar pencil or `E` shortcut; the textarea **auto-resizes** as you type (min 40 px, max 400 px) so long messages aren't cramped into a 2-line scrolling box

---

## Voice & Video

See the dedicated [Voice & Video guide](voice.md) for:

- Joining a voice room, audio controls
- Toggling camera + selecting video device + global privacy disable
- Screen sharing with quality / FPS / system audio
- Focused-source layout with one main pane + strip of all sources
- Resizable strip + 4 strip positions (bottom / top / left / right) + drag-and-drop source promotion
- Per-user volume and local mute
- Floating call widget
- DM calls (incoming-call overlay, ringtone, accept/decline/cancel)
- Mobile / locked-screen behaviour

---

## Notifications

- **Unread badges** — red counters on chats, groups, and the Cord logo (total DM unread)
- **Browser notifications** — enable in Settings → Notifications (requires browser permission)
- **Notification levels** — Everything / Mentions & DMs (default) / DMs only / Off
- **Per-chat mute** — click the 🔔 icon in the chat header to toggle; muted chats don't trigger sound, OS notifications, or in-app toasts
- **Sound** — short chime for messages with volume slider; separate ringtone volume for calls
- **Toast banners** — slide in from the top-right with sender avatar and message preview; click to open the chat

### Delivery Layers

1. **Real-time WebSocket `/ws`** — persistent connection per browser tab, receives `message_created`, `typing`, `voice_participants`, `incoming_call`, `call_declined`, `call_cancelled`
2. **In-app toasts** — rendered in the top-right, 5s auto-dismiss, click opens the chat
3. **OS notifications** — via browser Notification API, work when tab is in background (but **not** when browser is closed — that requires Web Push Service Worker, not implemented)
4. **Sounds** — Web Audio API generates tones inline (no audio files shipped)

### @Mention Detection

Client-side regex `(^|\W)@username(?!\w)` matches mentions in incoming `message_created` events. When the current user is mentioned:

- Notification is shown with a `✳` prefix in the body
- `requireInteraction: true` — stays visible until clicked
- Triggers even if the user's level is «Mentions & DMs» and the chat is a non-DM group

### Call Events

- **Incoming call** — overlay in bottom-right with Accept/Decline buttons, looping ringtone, OS notification
- **Cancel by caller** (hangup before pickup) — callee's overlay closes, ringtone stops
- **Decline by callee** — caller's voice session ends, toast: «*peer* declined the call»
- **Event dedup** — all notification events are deduped by message/call ID to handle StrictMode, HMR, and multi-tab scenarios

---

## Settings

- **Profile** — change avatar (with cropping), display name, email
- **Security** — change password
- **Audio** — select input/output devices, adjust mic sensitivity, test speakers
- **Video** — allow/disallow camera access (privacy mode), select camera device, test preview. See [Voice & Video](voice.md#settings--video) for details
- **Notifications** — toggle browser notifications, choose notification level, independent volume sliders for messages and ringtone, test buttons
- **Appearance** — choose theme preset or customize colors, border radius, font size, font family; export/import themes. See [Customization](customization.md)
- **Language** — switch between English and Russian. See [Customization](customization.md#internationalization)

---

## Command Palette

Press **`Ctrl+K`** (or `Cmd+K` on Mac) anywhere in the app to open the global command palette.

### What you can search

| Filter | Prefix | Finds |
|---|---|---|
| **All** | — | Everything below merged |
| **Servers & channels** | `#` | Channels in all your groups, servers themselves |
| **People** | `@` | Users — your contacts by partial match; strangers only by exact username |
| **Messages** | — | Full-text search across all chats you're a member of |
| **Commands** | `>` | Settings tabs, app actions, admin commands (if admin) |

### Keyboard shortcuts

| Key | Action |
|---|---|
| `↑` / `↓` | Navigate results |
| `Enter` | Pick highlighted result |
| `Tab` / `Shift+Tab` | Cycle filter chips |
| `Backspace` on empty input | Clear active filter |
| `Esc` | Close |

### Actions available

- **Jump to** any channel/DM → switches to it instantly
- **Open settings** → opens the right settings tab directly (`profile`, `audio`, `video`, `appearance`, `notifications`, ...)
- **Open DM with user** → creates DM if not exists, navigates to it
- **Jump to message** → switches to the correct channel and scrolls to the message, highlighting it
- **Admin actions** (admin only): open admin panel, jump to users/system tabs — disabled during an active call

### History

After a successful result selection (message or person), the query is saved. When the palette is opened with an empty input and no filter active, recent searches are shown at the top.

---

## Direct Messages

DMs are implemented as `Group` rows with `is_dm=true` flag, reusing existing infrastructure (chats, messages, WebSocket, LiveKit) for free.

### Opening a DM

- From the command palette: press `Ctrl+K`, filter «People» or type `@username`, Enter
- From anywhere: click a user's avatar or name, select «Open chat» in the popover
- The operation is idempotent — opening a DM with the same person returns the existing conversation

### DM List

- Click the **Cord logo** in the top-left to open the DM panel (replaces the server channel sidebar)
- DMs are sorted by most recent activity
- Each row shows: peer's avatar with online-status dot, display name, last message preview, timestamp, unread count
- The Cord logo itself shows a total unread badge

### Starting a Call

- Click the 📞 icon in the DM header, or use the «Call» action in the user popover
- A voice channel is created lazily inside the DM group
- The other user receives an **incoming call overlay** with ringtone and OS notification
- «Accept» → both join the LiveKit room
- «Decline» → caller is notified via `call_declined` event, their client leaves the LiveKit room and shows a toast
- «Cancel» (by caller hanging up before pickup) → callee's ringtone and overlay close via `call_cancelled` event

### DM Protection

DM groups are protected from modification:

- Cannot be deleted (`DELETE /groups/{id}` returns 400)
- Cannot be left (`POST /groups/{id}/leave` returns 400)
- Cannot be renamed (`PATCH /groups/{id}` returns 400)
- Cannot create or modify channels inside DM
- Cannot kick participants
- Cannot create invite codes (privacy)
- Admin panel cannot delete DMs

### Privacy

User search uses a Telegram-style model:

- **Contacts** (users who share any group or DM with you) are findable by partial match in username or display name
- **Strangers** are only findable by **exact** username match
- Prevents database enumeration via short queries

---

## Search

### Global Message Search

- Endpoint: `GET /api/search/messages?q=foo&limit=10`
- Backend uses PostgreSQL `tsvector` column with Russian dictionary (handles both Russian and English)
- Indexed via GIN — typical response time **<50ms on 1M+ messages**
- Results ranked by `ts_rank` (relevance), tie-broken by `created_at DESC`
- **Stemming** — searching «оптимизации» finds «оптимизация», «оптимизировать», etc.
- **Multi-word AND** — `plainto_tsquery` splits query by whitespace, requires all words
- Only messages from chats the caller is a member of are returned
- Results are cached in Redis for 30s per `(user_id, query)`

### User Search

- Endpoint: `GET /api/users/search?q=foo&limit=10`
- ILIKE with GIN trigram index on `username` and `display_name`
- Privacy model: contacts by substring, strangers by exact username
- Multi-word AND (`ivan petrov` requires both words)
- Rate-limited to 60/min per IP
- Results cached in Redis for 30s

### Per-chat Search

- Endpoint: `GET /api/chats/{id}/messages/search?q=foo&limit=20&before=...`
- ILIKE with trigram index, also searches attachment `file_path`
- First page cached in Redis for 30s per `(user, chat, query)`
