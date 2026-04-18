# Build-only образ: собирает SPA в /app/dist.
# Контейнер не держит веб-сервер — при старте копирует собранную статику в
# смонтированный volume (./frontend-dist на хосте) и завершается.
# Внешний nginx на хосте раздаёт эту директорию как root для домена.

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

# Финальный слой — крошечный alpine без Node. Только готовый dist и простой
# copy-at-start скрипт. Runtime RAM ≈ 0 (контейнер жив ~1 секунду).
FROM alpine:3.19
COPY --from=build /app/dist /src

# При старте: чистим старое, копируем в volume, выходим с кодом 0.
CMD sh -c 'rm -rf /out/* /out/.* 2>/dev/null; cp -r /src/. /out/ && echo "Frontend build copied to /out"'
