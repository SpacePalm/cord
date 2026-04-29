FROM python:3.14-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends gcc libpq-dev libsasl2-dev s3fs fuse \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml .
COPY app/ app/
RUN pip install --no-cache-dir .

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
RUN mkdir -p media && chmod 755 -R media

ENTRYPOINT ["/entrypoint.sh"]
# --workers 1 — каждый Python-воркер держит ~100-150 MB, для большинства deploy'ев
# одного хватает. При реальной нагрузке увеличить (2-4) с учётом доступной RAM.
# --limit-max-requests 10000 — периодический перезапуск воркера освобождает
# накопленную память (утечки asyncio/SQLAlchemy на длительных процессах).
# Без --reload: watchfiles-наблюдатель держит отдельный процесс, в проде не нужен.
CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "1", \
     "--limit-max-requests", "10000"]
