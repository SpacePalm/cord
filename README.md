<p align="center">
  <img src="frontend/public/full_logo.png" alt="Cord" height="80" />
</p>

<h1 align="center">Cord</h1>

<p align="center">
  Open-source voice & text chat platform — self-hosted Discord alternative.<br/>
  Built with FastAPI, React, LiveKit, PostgreSQL, and Redis.
</p>

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Ports](#ports)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Administration](#administration)
- [User Guide](#user-guide)
- [API Reference](#api-reference)
- [Database Schema](#database-schema)
- [Caching (Redis)](#caching-redis)
- [Internationalization](#internationalization)
- [Theming](#theming)
- [Security](#security)
- [Project Structure](#project-structure)
- [Adding a Language](#adding-a-language)
- [License](#license)

---

## Features

### Communication
- **Text Chats** — messages with markdown (`**bold**`, `*italic*`, `||spoiler||`), replies, forwards, file attachments, voice messages
- **Polls** — create polls with multiple options, one vote per user, real-time results
- **Voice Chats** — real-time audio via [LiveKit](https://livekit.io) WebRTC, mute/deafen controls
- **Screen Sharing** — configurable resolution (720p–1440p), FPS (5–60), system audio capture; uses LiveKit ScreenSharePresets with proper bitrate encoding for each quality level
- **Call Duration Timer** — shared conference timer displayed in the channel header, synced via Redis across all participants and page reloads
- **Per-user Volume** — mute individual users, adjust volume 0–300%, settings persist across sessions

### Social
- **Groups (Servers)** — create groups with text and voice chats, custom avatars
- **Members** — online status tracking, member list with avatars
- **Invite Links** — 24-hour expiring invite codes with shareable URLs
- **User Profiles** — custom avatars with image cropping, display names

### Notifications
- **Unread Badges** — per-chat and per-group unread message counters
- **Browser Notifications** — desktop push notifications when tab is in background
- **Toast Banners** — in-app notification banners with slide-in animation

### Customization
- **Theme Engine** — 4 built-in presets (Dark, Light, Midnight, Forest) + full color customization (11 colors)
- **Shape Controls** — adjustable border radius (0–20px) and font size (12–18px)
- **Font Customization** — 22 fonts from Google Fonts (sans-serif, monospace, serif), loaded on demand
- **Theme Import/Export** — save and share themes as JSON files
- **Live Preview** — real-time theme preview panel in settings
- **Multi-language** — English and Russian, extensible

### Administration
- **User Management** — search, block/unblock, promote/demote admins, delete users
- **Group Management** — view all groups, member counts, delete groups
- **System Settings** — toggle registration, view disk/DB statistics
- **Cleanup Tools** — delete old messages by age, remove orphaned attachments

---

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│   Browser    │────▶│   Frontend   │────▶│   Backend    │
│  (React)     │     │  (Vite:5173) │     │ (FastAPI:8000│
└─────────────┘     └──────────────┘     └──────┬───────┘
       │                                        │
       │  WebSocket (LiveKit)                   ├──▶ PostgreSQL:5432
       │                                        │
       ▼                                        ├──▶ Redis:6379
┌──────────────┐                                │
│   LiveKit    │◀───────────────────────────────┘
│  Server:7880 │    (token generation)
└──────────────┘
```

**Request flow:**
1. Browser loads React SPA from Vite dev server (port 5173)
2. API calls proxied to FastAPI backend (port 8000) via Vite proxy (`/api/*`, `/media/*`)
3. Backend authenticates via JWT, queries PostgreSQL, caches hot data in Redis
4. Voice/video: backend generates LiveKit JWT → browser connects directly to LiveKit server (port 7880) via WebSocket/WebRTC
5. Online status: browser sends heartbeat every 60s → backend writes to Redis with 120s TTL

---

## Ports

All services expose the following ports. Make sure they are open on your firewall/server.

| Port | Protocol | Service | Required | Description |
|------|----------|---------|----------|-------------|
| **5173** | TCP | Frontend | Yes | Vite dev server (SPA). In production replace with your static server / reverse proxy port (e.g. 80/443) |
| **8000** | TCP | Backend | Internal | FastAPI API server. In dev accessed via Vite proxy; in production proxied through nginx/Caddy |
| **7880** | TCP | LiveKit | Yes | WebSocket signaling for WebRTC. Must be accessible from browser (`LIVEKIT_PUBLIC_URL`) |
| **7881** | TCP | LiveKit | Yes | RTC media over TCP (fallback when UDP is blocked) |
| **7882** | UDP | LiveKit | Yes | RTC media over UDP (primary, lowest latency). **Must be open for voice/video to work** |
| **5432** | TCP | PostgreSQL | Internal | Database. Only needs to be exposed if you access DB from host (e.g. pgAdmin) |
| **6379** | TCP | Redis | Internal | Cache. Only needs to be exposed for debugging |

> **Internal** = only needs to be reachable between Docker containers (the default Docker network handles this). You can remove the `ports` mapping from `docker-compose.yaml` for these services in production.
>
> **Production with reverse proxy:** expose only 80/443 (HTTPS) and 7880-7882 (LiveKit). The reverse proxy handles TLS termination and routes `/api/*`, `/media/*` to the backend, everything else to the frontend build.

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | React 18, TypeScript, Vite | UI framework and build tool |
| **Styling** | Tailwind CSS 3.4 | Utility-first CSS with CSS variables |
| **State** | Zustand 5 | Global state management (auth, session, theme, notifications) |
| **Data Fetching** | TanStack Query 5 | API caching, polling, mutations |
| **Icons** | Lucide React | Icon library |
| **Voice/Video** | LiveKit Client SDK | WebRTC voice, screen sharing |
| **Image Crop** | react-image-crop | Avatar cropping |
| **Backend** | FastAPI, Python 3.14 | Async API server |
| **ORM** | SQLAlchemy 2 (async) | Database access |
| **Database** | PostgreSQL 16 | Primary data store |
| **Cache** | Redis 7 | Message cache, online status, unread counts |
| **Auth** | PyJWT, bcrypt | JWT tokens, password hashing |
| **Media Server** | LiveKit Server | WebRTC SFU for voice/video |
| **Infrastructure** | Docker Compose | Container orchestration |

---

## Quick Start

### Prerequisites
- Docker & Docker Compose
- Git

### Steps

```bash
# 1. Clone the repository
git clone <repo-url> cord && cd cord

# 2. Configure environment
cp .env.example .env
# Edit .env — at minimum set:
#   CORD_JWT_SECRET=<random-string>
#   CORD_ADMIN_PASSWORD=<secure-password>

# 3. Place your logo (optional)
# Copy logo.png to frontend/public/logo.png
# Copy full_logo.png to frontend/public/full_logo.png

# 4. Start all services
docker compose up --build

# 5. Open in browser
# http://localhost:5173
```

Default admin credentials (change in `.env`):
- Email: `admin@example.com`
- Password: `change-me`

---

## Configuration

### Environment Variables

All backend settings use the `CORD_` prefix and are defined in `backend/app/config.py`.

#### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_DB` | `cord` | Database name |
| `POSTGRES_USER` | `cord` | Database user |
| `POSTGRES_PASSWORD` | `cord` | Database password |

#### Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `CORD_JWT_SECRET` | `change-me-in-dev` | **Must change in production.** Secret key for signing JWT tokens |
| `CORD_JWT_EXPIRE_MINUTES` | `1440` | Token lifetime (default 24 hours) |

#### Admin Account

Auto-created on first startup if not exists.

| Variable | Default | Description |
|----------|---------|-------------|
| `CORD_ADMIN_USERNAME` | `admin` | Admin username |
| `CORD_ADMIN_EMAIL` | `admin@admin.com` | Admin email (used for login) |
| `CORD_ADMIN_PASSWORD` | `admin123` | Admin password |

#### LiveKit (Voice/Video)

| Variable | Default | Description |
|----------|---------|-------------|
| `LIVEKIT_API_KEY` | `devkey` | LiveKit API key |
| `LIVEKIT_API_SECRET` | `secret` | LiveKit API secret |
| `LIVEKIT_PUBLIC_URL` | `ws://localhost:7880` | WebSocket URL accessible from browser |

#### S3 Storage (Optional)

When enabled, s3fs mounts an S3 bucket as `/app/media` inside the backend container.

| Variable | Default | Description |
|----------|---------|-------------|
| `CORD_S3_ENABLED` | `false` | Enable S3 mounting |
| `CORD_S3_BUCKET` | `cord-media` | Bucket name |
| `CORD_S3_ACCESS_KEY` | — | S3 access key |
| `CORD_S3_SECRET_KEY` | — | S3 secret key |
| `CORD_S3_REGION` | `us-east-1` | S3 region |
| `CORD_S3_ENDPOINT_URL` | — | Custom endpoint (for MinIO, Yandex Cloud, etc.) |

---

## Deployment

### Docker Compose Services

| Service | Image | Port | Health Check |
|---------|-------|------|-------------|
| `livekit` | livekit/livekit-server | 7880, 7881, 7882/udp | — |
| `redis` | redis:7-alpine | 6379 | `redis-cli ping` |
| `db` | postgres:16-alpine | 5432 | `pg_isready` |
| `backend` | Custom (Python 3.14) | 8000 | — |
| `frontend` | Custom (Node 20) | 5173 | — |

### Volumes

| Volume | Purpose |
|--------|---------|
| `pgdata` | PostgreSQL data persistence |
| `./media` | Local file storage (avatars, attachments, voice messages) |
| `./backend/app` | Backend hot-reload (dev) |
| `./frontend` | Frontend hot-reload (dev) |

### Production Considerations

1. **Change default secrets** — `CORD_JWT_SECRET`, `CORD_ADMIN_PASSWORD`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
2. **Remove `--reload`** from backend Dockerfile CMD for production
3. **Build frontend** for production: replace `npm run dev` with `npm run build` + static server
4. **Use HTTPS** — put a reverse proxy (nginx/Caddy) in front
5. **LiveKit `--node-ip`** — set to your server's public IP instead of `127.0.0.1`
6. **Backup** — schedule PostgreSQL dumps and media directory backups

---

## Administration

### Accessing Admin Panel

1. Log in with an admin account
2. Click the shield icon in the bottom-left sidebar
3. Or navigate directly to `/admin`

### Users Tab

- **Search** users by name or email
- **Promote/Demote** — toggle admin role
- **Block/Unblock** — disable user login without deleting
- **Delete** — permanently remove user and their data

### Servers Tab

- View all groups with owner, member count, and channel count
- **Expand** to see member list
- **Kick** members from any group
- **Delete** groups (removes all channels and messages)

### System Tab

- **Registration Toggle** — enable/disable new user registration
- **Statistics** — user count, group count, message count, attachment count, disk usage breakdown
- **Cleanup: Old Messages** — delete messages older than N days
- **Cleanup: Orphaned Attachments** — remove files on disk without matching database records

---

## User Guide

### Getting Started

1. Register at the login page (if registration is enabled) or use an invite link
2. Create a group or join an existing one via invite
3. Start chatting in text chats or join a voice chat

### Text Chats

- **Send messages** — type and press Enter (Shift+Enter for new line)
- **Format text** — `**bold**`, `*italic*`, `||spoiler||`, or use toolbar buttons
- **Reply** — hover over a message and click reply
- **Forward** — forward messages to other chats
- **Attachments** — drag & drop or click the paperclip icon
- **Voice messages** — click the microphone icon to record
- **Polls** — click the chart icon to create a poll
- **Search** — click the magnifying glass to search messages in the current chat

### Voice Chats

- **Join** — click a voice chat or the join button
- **Mute/Unmute** — microphone button in controls
- **Deafen** — headphones button, mutes all incoming audio
- **Per-user volume** — click "..." on a participant's tile to adjust their volume (0–300%) or mute them
- **Screen share** — monitor button, configure quality/FPS/audio before sharing
- **Call timer** — conference duration displayed next to the channel name in the header
- **Connection stats** — signal button shows ping, bitrate, packet loss, codec

### Notifications

- **Unread badges** — red counters on chats and groups in the sidebar
- **Browser notifications** — enable in Settings → Notifications (requires browser permission)
- **Toast banners** — appear in the top-right corner for new messages

### Settings

- **Profile** — change avatar (with cropping), display name, email
- **Security** — change password
- **Audio** — select input/output devices, adjust mic sensitivity, test speakers
- **Notifications** — toggle browser notifications
- **Appearance** — choose theme preset or customize colors, border radius, font size, font family; export/import themes
- **Language** — switch between English and Russian

---

## API Reference

### Health Check

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Health check, returns `{"status": "ok"}` |

### Authentication (`/api/auth`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Register new user (disabled if registration is off) |
| `POST` | `/api/auth/login` | Login with email + password, returns JWT |
| `GET` | `/api/auth/me` | Get current user profile |
| `PATCH` | `/api/auth/profile` | Update display name, email, or password |
| `POST` | `/api/auth/avatar` | Upload avatar image (JPEG/PNG, cropped on frontend) |
| `POST` | `/api/auth/heartbeat` | Update online status in Redis (called every 60s) |

### Groups & Channels (`/api/groups`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/groups` | List all groups the current user is a member of |
| `POST` | `/api/groups` | Create group (auto-creates `general` text + `Голосовой` voice channels) |
| `DELETE` | `/api/groups/{id}` | Delete group (owner or admin only) |
| `PATCH` | `/api/groups/{id}` | Update group name |
| `POST` | `/api/groups/{id}/avatar` | Upload group avatar |
| `POST` | `/api/groups/{id}/join` | Join group by ID |
| `POST` | `/api/groups/{id}/leave` | Leave group |
| `GET` | `/api/groups/{id}/members` | List members with online status (batch Redis lookup) |
| `DELETE` | `/api/groups/{id}/members/{uid}` | Kick member (owner/admin only) |
| `PATCH` | `/api/groups/{id}/members/{uid}/role` | Update member role: `member`, `editor`, `owner` |
| `POST` | `/api/groups/{id}/invite` | Create 24-hour invite link (returns code) |
| `GET` | `/api/groups/{id}/chats` | List all channels in group |
| `POST` | `/api/groups/{id}/chats` | Create channel (`type`: `text` or `voice`, editor+ only) |
| `PATCH` | `/api/groups/{id}/chats/{cid}` | Rename channel (editor+ only) |
| `DELETE` | `/api/groups/{id}/chats/{cid}` | Delete channel (editor+ only) |

### Invites (`/api/invite`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/invite/{code}` | Get invite info — group name, member count (public, no auth) |
| `POST` | `/api/invite/{code}/join` | Join group via invite code |

### Messages (`/api/chats`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/chats/{id}/messages` | Get messages (cursor-based pagination, 50/page). First page cached in Redis 60s |
| `POST` | `/api/chats/{id}/messages` | Send message — supports `content` (text), `files` (attachments), `reply_to_id`, `poll_question` + `poll_options` |
| `POST` | `/api/chats/{id}/messages/forward` | Forward message to another chat (copies content + author info) |
| `PATCH` | `/api/chats/{id}/messages/{mid}` | Edit message text (author only, sets `is_edited` flag) |
| `DELETE` | `/api/chats/{id}/messages/{mid}` | Delete message (author, group owner, or admin) |
| `GET` | `/api/chats/{id}/messages/search?q=` | Full-text search in chat (min 2 chars, limit 20) |
| `GET` | `/api/chats/{id}/media` | List messages with attachments (cursor-based, 50/page) |
| `GET` | `/api/chats/{id}/links` | List messages containing URLs (cursor-based, 50/page) |

### Notifications (`/api/chats`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/chats/unread` | Get unread counts per chat, grouped by group (cached 5s in Redis) |
| `POST` | `/api/chats/{id}/read` | Mark chat as read (sets `last_read_at` to now, invalidates unread cache) |

### Voice (`/api/voice`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/voice/token?channel_id=` | Get LiveKit JWT + server URL + `call_started_at` (ms). Initializes call timer in Redis on first join |
| `GET` | `/api/voice/participants?channel_id=` | List active participants (identity, name, avatar) via LiveKit API |
| `POST` | `/api/voice/leave?channel_id=` | Notify leave. Checks remaining participants via LiveKit; clears Redis call timer if room is empty |

### Polls (`/api/polls`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/polls/{id}/vote` | Vote on poll option (one vote per user per poll, replaces previous) |
| `DELETE` | `/api/polls/{id}/vote` | Remove vote from poll |

### Media (`/api/media`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/media/messages/{mid}/{filename}` | Serve attachment file (auth + group membership required). Supports range requests for audio/video |

### Admin (`/api/admin`)

All admin endpoints require `role == "admin"`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/settings` | Get app settings (registration_enabled, etc.) |
| `PATCH` | `/api/admin/settings` | Update app settings |
| `GET` | `/api/admin/users?q=` | List/search all users (username, email, role, status) |
| `PATCH` | `/api/admin/users/{id}` | Update user role (`user`/`admin`) or status (`is_active`) |
| `DELETE` | `/api/admin/users/{id}` | Permanently delete user and their data |
| `GET` | `/api/admin/groups` | List all groups with owner, member count, channel count |
| `DELETE` | `/api/admin/groups/{id}` | Delete group with all channels and messages |
| `GET` | `/api/admin/groups/{id}/members` | List group members |
| `DELETE` | `/api/admin/groups/{id}/members/{uid}` | Kick member from group |
| `GET` | `/api/admin/stats` | System stats: user/group/message counts, disk usage, attachment count |
| `POST` | `/api/admin/cleanup/messages` | Delete messages older than N days (body: `days`, default 30) |
| `POST` | `/api/admin/cleanup/attachments` | Find and delete orphaned files (no matching DB record) |

---

## Database Schema

```
User ──────────────────────────────────────────
 id          UUID PK
 username    VARCHAR(50) UNIQUE
 display_name VARCHAR(50)
 email       VARCHAR(100) UNIQUE
 hashed_password TEXT
 role        VARCHAR(20)  ["user", "admin"]
 image_path  TEXT
 is_active   BOOLEAN
 created_at  TIMESTAMP
 updated_at  TIMESTAMP

Group ─────────────────────────────────────────
 id          UUID PK
 name        VARCHAR(100)
 owner_id    UUID FK → User
 image_path  TEXT
 is_active   BOOLEAN
 created_at  TIMESTAMP
 updated_at  TIMESTAMP

Chat ──────────────────────────────────────────
 id          UUID PK
 name        VARCHAR(50)
 group_id    UUID FK → Group
 type        VARCHAR(10)  ["text", "voice"]
 created_at  TIMESTAMP

GroupMember ───────────────────────────────────
 group_id    UUID PK FK → Group
 user_id     UUID PK FK → User
 joined_at   TIMESTAMP

GroupInvite ───────────────────────────────────
 id          UUID PK
 group_id    UUID FK → Group
 code        VARCHAR(16) UNIQUE
 created_by  UUID FK → User
 expires_at  TIMESTAMP

Message ───────────────────────────────────────
 id          UUID PK
 user_id     UUID FK → User
 chat_id     UUID FK → Chat
 content     TEXT (nullable)
 is_edited   BOOLEAN
 reply_to_id, reply_to_author, reply_to_content
 forwarded_from_id, forwarded_from_author,
   forwarded_from_content, forwarded_from_chat
 created_at  TIMESTAMP
 updated_at  TIMESTAMP

MessageAttachment ─────────────────────────────
 id          UUID PK
 message_id  UUID FK → Message
 file_path   TEXT

Poll ──────────────────────────────────────────
 id          UUID PK
 message_id  UUID FK → Message (UNIQUE)
 question    VARCHAR(500)

PollOption ────────────────────────────────────
 id          UUID PK
 poll_id     UUID FK → Poll
 text        VARCHAR(500)
 position    INTEGER

PollVote ──────────────────────────────────────
 id          UUID PK
 poll_id     UUID FK → Poll
 option_id   UUID FK → PollOption
 user_id     UUID FK → User
 UNIQUE(poll_id, user_id)

UserChatState ─────────────────────────────────
 user_id     UUID PK FK → User
 chat_id     UUID PK FK → Chat
 last_read_at TIMESTAMP

AppSetting ────────────────────────────────────
 key         VARCHAR(255) PK
 value       TEXT
```

---

## Caching (Redis)

Redis is used for four purposes, reducing PostgreSQL load:

### 1. Message Page Cache

| Key | TTL | Description |
|-----|-----|-------------|
| `cord:msgs:{chat_id}` | 60s | First page (50 messages) of chat history |

Invalidated on any message create/edit/delete in that chat.

### 2. Online Presence

| Key | TTL | Description |
|-----|-----|-------------|
| `cord:online:{user_id}` | 120s | Set by heartbeat every 60s |

Checked via `PIPELINE EXISTS` for batch online status lookups.

### 3. Unread Counts

| Key | TTL | Description |
|-----|-----|-------------|
| `cord:unread:{user_id}` | 5s | Cached result of unread COUNT query |

Invalidated when user marks a chat as read.

### 4. Call Start Time

| Key | TTL | Description |
|-----|-----|-------------|
| `cord:call:{channel_id}` | None | Unix-ms timestamp when the first participant joined the voice channel |

Set with `NX` (only if key doesn't exist) when a user requests a voice token. Cleared when the last participant leaves via `/api/voice/leave`. This allows the conference duration timer to persist across page reloads and stay synchronized for all participants.

All Redis operations have try/catch — if Redis is unavailable, the app falls back to direct database queries.

---

## Internationalization

### Supported Languages

| Code | Language |
|------|----------|
| `en` | English (default) |
| `ru` | Russian |

Language preference is stored in `localStorage` (`cord-lang`) and can be changed in Settings → Language.

### Adding a Language

1. Create `frontend/src/i18n/xx.ts` copying the structure from `en.ts`
2. Translate all ~250 keys
3. Register in `frontend/src/i18n/index.ts`:
   ```typescript
   import { xx } from './xx';
   export const LANGUAGES = {
     ...
     xx: { label: 'Language Name', translations: xx },
   };
   ```

---

## Theming

### Built-in Presets

| Preset | Background | Accent | Style |
|--------|-----------|--------|-------|
| **Dark** | Near-black (#111113) | Green (#16a34a) | Default |
| **Light** | Warm gray (#f4f7f2) | Dark green (#15803d) | Day mode |
| **Midnight** | Deep blue (#1a1a3e) | Purple (#7c5cfc) | Night mode |
| **Forest** | Dark green (#2a3828) | Forest green (#4caf50) | Nature |

### Customizable Properties

**Colors (11):** Primary/secondary/tertiary backgrounds, input background, primary/secondary/muted text, accent, accent hover, accent text, borders, danger

**Shape:** Border radius (0–20px), font size (12–18px), font family (22 options)

**Fonts:** System, Inter, Roboto, Open Sans, Nunito, Ubuntu, Poppins, Montserrat, Lato, Raleway, Manrope, Rubik, Noto Sans, Plus Jakarta Sans, Geist, JetBrains Mono, Fira Code, Source Code Pro, IBM Plex Mono, Merriweather, Playfair Display, Lora. Loaded on demand from Google Fonts.

### Export/Import

- **Export:** Downloads a `.json` file with all theme settings
- **Import:** Load a `.json` theme file — validated before applying

Themes persist in `localStorage` (`cord-theme`).

---

## Security

### Authentication

- JWT tokens with configurable expiration (default 24h)
- Passwords hashed with bcrypt
- Automatic logout on 401 response

### Authorization

- Group membership checked before accessing chats, messages, voice
- LiveKit tokens scoped to specific rooms with user identity
- File downloads require authentication + group membership
- Admin endpoints require `role == "admin"`

### Production Checklist

- [ ] Change `CORD_JWT_SECRET` to a random string
- [ ] Change `CORD_ADMIN_PASSWORD`
- [ ] Change `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` to random values
- [ ] Set up HTTPS via reverse proxy
- [ ] Set `LIVEKIT_PUBLIC_URL` to `wss://your-domain:7880`
- [ ] Remove `--reload` from backend Dockerfile
- [ ] Consider `--dev` removal from LiveKit for production config

---

## Project Structure

```
cord/
├── backend/
│   ├── app/
│   │   ├── api/                # FastAPI route modules
│   │   │   ├── auth.py         # Login, register, profile, avatar, heartbeat
│   │   │   ├── groups.py       # Groups, chats, members, invites
│   │   │   ├── messages.py     # Messages, search, media, links, forwards
│   │   │   ├── voice.py        # LiveKit token generation, participant list
│   │   │   ├── notifications.py # Unread counts, mark-as-read
│   │   │   ├── polls.py        # Poll voting
│   │   │   ├── media.py        # Protected file serving
│   │   │   └── admin.py        # Admin panel endpoints
│   │   ├── models/             # SQLAlchemy ORM models
│   │   ├── schemas/            # Pydantic request/response schemas
│   │   ├── auth.py             # JWT helpers, password hashing
│   │   ├── cache.py            # Redis cache helpers
│   │   ├── config.py           # Pydantic Settings (env vars)
│   │   ├── database.py         # SQLAlchemy engine & session
│   │   └── main.py             # FastAPI app, CORS, startup hooks
│   ├── Dockerfile
│   ├── entrypoint.sh           # S3fs mount logic
│   └── pyproject.toml
├── frontend/
│   ├── public/                 # Static assets (logos, sounds)
│   ├── src/
│   │   ├── api/                # API client functions
│   │   ├── components/
│   │   │   ├── chat/           # ChatInput, MessageList, SearchPanel, MediaPanel, ForwardModal
│   │   │   ├── layout/         # GroupSidebar, ChannelSidebar, VoicePresencePanel, MemberListPanel
│   │   │   ├── settings/       # SettingsModal, GroupSettingsModal
│   │   │   ├── ui/             # Button, Input, ImageCropModal, ToastContainer
│   │   │   └── voice/          # VoiceRoom (LiveKit integration)
│   │   ├── hooks/              # useUnreadCounts, useProtectedUrl
│   │   ├── i18n/               # Translation files (en.ts, ru.ts)
│   │   ├── pages/              # LoginPage, RegisterPage, AppPage, AdminPage, InvitePage
│   │   ├── store/              # Zustand stores (auth, session, theme, notification, lang)
│   │   ├── types/              # TypeScript interfaces
│   │   └── utils/              # renderContent (markdown)
│   ├── Dockerfile
│   ├── package.json
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   └── vite.config.ts          # Vite config with API proxy
├── docker-compose.yaml         # All 5 services
├── .env.example                # Configuration template
└── README.md
```

---

## License

MIT
