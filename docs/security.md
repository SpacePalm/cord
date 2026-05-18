[← Back to README](../README.md)

# Security

- [Authentication](#authentication)
- [Brute-force Protection (fail2ban)](#brute-force-protection-fail2ban)
- [Authorization](#authorization)
- [Input Validation](#input-validation)
- [Direct Message Protection](#direct-message-protection)
- [Production Checklist](#production-checklist)

---

## Authentication

- **Two-token model** (RFC 6749 / 6819 conventions):
  - **Access token** — JWT signed with `jwt_secret`, 15 min TTL by default. Carried in the `Authorization: Bearer <jwt>` header on every API request. Stateless: server only validates signature + `exp`
  - **Refresh token** — opaque random `{token_id}.{secret}` (32 hex + 48 url-safe chars, ~414 bits combined entropy). Persisted server-side in the `session` table (HMAC-SHA-256 of the secret part, indexed by token_id for O(1) lookup). 30-day TTL, automatically rotated on every `/refresh` call
- **Steal detection** — if a revoked refresh token is presented again (after a 10-second grace period for legitimate races), all of the user's sessions are revoked and they're forced to re-login
- **Active sessions UI** — Settings → Security shows every device the user is logged in on (parsed user-agent, IP, last activity); individual revoke + "log out everywhere else"
- **Hashing** — passwords use bcrypt (slow, designed against weak password brute-force); refresh tokens use HMAC-SHA-256 (fast, suitable for high-entropy random secrets)
- **Auto-cleanup** — expired/revoked sessions older than 90 days are dropped daily by a background task
- Automatic logout on 401 with no valid refresh token; transparent refresh-and-retry otherwise
- `is_active` is checked on every authenticated request — deactivating a user via admin panel immediately invalidates their tokens (no waiting for expiry)
- IP-block check (fail2ban) on every authenticated request → banned IPs are kicked from active sessions on the next API call (max ~15 min for the access TTL window)
- Startup banner warns if `CORD_JWT_SECRET` or `CORD_ADMIN_PASSWORD` are defaults

---

## Brute-force Protection (fail2ban)

- Every login attempt is logged to `login_attempt` (success + fail) with IP, attempted username, user-agent, and FK to user if known
- Two independent thresholds, both configurable from the admin Security tab:
  - **Per-IP**: N failed attempts inside `window_seconds` → IP added to `ip_block` for `ip_block_seconds`
  - **Per-account**: M failed attempts → `User.locked_until` is set for `account_lock_seconds`
- Already-banned IP is rejected at the very start of `/api/auth/login` with `403 {"code": "blocked_by_security", "kind": "ip", "expires_at": "..."}` — no DB lookup of the user, no password check
- Same `blocked_by_security` enforcement runs inside `get_current_user`, so an IP that gets banned mid-session is **kicked from active sessions** on the next API request — frontend redirects to `/blocked` with a live countdown
- Manual blocks (`blocked_by='manual'`) and auto-blocks (`blocked_by='auto'`) coexist in the same table; manual entries can be permanent (`expires_at=null`)
- Master toggle (`auth.enabled`) disables both the auto-escalation and the runtime block enforcement without dropping existing rows
- Login rate-limiter (10/5min/IP) sits in front and absorbs the bulk of brute-force traffic before fail2ban gets involved — the two layers are complementary

Admin UI for all of the above lives in [Admin Panel → Security Tab](administration.md#security-tab).

---

## Authorization

- Group membership checked before accessing chats, messages, voice
- LiveKit tokens scoped to specific rooms with user identity
- File downloads require authentication + group membership
- Admin endpoints require `role == "admin"`
- WebSocket re-verifies group membership on every `typing`/`stop_typing` event (prevents post-kick event leakage)

---

## Input Validation

- **Path traversal** — attachment filenames are resolved and verified to be inside the message directory; uploads sanitize filenames (only `basename`, no `/\..%`)
- **MIME allowlist** — uploads accept only image/audio/video + specific document types; SVG explicitly blocked (prevents JavaScript-based XSS via `<svg><script>`)
- **Poll limits** — max 10 options per poll, 200 chars per option
- **Rate limits** — login, register, and search endpoints are rate-limited via Redis

---

## Direct Message Protection

DMs are isolated from admin tools to protect user privacy:

- Cannot be deleted, renamed, left, or modified (all `/groups/{id}/*` mutations return 400 for `is_dm=true`)
- Cannot create invites (would let third parties into private conversation)
- Cannot kick members (would let one party exclude the other from their own history)
- User search applies Telegram-style privacy: strangers are only discoverable by exact username

---

## Production Checklist

- [ ] Change `CORD_JWT_SECRET` to a random string (min 32 bytes — `openssl rand -hex 32`)
- [ ] Change `CORD_ADMIN_PASSWORD`
- [ ] Change `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` to random values
- [ ] Set `SERVER_IP` to host LAN/public IP
- [ ] Pin `CORD_VERSION` to a specific version (e.g. `1.1.0`) instead of `latest`
- [ ] Set up HTTPS via reverse proxy (host nginx, Cloudflare, or container TLS override)
- [ ] Set `LIVEKIT_PUBLIC_URL` to `wss://your-domain:7880` (or `wss://your-domain/livekit` if tunneling)
- [ ] Schedule PostgreSQL + media backups
- [ ] Check logs for `SECURITY WARNING` banner after first startup — address all items
