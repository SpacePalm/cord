[← Back to README](../README.md)

# API Reference

All routes are prefixed by their feature group. Authentication is via `Authorization: Bearer <jwt>` header unless explicitly noted as public.

- [Health Check](#health-check)
- [Authentication](#authentication-apiauth)
- [Groups & Channels](#groups--channels-apigroups)
- [Direct Messages](#direct-messages-apidms)
- [Users](#users-apiusers)
- [Search](#search-apisearch)
- [Invites](#invites-apiinvite)
- [Messages](#messages-apichats)
- [Notifications](#notifications-apichats)
- [Voice](#voice-apivoice)
- [Polls](#polls-apipolls)
- [Media](#media-apimedia)
- [WebSocket](#websocket-ws)
- [Admin](#admin-apiadmin)
- [Security / Fail2ban](#security--fail2ban-apiadminauth)

---

## Health Check

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Health check, returns `{"status": "ok"}` |

---

## Authentication (`/api/auth`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Register new user. **Rate-limited** 5/hour/IP |
| `POST` | `/api/auth/login` | Login with email + password. Returns `{access_token, refresh_token, expires_in, user}`. **Rate-limited** 10/5min/IP |
| `POST` | `/api/auth/refresh` | Exchange refresh token for a new pair. Rotation: old refresh is revoked, new one issued. **Rate-limited** 20/min/IP |
| `POST` | `/api/auth/logout` | Revoke a single session by refresh token. Doesn't require an access token (works even with expired access). **Rate-limited** 10/min/IP |
| `GET` | `/api/auth/sessions` | List active sessions of the current user (with `is_current` flag) |
| `PATCH` | `/api/auth/sessions/{id}` | Rename a session (sets the user-friendly device name shown in the active-sessions UI) |
| `DELETE` | `/api/auth/sessions/{id}` | Revoke a specific session ("log out from this device") |
| `DELETE` | `/api/auth/sessions` | Revoke all sessions of the current user **except** the current one |
| `GET` | `/api/auth/me` | Get current user profile |
| `PATCH` | `/api/auth/profile` | Update display name, email, or password |
| `PUT` | `/api/auth/status` | Update `status` (`online`/`idle`/`dnd`/`invisible`) and `status_text` |
| `PUT` | `/api/auth/theme` | Persist current theme JSON to the user record (cross-device sync) |
| `PUT` | `/api/auth/preferences` | Persist cross-device preferences (language, notification level/sound, muted chats, saved searches) |
| `POST` | `/api/auth/avatar` | Upload avatar image (JPEG/PNG, cropped on frontend) |
| `POST` | `/api/auth/heartbeat` | Update online status in Redis (called every 60s) |

---

## Groups & Channels (`/api/groups`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/groups` | List all groups the caller is a member of (including DM and personal — frontend filters by `is_dm`/`is_personal`) |
| `POST` | `/api/groups` | Create group |
| `DELETE` | `/api/groups/{id}` | Delete group (owner or admin only). 400 for DM/personal |
| `PATCH` | `/api/groups/{id}` | Update group name. 400 for DM/personal |
| `POST` | `/api/groups/{id}/avatar` | Upload group avatar |
| `POST` | `/api/groups/{id}/join` | Join group by ID |
| `POST` | `/api/groups/{id}/leave` | Leave group. 400 for DM/personal |
| `GET` | `/api/groups/{id}/members` | List members with online status (batch Redis lookup) |
| `DELETE` | `/api/groups/{id}/members/{uid}` | Kick member (owner/admin only). 400 for DM |
| `PATCH` | `/api/groups/{id}/members/{uid}/role` | Update member role. 400 for DM |
| `POST` | `/api/groups/{id}/invite` | Create 24-hour invite link. 400 for DM/personal |
| `GET` | `/api/groups/{id}/chats` | List all channels in group |
| `POST` | `/api/groups/{id}/chats` | Create channel (editor+ only). 400 for DM |
| `PATCH` | `/api/groups/{id}/chats/{cid}` | Rename channel. 400 for DM |
| `DELETE` | `/api/groups/{id}/chats/{cid}` | Delete channel. 400 for DM, also 400 for last chat in personal group |

---

## Direct Messages (`/api/dms`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/dms` | List all DMs with peer info (online status via Redis), last message preview, unread count |
| `POST` | `/api/dms/with/{user_id}` | Open or create a DM with the target user (idempotent). Returns `{group_id, chat_id, peer, is_new}` |
| `POST` | `/api/dms/{group_id}/call` | Initiate a voice call. Creates voice chat lazily, sends WS `incoming_call` to peer. Returns `{voice_chat_id, peer}` |
| `POST` | `/api/dms/{group_id}/call/decline` | Decline an incoming call. Sends WS `call_declined` to the caller |
| `POST` | `/api/dms/{group_id}/call/cancel` | Cancel an outgoing call before pickup. Sends WS `call_cancelled` to the callee |

---

## Users (`/api/users`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/users/search?q=&limit=` | Search users with privacy model (contacts by substring, strangers by exact username). **Rate-limited** 60/min/IP |

---

## Search (`/api/search`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/search/messages?q=&limit=` | Global full-text search using `tsvector` + `ts_rank`. Ranked by relevance. **Rate-limited** 60/min/IP, cached 30s |
| `GET` | `/api/search/scope` | Returns the set of chats / groups the caller can search in — used by the advanced-search filter UI |

---

## Invites (`/api/invite`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/invite/{code}` | Get invite info — group name, member count (public, no auth) |
| `POST` | `/api/invite/{code}/join` | Join group via invite code |

---

## Messages (`/api/chats`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/chats/{id}/state` | Per-user chat state for the current user — currently `{ last_read_at }`. Used to position the "new messages" divider |
| `GET` | `/api/chats/{id}/messages` | Get messages (cursor-based pagination, 50/page). First page cached in Redis 60s |
| `POST` | `/api/chats/{id}/messages` | Send message — supports `content` (text), `files`, `reply_to_id`, polls |
| `POST` | `/api/chats/{id}/messages/forward` | Forward message to another chat |
| `POST` | `/api/chats/{id}/messages/forward/bulk` | Forward multiple messages |
| `POST` | `/api/chats/{id}/messages/delete/bulk` | Delete multiple messages |
| `PATCH` | `/api/chats/{id}/messages/{mid}` | Edit message (author only) |
| `DELETE` | `/api/chats/{id}/messages/{mid}` | Delete message (author, owner, or admin) |
| `POST` | `/api/chats/{id}/messages/{mid}/pin` | Pin message |
| `DELETE` | `/api/chats/{id}/messages/{mid}/pin` | Unpin message |
| `GET` | `/api/chats/{id}/pinned` | List pinned messages |
| `PUT` | `/api/chats/{id}/messages/{mid}/reactions` | Toggle reaction. Body: `{emoji}`. One reaction per user per message — same emoji removes, different emoji replaces |
| `GET` | `/api/chats/{id}/messages/search?q=&before=` | Per-chat search (trigram + attachment file_path). **Rate-limited** 60/min/IP, cached 30s |
| `GET` | `/api/chats/{id}/media` | List messages with attachments |
| `GET` | `/api/chats/{id}/links` | List messages containing URLs |

The frontend uses `setQueryData` on `onSuccess` of edit / delete / react / pin (rather than `invalidateQueries`) — the server already returns the updated message in the response, so no extra GET is issued. WebSocket `message_edited` / `message_deleted` events also use `setQueryData` for other clients.

---

## Notifications (`/api/chats`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/chats/unread` | Get unread counts per chat (cached 5s) |
| `POST` | `/api/chats/{id}/read` | Mark chat as read, invalidates unread cache |

---

## Voice (`/api/voice`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/voice/token?channel_id=` | Get LiveKit JWT + server URL + `call_started_at` |
| `GET` | `/api/voice/participants?channel_id=` | List active participants via LiveKit API |
| `POST` | `/api/voice/leave?channel_id=` | Notify leave, clear Redis call timer when empty |

See the [Voice & Video guide](voice.md) for client-side flow.

---

## Polls (`/api/polls`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/polls/{id}/vote` | Vote on poll option |
| `DELETE` | `/api/polls/{id}/vote` | Remove vote |

---

## Media (`/api/media`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/media/messages/{mid}/{filename}` | Serve attachment. Path-traversal protected (filename resolved relative to message directory, reject if escapes) |

---

## WebSocket (`/ws`)

Authenticated via `Sec-WebSocket-Protocol: auth.<jwt>`. After connect, user is auto-subscribed to all accessible chats.

**Client → Server actions:**

- `{action: "subscribe", chat_id}` / `{action: "unsubscribe", chat_id}`
- `{action: "typing", chat_id}` / `{action: "stop_typing", chat_id}` — re-verifies membership on every event

**Server → Client events:**

- `message_created` / `message_edited` / `message_deleted`
- `typing` / `stop_typing`
- `voice_participants` — LiveKit participant list
- `incoming_call` (peer → callee on DM call start)
- `call_declined` (callee → caller when declining)
- `call_cancelled` (caller → callee when hanging up before pickup)

Fan-out across uvicorn workers happens through Redis pub/sub on channel `cord:ws:fanout` — `ws_manager.py` publishes envelopes; each worker has a listener that dispatches to its local sockets.

---

## Admin (`/api/admin`)

All admin endpoints require `role == "admin"`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/settings` | Get app settings |
| `PATCH` | `/api/admin/settings` | Update app settings |
| `GET` | `/api/admin/users?q=` | List/search all users |
| `PATCH` | `/api/admin/users/{id}` | Update user role or status |
| `DELETE` | `/api/admin/users/{id}` | Permanently delete user |
| `GET` | `/api/admin/groups` | List all **non-system** groups (DM/personal hidden) |
| `DELETE` | `/api/admin/groups/{id}` | Delete group. 400 for DM/personal |
| `GET` | `/api/admin/groups/{id}/members` | List group members |
| `DELETE` | `/api/admin/groups/{id}/members/{uid}` | Kick member |
| `GET` | `/api/admin/stats` | System stats: counts + disk usage |
| `POST` | `/api/admin/cleanup/messages` | Body: `{days, include_personal, include_dm}`. Delete messages older than N days with independent toggles for personal (Saved) and DM conversations |
| `POST` | `/api/admin/cleanup/attachments` | Find and delete orphaned files |

---

## Security / Fail2ban (`/api/admin/auth`)

All endpoints require `role == "admin"`. Settings live in the `app_settings` table under the `auth.*` keys.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/auth/settings` | Get current fail2ban settings (enabled, thresholds, durations, retention) |
| `PATCH` | `/api/admin/auth/settings` | Update any subset of settings; missing keys keep their value |
| `GET` | `/api/admin/auth/log?ip=&username=&success=&after=&before=&limit=&offset=` | Flat list of login attempts; filterable, ordered by time desc |
| `GET` | `/api/admin/auth/log/grouped?after=&limit=` | Login attempts aggregated by IP with totals, distinct usernames, last_at, current block status, top usernames per IP |
| `POST` | `/api/admin/auth/log/cleanup` | Purge attempts older than `auth.log_retention_days`; returns count |
| `GET` | `/api/admin/auth/blocks?only_active=` | List IP blocks (active by default) |
| `POST` | `/api/admin/auth/blocks` | Manually block an IP. Body: `{ip, reason, duration_seconds?}` (`null` = permanent). IP is validated server-side |
| `DELETE` | `/api/admin/auth/blocks/{ip}` | Remove an IP block (auto or manual) |
| `GET` | `/api/admin/auth/locked-users` | List accounts currently locked by `locked_until > now()` |
| `DELETE` | `/api/admin/auth/locked-users/{user_id}` | Unlock an account (clears `failed_attempts` and `locked_until`) |
