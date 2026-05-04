# ─── Build stage ─────────────────────────────────────────────────────────
# Vite build → /app/dist. node:20-alpine is the smallest image with npm.
FROM node:20-alpine AS build
WORKDIR /app

# Dependencies as a separate layer — cached until package.json changes.
COPY package.json package-lock.json* ./
RUN npm ci

# Sources + build.
COPY . .
RUN npm run build


# ─── Serve stage ─────────────────────────────────────────────────────────
# Minimal nginx-alpine (~25MB) serves the built SPA and proxies /api, /media,
# /ws to the `backend` container via Docker DNS. No external nginx required.
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
