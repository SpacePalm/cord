[← Back to README](../README.md)

# Administration

The admin panel is gated behind `role == "admin"`. Default credentials (change in `.env` before first login!):

- Email: `admin@admin.com`
- Password: `admin123`

- [Accessing the Admin Panel](#accessing-the-admin-panel)
- [Users Tab](#users-tab)
- [Servers Tab](#servers-tab)
- [System Tab](#system-tab)
- [Security Tab](#security-tab)

---

## Accessing the Admin Panel

1. Log in with an admin account.
2. Click the shield icon in the bottom-left sidebar, **or** press `Ctrl+K` → «Admin panel».
3. Or navigate directly to `/admin`.

> The admin panel is **disabled while you're in a voice/video call** — switching pages would tear down the LiveKit connection. Leave the call first.

---

## Users Tab

- **Search** users by name or email
- **Promote/Demote** — toggle admin role
- **Block/Unblock** — disable user login without deleting (invalidates active JWT sessions immediately via `is_active` check)
- **Delete** — permanently remove user and their data

---

## Servers Tab

- View all non-system groups with owner, member count, and channel count
- DM groups and personal "Saved Messages" groups are **hidden** from this list — they are system entities and cannot be modified from the admin panel
- **Expand** to see member list
- **Kick** members from any group (except DM)
- **Delete** groups (removes all channels and messages). DM and personal groups are protected

---

## System Tab

- **Registration Toggle** — enable/disable new user registration
- **Statistics** — user count, group count, message count, attachment count, disk usage breakdown
- **Cleanup: Old Messages** — delete messages older than N days with two independent toggles:
  - **Include personal saved messages** — when OFF, each user's Saved Messages are preserved
  - **Include direct messages** — when OFF, private DM conversations are preserved
- **Cleanup: Orphaned Attachments** — remove files on disk without matching database records

---

## Security Tab

Brute-force protection (fail2ban-style) and login audit. Settings persist in `app_settings` and apply globally. See [Security & Fail2ban](security.md) for the full mechanism description.

### Settings panel

- Master **Enabled** toggle — when off, no auto-bans/locks happen and active blocks are ignored
- **Attempts per IP before ban** (default 10) — IP gets auto-banned after N failed logins in the window
- **Attempts per account before lock** (default 5) — account gets locked after N failed logins
- **Window** (default 300s) — sliding window for counting failures
- **IP ban duration** (default 3600s) and **Account lock duration** (default 1800s)
- Log retention is fixed at 30 days; manual purge endpoint is available but not wired to UI

### Blocked IPs table

List of all active (and optionally expired) bans with reason, source (`auto` / `manual`), expiry, attempts counter, unblock button. Manual block form below the table accepts IP + reason + duration (1h / 1d / 7d / 30d / permanent).

### Locked accounts table

Accounts auto-locked by failed attempts; click **Unlock** to reset `failed_attempts` and clear `locked_until`.

### Login attempt log

Two views:

- **List** — flat log filterable by IP, username, success/fail, time range
- **By IP** (default) — grouped by source IP with failure/success counters, distinct usernames tried, expand-arrow to see per-username breakdown. Each row has an inline duration selector + Block / Unblock button

### Runtime enforcement

When an IP is banned, every subsequent authenticated API request from that IP returns `403 blocked_by_security`. The frontend catches this globally and redirects the user to `/blocked` with a countdown to unblock.
