[← Back to README](../README.md)

# Deployment

- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Reverse proxy / TLS](#reverse-proxy--tls)
- [Docker Compose Services](#docker-compose-services)
- [Startup Migrations](#startup-migrations)
- [Production Considerations](#production-considerations)
- [Production Checklist](#production-checklist)

---

## Quick Start

There are two ways to run Cord:

| Mode | When to use | Build time | Compose file |
|------|-------------|-----------|--------------|
| **Production** (pre-built images from GHCR) | Self-hosting, demos, evaluation | ~30s pull | `docker-compose.prod.yaml` |
| **Development** (build from source on host) | Contributing, custom changes | ~5-10 min build | `docker-compose.yaml` |

### Production (recommended for self-hosters)

```bash
# 1. Clone the repository (just for compose files + .env.example)
git clone https://github.com/SpacePalm/cord && cd cord

# 2. Configure environment — required values
cp .env.example .env
# Open .env and set at minimum:
#   CORD_JWT_SECRET=<random 32+ char string>
#   CORD_ADMIN_PASSWORD=<secure password>
#   LIVEKIT_API_KEY=<random>
#   LIVEKIT_API_SECRET=<random>
#   SERVER_IP=<host LAN/public IP>  (required for voice)

# 3. Pull images and start
docker compose -f docker-compose.prod.yaml up -d

# 4. Open
# http://localhost:8080
```

Updates: `docker compose -f docker-compose.prod.yaml pull && docker compose -f docker-compose.prod.yaml up -d`.

To pin a specific version: `CORD_VERSION=v1.0.0` in `.env` (default `latest`).

### Development (for contributors)

```bash
git clone https://github.com/SpacePalm/cord && cd cord
cp .env.example .env
docker compose up --build
# → http://localhost:8080
```

Backend uses a hot-reload mount (`./backend/app:/app/app`) — Python changes apply on the next request without restart. Frontend rebuilds on container restart.

### Prerequisites

- Docker 24+ and Docker Compose v2
- Git
- Open ports: `8080` (or whichever you choose for `FRONTEND_PORT`), `7880-7882` for LiveKit

Default admin credentials (change in `.env`):
- Email: `admin@admin.com`
- Password: `admin123`

> The backend prints a **SECURITY WARNING** in logs if default secrets are detected.

---

## Configuration

All backend settings use the `CORD_` prefix and are defined in `backend/app/config.py`.

### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_DB` | `cord` | Database name |
| `POSTGRES_USER` | `cord` | Database user |
| `POSTGRES_PASSWORD` | `cord` | Database password |

### Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `CORD_JWT_SECRET` | `change-me-in-production` | **Must change in production.** Secret key for signing access tokens AND HMAC-hashing refresh tokens |
| `CORD_JWT_EXPIRE_MINUTES` | `15` | Access token TTL. Sessions stay long-lived through refresh tokens (30 days, automatic rotation by the frontend) |

### Admin Account

Auto-created on first startup if not exists.

| Variable | Default | Description |
|----------|---------|-------------|
| `CORD_ADMIN_USERNAME` | `admin` | Admin username |
| `CORD_ADMIN_EMAIL` | `admin@admin.com` | Admin email (used for login) |
| `CORD_ADMIN_PASSWORD` | `admin123` | **Must change in production.** Admin password |

### LiveKit (Voice/Video)

| Variable | Default | Description |
|----------|---------|-------------|
| `LIVEKIT_API_KEY` | `devkey` | LiveKit API key |
| `LIVEKIT_API_SECRET` | `secret` | LiveKit API secret |
| `LIVEKIT_PUBLIC_URL` | `ws://localhost:7880` | WebSocket URL accessible from browser |
| `SERVER_IP` | `127.0.0.1` | Passed to LiveKit as `--node-ip`. Set to host LAN IP so ICE candidates are reachable from browser |

### S3 Storage (Optional)

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

## Reverse proxy / TLS

The frontend container ships with its own nginx that serves the SPA and proxies `/api`, `/media`, `/ws` to the backend. You have two patterns to expose Cord publicly with HTTPS:

All compose files live in the repo root; nginx examples are in `deploy/`. See [deploy/README.md](../deploy/README.md) for a complete table of which file goes with which scenario.

**SSL certificates are your responsibility** — Cord doesn't issue them. Use Let's Encrypt, mkcert, paid certs, whatever. Both patterns below assume you already have `fullchain.pem` and `privkey.pem` on the host.

### Pattern A — host nginx in front + container nginx (recommended)

You already run nginx on the host. Add Cord as another vhost that proxies everything to `localhost:8080`.

```bash
# 1. Cord running:
docker compose -f docker-compose.prod.yaml up -d

# 2. Drop the example config and edit it:
sudo cp deploy/nginx-host.conf /etc/nginx/sites-available/cord
# In the file change:
#   - server_name cord.example.com → your domain
#   - ssl_certificate / ssl_certificate_key → paths to your certs

# 3. Enable + reload:
sudo ln -s /etc/nginx/sites-available/cord /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

The container nginx handles internal routing (`/api`, `/ws`, `/media`, SPA fallback). Your host nginx is just one `proxy_pass http://127.0.0.1:8080` for the whole site. See [deploy/nginx-host.conf](../deploy/nginx-host.conf).

### Pattern B — container nginx only, with TLS inside

For minimal setups (small VPS, no other sites). Container terminates HTTPS directly on ports 80/443.

```bash
# 1. Edit deploy/nginx-container-tls.conf:
#    - server_name → your domain (or leave _ for any)
#    - ssl_certificate / ssl_certificate_key → paths INSIDE the container

# 2. Default override mounts /etc/letsencrypt; if your certs live elsewhere,
#    edit the volume in docker-compose.tls.yaml.

# 3. Run with the TLS override:
docker compose \
  -f docker-compose.prod.yaml \
  -f docker-compose.tls.yaml \
  up -d
```

After cert renewal, restart the frontend container so nginx picks up new files: `docker compose -f docker-compose.prod.yaml restart frontend`.

See [deploy/nginx-container-tls.conf](../deploy/nginx-container-tls.conf) and [docker-compose.tls.yaml](../docker-compose.tls.yaml).

### Which to choose

| | Pattern A | Pattern B |
|---|---|---|
| Already have nginx on host | ✓ Use this | — |
| Small VPS, only Cord | — | ✓ Use this |
| Cloudflare/CDN in front | ✓ (skip TLS, just proxy) | ✓ |
| Memory cost of extra nginx | +5-15 MB | 0 |
| After cert renewal | nothing (host nginx auto-reloads) | restart frontend container |

---

## Docker Compose Services

| Service | Image | Exposed port | Health Check |
|---------|-------|------|-------------|
| `livekit` | livekit/livekit-server | 7880, 7881, 7882/udp | — |
| `redis` | redis:7-alpine | (internal) | `redis-cli ping` |
| `db` | postgres:16-alpine | (internal) | `pg_isready` |
| `backend` | `ghcr.io/spacepalm/cord-backend` | (internal) | — |
| `frontend` | `ghcr.io/spacepalm/cord-frontend` | 8080 (or 80/443 with TLS override) | — |

---

## Startup Migrations

On backend startup, the following database migrations run automatically (idempotent):

- `CREATE EXTENSION pg_trgm` — required for trigram search
- `ALTER TABLE "group" ADD COLUMN is_dm` — DM flag
- `ALTER TABLE message ADD COLUMN content_tsv tsvector` + trigger + GIN index — full-text search
- Composite B-tree index on `message(chat_id, created_at)` — pagination
- Trigram GIN indexes on `message.content`, `user.username`, `user.display_name` — ILIKE search
- Index on `group_member(user_id)` — «my groups» queries

Indexes can also be created manually with `CREATE INDEX CONCURRENTLY` on large production DBs.

---

## Production Considerations

1. **Change default secrets** — backend logs a security warning if `CORD_JWT_SECRET` or `CORD_ADMIN_PASSWORD` are default values
2. **Set `SERVER_IP`** — LiveKit needs the host's LAN/public IP to advertise correct ICE candidates
3. **Use the prod compose file** — `docker compose -f docker-compose.prod.yaml up -d` pulls pre-built images from GHCR, no on-host builds. The dev compose (`docker-compose.yaml`) is for contributors only
4. **Pin a version in production** — `CORD_VERSION=1.1.0` in `.env` to avoid surprise upgrades when `latest` moves; bump explicitly when you've reviewed release notes
5. **Use HTTPS** — see [Reverse proxy / TLS](#reverse-proxy--tls) for the two supported patterns (host nginx in front, or container nginx terminating TLS itself)
6. **LiveKit TLS** — set `LIVEKIT_PUBLIC_URL=wss://your-domain:7880` (or tunnel through `/livekit/` in your host nginx)
7. **Backup** — schedule PostgreSQL dumps and media directory backups
8. **Rate limits** — built-in Redis-based limiters protect `/auth/login` (10/5min), `/auth/register` (5/hour), `/auth/refresh` (20/min), `/auth/logout` (10/min), and `/api/search/*` (60/min per IP)

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
