[← Back to README](../README.md)

# Database & Caching

- [Database Schema](#database-schema)
- [Caching (Redis)](#caching-redis)

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
 status      VARCHAR(20)  ["online","idle","dnd","invisible"]
 status_text VARCHAR(128)
 theme_json  TEXT
 preferences_json TEXT             ← cross-device prefs (lang, notifications, mutes)
 failed_attempts INTEGER           ← fail2ban counter, reset on success
 last_failed_at  TIMESTAMP
 locked_until    TIMESTAMP         ← null = not locked
 created_at  TIMESTAMP
 updated_at  TIMESTAMP

 Indexes:
   idx_user_username_trgm       GIN gin_trgm_ops
   idx_user_display_name_trgm   GIN gin_trgm_ops
   idx_user_locked_until        partial WHERE locked_until IS NOT NULL

Group ─────────────────────────────────────────
 id          UUID PK
 name        VARCHAR(100)
 owner_id    UUID FK → User
 image_path  TEXT
 is_active   BOOLEAN
 is_personal BOOLEAN            ← "Saved Messages"
 is_dm       BOOLEAN            ← direct message
 created_at  TIMESTAMP
 updated_at  TIMESTAMP

 Indexes:
   idx_group_is_dm  partial WHERE is_dm=TRUE

Chat ──────────────────────────────────────────
 id          UUID PK
 name        VARCHAR(50)
 group_id    UUID FK → Group
 type        VARCHAR(10)  ["text", "voice"]
 created_at  TIMESTAMP

GroupMember ───────────────────────────────────
 group_id    UUID PK FK → Group
 user_id     UUID PK FK → User
 role        VARCHAR(20)  ["member","editor","owner"]
 joined_at   TIMESTAMP

 Indexes:
   idx_group_member_user (user_id)  ← «my groups» lookups

GroupInvite ───────────────────────────────────
 id, group_id, code (UNIQUE), created_by, expires_at

Message ───────────────────────────────────────
 id           UUID PK
 user_id      UUID FK → User
 chat_id      UUID FK → Chat
 content      TEXT
 content_tsv  TSVECTOR           ← FTS, auto-updated via trigger
 is_edited    BOOLEAN
 is_pinned    BOOLEAN
 embeds_json  TEXT                ← OpenGraph link previews
 reply_to_*   denormalized reply fields
 forwarded_from_* denormalized forward fields
 created_at   TIMESTAMP
 updated_at   TIMESTAMP

 Indexes:
   idx_message_chat_created  (chat_id, created_at)          ← pagination
   idx_message_content_trgm  GIN gin_trgm_ops (partial)     ← ILIKE fallback
   idx_message_content_tsv   GIN (content_tsv)              ← full-text search

MessageAttachment ─────────────────────────────
 id, message_id, file_path

MessageReaction ───────────────────────────────
 id, message_id, user_id, emoji
 UNIQUE(message_id, user_id)     ← one reaction per user

Poll / PollOption / PollVote ──────────────────
 id, message_id, question, options, votes

UserChatState ─────────────────────────────────
 user_id PK, chat_id PK, last_read_at

AppSetting ────────────────────────────────────
 key PK, value                     ← also stores fail2ban settings (auth.*)

LoginAttempt ──────────────────────────────────
 id           UUID PK
 ip           INET                 ← native PG type, validated + compact
 username_attempted VARCHAR(100)   ← what was typed (may be unknown user)
 success      BOOLEAN
 user_agent   VARCHAR(500)
 user_id      UUID FK → User (SET NULL on delete) ← null if email unknown
 created_at   TIMESTAMP

 Indexes:
   idx_login_attempt_ip_created       (ip, created_at)        ← hot path: recent failures per IP
   idx_login_attempt_username_created (username_attempted, created_at)
   idx_login_attempt_created          (created_at)            ← retention sweep

IpBlock ───────────────────────────────────────
 ip            INET PK
 reason        VARCHAR(255)
 expires_at    TIMESTAMP            ← null = permanent ban
 blocked_by    VARCHAR(20)          ["auto", "manual"]
 attempts_count INTEGER
 blocked_at    TIMESTAMP

 Indexes:
   idx_ip_block_expires (expires_at NULLS LAST)

Session ───────────────────────────────────────
 id                 UUID PK
 user_id            UUID FK → User (CASCADE)
 token_id           VARCHAR(32) UNIQUE  ← O(1) refresh-token lookup
 refresh_token_hash VARCHAR(255)        ← HMAC-SHA-256 of secret part
 user_agent         VARCHAR(500)        ← parsed for active-sessions UI
 ip                 INET
 created_at         TIMESTAMP
 last_used_at       TIMESTAMP
 expires_at         TIMESTAMP           ← +30 days from creation
 revoked_at         TIMESTAMP           ← null = active

 Indexes:
   idx_session_user_active (user_id, revoked_at, expires_at)
   idx_session_expires     (expires_at)
   idx_session_token_id    (token_id) UNIQUE

 Background:
   cleanup_old_sessions() drops rows where expires_at OR revoked_at
   < now() - 90 days, runs once a day from app startup task.
```

Note on persisted client state (not in DB):

- **`preferences_json`** stores only cross-device prefs (lang, notification level, sound toggle, muted chats, saved searches). Things like microphone/camera `deviceId`, audio input gain, voice strip layout, per-call user volumes are kept in `localStorage` only — they're per-device and meaningless on another machine.

---

## Caching (Redis)

Redis is used for multiple purposes, reducing PostgreSQL load:

### 1. Message Page Cache

| Key | TTL | Description |
|-----|-----|-------------|
| `cord:msgs:{chat_id}` | 60s | First page (50 messages) of chat history |

Invalidated on any message create/edit/delete in that chat.

### 2. Online Presence

| Key | TTL | Description |
|-----|-----|-------------|
| `cord:online:{user_id}` | 120s | Set by heartbeat every 60s |

### 3. Unread Counts

| Key | TTL | Description |
|-----|-----|-------------|
| `cord:unread:{user_id}` | 5s | Cached result of unread COUNT query |

Invalidated when the user marks a chat as read, OR when another user posts a message in any of the user's chats (eager cross-user invalidation).

### 4. Call Start Time

| Key | TTL | Description |
|-----|-----|-------------|
| `cord:call:{channel_id}` | None | Unix-ms when first participant joined |

Set with `NX` (only if key doesn't exist). Cleared when the last participant leaves.

### 5. Search Results

| Key | TTL | Description |
|-----|-----|-------------|
| `cord:search:{kind}:{user_id}:{sha1(params)}` | 30s | Cached result of user/message search |

Fail-open: any Redis error falls back to direct DB query.

### 6. Rate Limiting

| Key | TTL | Description |
|-----|-----|-------------|
| `cord:rl:{bucket}:{ip}` | window | Fixed-window counter via INCR |

Buckets: `login`, `register`, `refresh`, `logout`, `search`. Honors `X-Forwarded-For` / `X-Real-IP` for use behind nginx.

### 7. Fail2ban Settings & Block Status

| Key | TTL | Description |
|-----|-----|-------------|
| `cord:f2b:settings` | 30s | Cached `app_settings.auth.*` row group; invalidated on `PATCH /admin/auth/settings` |
| `cord:f2b:block:{ip}` | 10s | Per-IP block status — `"1"` blocked / `"0"` clean. Invalidated on block create/delete from admin |

Without these caches `get_current_user` would issue 2 extra SQL queries on every authenticated request (settings + ip_block lookup). At ~10 concurrent fetches on page load that's 20 unnecessary queries; with caching it drops to ~1 (just user lookup). Fail-open: any Redis error falls back to direct DB query.

### 8. WebSocket fan-out

Pub/sub channel `cord:ws:fanout` — used by `ws_manager.py` to deliver events between uvicorn workers. Not a cache per se; if Redis is down WebSocket events fail silently between workers (each worker still delivers to its own local sockets).
