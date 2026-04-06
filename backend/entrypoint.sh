#!/bin/bash
set -e

# Если задан CORD_S3_ENABLED=true — монтируем S3-бакет через s3fs в /app/media.
# После монтирования приложение работает с /app/media как с обычной файловой системой.
if [ "${CORD_S3_ENABLED:-false}" = "true" ]; then
    echo "S3 enabled — mounting bucket '${CORD_S3_BUCKET}' at /app/media"

    # Файл с ключами для s3fs
    echo "${CORD_S3_ACCESS_KEY}:${CORD_S3_SECRET_KEY}" > /etc/passwd-s3fs
    chmod 600 /etc/passwd-s3fs

    mkdir -p /app/media

    OPTS="passwd_file=/etc/passwd-s3fs,allow_other,nonempty,use_cache=/tmp/s3fs_cache,retries=5,connect_timeout=10,readwrite_timeout=30,max_stat_cache_size=10000"

    if [ -n "${CORD_S3_ENDPOINT_URL}" ]; then
        OPTS="${OPTS},url=${CORD_S3_ENDPOINT_URL},use_path_request_style"
    fi

    if [ -n "${CORD_S3_REGION}" ]; then
        OPTS="${OPTS},endpoint=${CORD_S3_REGION}"
    fi

    s3fs "${CORD_S3_BUCKET}" /app/media -o "${OPTS}"
    echo "Mounted S3 bucket '${CORD_S3_BUCKET}' at /app/media"
fi

exec "$@"
