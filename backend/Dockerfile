FROM python:3.14-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends gcc libpq-dev libsasl2-dev s3fs fuse \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml .
COPY app/ app/
RUN pip install --no-cache-dir .

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
# --workers 1 — each Python worker holds ~100-150 MB; one is enough for most
# deployments. Bump to 2-4 under real load, given available RAM.
# --limit-max-requests 10000 — periodic worker restart frees accumulated memory
# (asyncio/SQLAlchemy leaks on long-running processes).
# No --reload — watchfiles spawns an extra process, not needed in production.
CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "1", \
     "--limit-max-requests", "10000"]
