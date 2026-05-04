# Deployment configurations

Pick **one** of the four scenarios below. All compose files live in the **repo root** so paths resolve correctly; the `deploy/` directory only contains nginx config examples.

## Which file when

| Scenario | Command | Files involved |
|---|---|---|
| **Local development** (build from source, hot-reload) | `docker compose up --build` | `docker-compose.yaml` |
| **Production, no host nginx** (container terminates HTTPS) | `docker compose -f docker-compose.prod.yaml -f docker-compose.tls.yaml up -d` | `docker-compose.prod.yaml` + `docker-compose.tls.yaml` + `deploy/nginx-container-tls.conf` |
| **Production, host nginx in front** (recommended for VPSes that already run nginx) | `docker compose -f docker-compose.prod.yaml up -d` + configure host nginx using `deploy/nginx-host.conf` | `docker-compose.prod.yaml` + `deploy/nginx-host.conf` |
| **Production, behind Cloudflare/CDN** (no TLS on origin) | `docker compose -f docker-compose.prod.yaml up -d` | `docker-compose.prod.yaml` only |

## File reference

### Compose files (in repo root)

- `docker-compose.yaml` — **dev mode**. Builds backend + frontend from local source. Backend uses a hot-reload mount (`./backend/app:/app/app`). Frontend exposes 8080. Use this when contributing or testing local changes.
- `docker-compose.prod.yaml` — **production base**. Pulls pre-built images from `ghcr.io/spacepalm/cord-{backend,frontend}`. Frontend exposes 8080 (HTTP). Backend is not exposed externally — all traffic goes through the frontend nginx.
- `docker-compose.tls.yaml` — **TLS override**. Combine with `docker-compose.prod.yaml` to make the frontend container terminate HTTPS on ports 80/443. Mounts your SSL certs from the host. Always used alongside the prod file, never standalone.

### nginx examples (in `deploy/`)

- `nginx-host.conf` — drop-in vhost config for the **host** nginx when you want it to proxy traffic to Cord (Pattern A). Place in `/etc/nginx/sites-available/`.
- `nginx-container-tls.conf` — alternative nginx config that's mounted **into** the frontend container by `docker-compose.tls.yaml` to enable TLS inside the container (Pattern B).

## SSL certificates

**Cord does not issue or renew certificates.** Bring your own — Let's Encrypt, mkcert, paid certs, Cloudflare Origin Certificates, whatever. Configure paths in the relevant nginx config:

- Pattern A → `deploy/nginx-host.conf`, `ssl_certificate` lines
- Pattern B → `deploy/nginx-container-tls.conf`, `ssl_certificate` lines (paths inside the container)

After renewing, in Pattern A nothing extra is needed. In Pattern B, restart the frontend container so nginx picks up new files: `docker compose restart frontend`.

## Required environment

All scenarios need `.env` filled in (`cp .env.example .env`). Production additionally requires:

- `CORD_JWT_SECRET` — random 32+ chars (`openssl rand -hex 32`)
- `CORD_ADMIN_PASSWORD` — initial admin password
- `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` — random
- `SERVER_IP` — host's LAN/public IP (LiveKit needs this for ICE candidates)
- `LIVEKIT_PUBLIC_URL` — `wss://your-domain:7880` for HTTPS deployments

The prod compose file fails fast (`${VAR:?}`) if any of the secrets are missing, so you'll see a clear error instead of a misconfigured runtime.
