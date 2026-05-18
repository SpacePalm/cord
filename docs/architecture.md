[← Back to README](../README.md)

# Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│   Browser    │────▶│  Frontend (nginx)│────▶│   Backend    │
│  (React SPA) │     │   container :80  │     │ (FastAPI:8000│
└─────────────┘     │   host: :8080    │     └──────┬───────┘
       │             └──────────────────┘            │
       │                       │                     │
       │  WebRTC (LiveKit)     │ proxies             ├──▶ PostgreSQL:5432
       │                       │ /api, /media, /ws   │
       ▼                       │                     ├──▶ Redis:6379
┌──────────────┐               │                     │
│   LiveKit    │◀──────────────┘─────────────────────┘
│  Server:7880 │    (token generation)
└──────────────┘
```

## Request flow

1. Browser loads the React SPA from the **frontend container's nginx** (host `:8080`, container `:80`).
2. Same nginx proxies `/api/*`, `/media/*`, `/ws` to the **backend** container (`backend:8000`) over the Docker network — no external reverse proxy required.
3. Backend authenticates via short-lived JWT (15 min) + opaque refresh token (30 d, server-side session); queries PostgreSQL with full-text search (`tsvector` + GIN); caches hot data in Redis.
4. Voice/video: backend generates a LiveKit JWT → browser connects directly to LiveKit server (`:7880`) via WebSocket/WebRTC.
5. Real-time updates: browser keeps a persistent WebSocket `/ws` connection for message/typing/call events.
6. Online status: browser sends heartbeat every 60s → backend writes to Redis with 120s TTL.
7. For HTTPS in production, put a host-level nginx (or Caddy/Cloudflare) in front of `:8080`. See [Deployment](deployment.md).

---

## Ports

All services expose the following ports. Make sure they are open on your firewall/server.

| Port | Protocol | Service | Required | Description |
|------|----------|---------|----------|-------------|
| **8080** | TCP | Frontend | Yes | Containerized nginx serving the SPA + proxying API/WS/media. Configurable via `FRONTEND_PORT`. With the TLS override the container also listens on 80/443 directly |
| **8000** | TCP | Backend | Internal | FastAPI server. In dev mapped to host for direct API access; in prod compose not exposed (frontend nginx proxies internally) |
| **7880** | TCP | LiveKit | Yes | WebSocket signaling for WebRTC. Must be accessible from browser (`LIVEKIT_PUBLIC_URL`) |
| **7881** | TCP | LiveKit | Yes | RTC media over TCP (fallback when UDP is blocked) |
| **7882** | UDP | LiveKit | Yes | RTC media over UDP (primary, lowest latency). **Must be open for voice/video to work** |
| **5432** | TCP | PostgreSQL | Internal | Database. Only needs to be exposed if you access DB from host (e.g. pgAdmin) |
| **6379** | TCP | Redis | Internal | Cache. Only needs to be exposed for debugging |

> **Internal** = only needs to be reachable between Docker containers (the default Docker network handles this).
>
> **Production with reverse proxy:** expose only 80/443 (HTTPS) and 7880-7882 (LiveKit). The reverse proxy handles TLS termination and routes `/api/*`, `/media/*` to the backend, everything else to the frontend build.

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | React 18, TypeScript, Vite | UI framework and build tool |
| **Styling** | Tailwind CSS 3.4 | Utility-first CSS with CSS variables |
| **State** | Zustand 5 | Global state (auth, session, theme, notifications) |
| **Data Fetching** | TanStack Query 5 | API caching, polling, mutations |
| **Icons** | Lucide React | Icon library |
| **Voice/Video** | LiveKit Client SDK | WebRTC voice, video, screen sharing |
| **Audio** | Web Audio API | Notification beeps and ringtones (no bundled audio files) |
| **Image Crop** | react-image-crop | Avatar cropping |
| **Backend** | FastAPI, Python 3.14 | Async API server |
| **ORM** | SQLAlchemy 2 (async) | Database access |
| **Database** | PostgreSQL 16 | Primary data store with `pg_trgm` + `tsvector` FTS |
| **Cache** | Redis 7 | Message cache, online status, search results, unread counts, rate limits |
| **Auth** | PyJWT, bcrypt | JWT tokens, password hashing |
| **Media Server** | LiveKit Server | WebRTC SFU for voice/video |
| **Infrastructure** | Docker Compose | Container orchestration |

---

## Project Structure

```
cord/
├── backend/
│   ├── app/
│   │   ├── api/                # FastAPI route modules
│   │   │   ├── auth.py         # Login, register, profile, avatar, heartbeat
│   │   │   ├── groups.py       # Groups, chats, members, invites
│   │   │   ├── dms.py          # Direct Messages + call/decline/cancel
│   │   │   ├── messages.py     # Messages, search, media, links, forwards
│   │   │   ├── users.py        # User search with privacy model
│   │   │   ├── voice.py        # LiveKit token generation, participants
│   │   │   ├── notifications.py # Unread counts, mark-as-read
│   │   │   ├── polls.py        # Poll voting
│   │   │   ├── media.py        # Protected file serving (path-traversal safe)
│   │   │   ├── ws.py           # WebSocket endpoint with membership re-checks
│   │   │   ├── admin.py        # Admin panel endpoints
│   │   │   └── admin_fail2ban.py # Security tab: settings, log, IP blocks, locked users
│   │   ├── models/             # SQLAlchemy ORM models
│   │   │   ├── session.py      # Refresh-token sessions (token_id, hash, expiry)
│   │   │   ├── fail2ban.py     # LoginAttempt + IpBlock
│   │   │   └── ...             # user, group, message, poll, app_settings, user_chat_state
│   │   ├── schemas/            # Pydantic request/response schemas
│   │   ├── auth.py             # JWT + refresh tokens (HMAC-SHA-256), session helpers, get_current_user
│   │   ├── fail2ban.py         # Brute-force protection: settings, attempt logging, auto-escalation, Redis cache
│   │   ├── cache.py            # Redis helpers (messages, online, unread, search, calls, fail2ban)
│   │   ├── rate_limit.py       # Redis-based sliding window rate limiter
│   │   ├── config.py           # Pydantic Settings (env vars)
│   │   ├── database.py         # SQLAlchemy engine (pool 20+30, pre_ping) & session factory
│   │   ├── ws_manager.py       # WebSocket connection manager (Redis pub/sub fan-out)
│   │   └── main.py             # FastAPI app, migrations, security warnings, session cleanup task
│   ├── Dockerfile
│   ├── entrypoint.sh           # S3fs mount logic
│   └── pyproject.toml
├── frontend/
│   ├── public/                 # Static assets (logos, theme presets)
│   ├── nginx.conf              # Container nginx config: SPA + proxy /api, /media, /ws
│   ├── src/
│   │   ├── api/                # API clients (auth, groups, messages, dms, search, ...)
│   │   ├── components/
│   │   │   ├── CommandPalette.tsx       # Global Ctrl+K palette
│   │   │   ├── IncomingCallOverlay.tsx  # Incoming DM call UI + ringtone
│   │   │   ├── OutgoingCallWatcher.tsx  # Reacts to call_declined
│   │   │   ├── FloatingCallBar.tsx      # Draggable mini call widget
│   │   │   ├── MessageNotifier.tsx      # OS + toast notifications for new messages
│   │   │   ├── UserActionsPopover.tsx   # Click user → Open chat / Call
│   │   │   ├── chat/                    # ChatInput, MessageList, SearchPanel, MediaPanel
│   │   │   ├── layout/                  # GroupSidebar, ChannelSidebar, DMListPanel, MemberListPanel
│   │   │   ├── settings/                # SettingsModal (Profile, Audio, Video, Notifications, ...)
│   │   │   ├── admin/                   # SecurityTab (fail2ban settings, log, blocks)
│   │   │   ├── ui/                      # Button, Input, ImageCropModal, ToastContainer
│   │   │   └── voice/                   # VoiceRoom (LiveKit integration, focused-mode, strip layout)
│   │   ├── hooks/              # useWebSocket, useUnreadCounts, useProtectedUrl
│   │   ├── i18n/               # Translation files (en.ts, ru.ts) + useLocale hook
│   │   ├── pages/              # LoginPage, RegisterPage, AppPage, AdminPage, InvitePage, BlockedPage
│   │   ├── store/              # Zustand stores (auth, session, theme, notification, lang)
│   │   ├── types/              # TypeScript interfaces
│   │   └── utils/
│   │       ├── renderContent.tsx       # Markdown renderer
│   │       ├── notificationSound.ts    # Web Audio API beep
│   │       ├── ringtone.ts             # Looping ringtone via Web Audio
│   │       └── voiceBackgroundGuard.ts # Wake Lock + Media Session for mobile calls
│   ├── Dockerfile              # Multistage: vite build → nginx serve
│   ├── package.json
│   ├── package-lock.json
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   └── vite.config.ts
├── docs/                       # Documentation (this directory)
├── deploy/                     # Reverse-proxy examples (not used by compose directly)
│   ├── README.md               # Which compose/nginx file when
│   ├── nginx-host.conf         # Pattern A: host nginx in front of container
│   └── nginx-container-tls.conf # Pattern B: alt config for TLS-in-container
├── scripts/
│   └── publish.sh              # Build + push images to GHCR locally (alternative to GH Actions)
├── docker-compose.yaml         # Dev: build from source + hot-reload mounts
├── docker-compose.prod.yaml    # Prod: pull from GHCR, no host nginx required
├── docker-compose.tls.yaml     # Override: container nginx terminates TLS
├── .github/workflows/
│   └── release.yml             # GitHub Actions: build + publish images on tag/branch push
├── .env.example                # Configuration template
└── README.md
```
