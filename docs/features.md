[← Back to README](../README.md)

# Features

A high-level overview of what Cord can do. Each section links to the detailed guide.

- [Communication](#communication) → see [Voice & Video](voice.md), [User Guide](user-guide.md)
- [Social](#social)
- [Search](#search)
- [Command Palette](#command-palette) → see [User Guide](user-guide.md#command-palette)
- [Notifications](#notifications) → see [User Guide](user-guide.md#notifications)
- [Message Actions](#message-actions)
- [Customization](#customization) → see [Theming & i18n](customization.md)
- [Administration](#administration) → see [Admin Panel](administration.md)

---

## Communication

- **Text Chats** — messages with markdown (`**bold**`, `*italic*`, `||spoiler||`), replies, forwards, file attachments, voice messages, reactions
- **Direct Messages** — private 1-to-1 conversations with text and voice/video calls; list with unread counts and last message preview
- **Saved Messages** — per-user personal space with multiple text channels for notes and bookmarks
- **Polls** — create polls with multiple options, one vote per user, real-time results
- **Voice Chats** — real-time audio via [LiveKit](https://livekit.io) WebRTC with mute/deafen controls
- **Video Calls** — camera toggle in any voice room, configurable input device, global privacy disable in Settings
- **DM Calls** — 1-to-1 voice/video calls with incoming-call overlay, ringtone, accept/decline/cancel flow
- **Floating Call Widget** — draggable mini-window while browsing other chats; click to expand back into the full voice room
- **Screen Sharing** — configurable resolution (720p–1440p), FPS (5–60), system audio capture
- **Focused-source view** — when screen sharing or cameras are active, one source fills the main area; a strip of all other sources can sit on any side (bottom / top / left / right), be resized, and clicked or dragged to promote any source as main
- **Call Duration Timer** — shared conference timer synced via Redis, persists across reloads
- **Per-user Volume** — mute individual users, adjust volume 0–300%, per-user settings persist
- **Mobile-friendly** — call survives short screen-off windows (Wake Lock + Media Session + `disconnectOnPageLeave: false`)

---

## Social

- **Groups (Servers)** — create groups with text and voice chats, custom avatars
- **Members** — online status tracking with heartbeat (120s TTL), member list with avatars
- **Invite Links** — 24-hour expiring invite codes with shareable URLs
- **User Profiles** — custom avatars with image cropping, display names
- **Privacy-aware User Search** — find people by exact username only; existing contacts are fuzzy-searchable
- **Click-to-DM** — click any user's avatar/name anywhere to open chat or start a call

---

## Search

- **Global Message Search** — Postgres full-text search with Russian/English stemming, ranking by relevance
- **Per-chat Search** — search messages within a specific channel via the search panel
- **User Search** — find contacts with multi-word matching (`ivan petrov`), strangers by exact username
- **Match Highlighting** — search results highlight matching terms in previews with smart context snippets
- **Search History** — last 10 successful searches available in the command palette

---

## Command Palette

- **Global shortcut** `Ctrl+K` / `Cmd+K` or button in the channel sidebar
- **Navigate** to any server, channel, DM, or settings tab in a single keystroke
- **Search** channels, servers, people, messages from one prompt
- **Filter chips** or prefix shortcuts: `#` servers/channels, `@` people, `>` commands
- **Role-aware admin actions** — admin-only commands hidden for regular users
- **Disabled during active call** — admin-panel navigation is blocked while in a voice call (prevents accidental LiveKit disconnect)

---

## Notifications

- **OS-level Push** — desktop notifications with sender avatar, name, and message preview; click to jump to the chat
- **In-app Toasts** — slide-in banners in the top-right corner with the same rich content
- **Unread Badges** — per-chat, per-group, and per-DM counters update in real time via WebSocket
- **Notification Levels** — All / Mentions & DMs / DMs only / Off
- **Per-chat Mute** — bell icon 🔔 in chat headers to mute individual channels/DMs
- **Ringtone** — looping phone-style ring for incoming DM calls with separate volume control
- **Notification Sound** — short chime for new messages with independent volume slider
- **@Mention detection** — mentions are highlighted in notifications and marked as high-priority (persistent, not auto-dismissed)

---

## Message Actions

- **Hover Toolbar** — quick access to react, reply, edit (own), copy, delete, more menu
- **Right-click Context Menu** — full action menu anchored to cursor position with all operations
- **Forwarding** — forward single messages or bulk-forward multiple messages to any chat
- **Pin Messages** — pinned messages accessible via header panel
- **Reactions** — emoji reactions with aggregated counts and hover tooltips showing who reacted
- **Auto-resizing edit form** — when editing a long message, the textarea grows to fit content (up to 400 px) instead of forcing scroll inside a 2-line box

---

## Customization

- **Theme Engine** — 120+ built-in presets across editor-style (Dracula, Monokai Pro, One Dark, Solarized, GitHub, Tokyo Night, Catppuccin, Gruvbox, Nord, Kanagawa, ...), nature-inspired (Forest, Ocean Depths, Sakura, Everforest, Rose Pine, ...), and mood-based (Cyberpunk, Sunset Ember, Cotton Candy, Midnight, ...) categories + full color customization (11 colors)
- **Shape Controls** — adjustable border radius (0–20px) and font size (12–18px)
- **Font Customization** — 22 fonts from Google Fonts, loaded on demand
- **Theme Import/Export** — save and share themes as JSON files
- **Live Preview** — real-time theme preview panel in settings
- **Multi-language** — English and Russian, extensible; app uses browser-appropriate locale for dates

---

## Administration

- **User Management** — search, block/unblock, promote/demote admins, delete users
- **Group Management** — view all non-system groups (DM and personal groups are hidden)
- **System Settings** — toggle registration, view disk/DB statistics
- **Granular Cleanup** — delete old messages with independent toggles for including personal messages and direct messages
- **Brute-force Protection (fail2ban)** — auto-ban IPs and lock accounts after failed login thresholds, configurable from the admin panel
- **Login Attempt Log** — append-only audit log of all login attempts (success + fail), grouped by IP, showing which usernames were tried from which address
- **IP Blocking** — manual block/unblock of individual IPs (1h / 1d / 7d / 30d / permanent) from the log view or the blocked-list table; banned IPs are kicked from active sessions on the next API call
