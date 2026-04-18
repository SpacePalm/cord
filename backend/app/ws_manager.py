"""WebSocket connection manager with Redis pub/sub fan-out between uvicorn workers.

Проблема с `--workers N > 1`: каждый процесс uvicorn имеет свой in-memory
`_channels`. Если admin подключен к worker-1, а POST /messages приходит на
worker-2, то worker-2 не видит admin в локальном `_channels` и не шлёт ему WS.

Решение: broadcast идёт через Redis pub/sub. Каждый воркер слушает один
канал и распределяет событие по своим локальным ws. Все воркеры получают
все события, но отправляют только тем ws, которые у них локально.
"""

import asyncio
import json
import logging
import uuid
from collections import defaultdict
from typing import Any

import redis.asyncio as aioredis
from fastapi import WebSocket

from app.config import settings

logger = logging.getLogger(__name__)

# Один канал на всё — нагрузка разумная для 4-8 воркеров.
_PUBSUB_CHANNEL = "cord:ws:fanout"


class ConnectionManager:
    def __init__(self):
        # chat_id -> set of (user_id, websocket) — ЛОКАЛЬНЫЕ ws на этом воркере
        self._channels: dict[uuid.UUID, set[tuple[uuid.UUID, WebSocket]]] = defaultdict(set)
        # websocket -> set of chat_ids (for cleanup on disconnect)
        self._ws_channels: dict[WebSocket, set[uuid.UUID]] = defaultdict(set)
        # Per-websocket lock — wsproto не async-safe для concurrent send.
        self._ws_locks: dict[WebSocket, asyncio.Lock] = {}
        # Redis клиенты: отдельный для publish, отдельный для subscribe
        # (у pubsub-соединения блокирующий режим).
        self._redis_pub: aioredis.Redis | None = None
        self._listener_task: asyncio.Task | None = None

    # ─── Redis pub/sub ─────────────────────────────────────────────────

    async def _get_pub(self) -> aioredis.Redis:
        if self._redis_pub is None:
            self._redis_pub = aioredis.from_url(settings.redis_url, decode_responses=True)
        return self._redis_pub

    async def start_listener(self) -> None:
        """Запустить background task который слушает Redis канал и распределяет
        события по локальным ws. Вызывается один раз на старте приложения.
        """
        if self._listener_task is not None:
            return
        self._listener_task = asyncio.create_task(self._listen_forever())

    async def _listen_forever(self) -> None:
        """Reconnect-loop: при разрыве соединения с Redis переподключается."""
        while True:
            try:
                client = aioredis.from_url(settings.redis_url, decode_responses=True)
                pubsub = client.pubsub()
                await pubsub.subscribe(_PUBSUB_CHANNEL)
                async for msg in pubsub.listen():
                    if msg.get("type") != "message":
                        continue
                    try:
                        envelope = json.loads(msg["data"])
                        await self._handle_envelope(envelope)
                    except Exception as exc:
                        logger.warning("[WS] envelope handling failed: %r", exc)
            except asyncio.CancelledError:
                return
            except Exception as exc:
                logger.warning("[WS] pubsub listener error, reconnecting: %r", exc)
                await asyncio.sleep(1)

    async def _handle_envelope(self, envelope: dict[str, Any]) -> None:
        """Обработать событие, пришедшее из Redis — отправить по локальным ws."""
        kind = envelope.get("kind")
        event = envelope.get("event") or {}
        exclude_user = envelope.get("exclude_user")
        if kind == "chat":
            chat_id = uuid.UUID(envelope["target"])
            exclude_uid = uuid.UUID(exclude_user) if exclude_user else None
            await self._dispatch_chat(chat_id, event, exclude_uid)
        elif kind == "user":
            user_id = uuid.UUID(envelope["target"])
            await self._dispatch_user(user_id, event)
        elif kind == "chats_many":
            chat_ids = [uuid.UUID(c) for c in envelope["targets"]]
            await self._dispatch_chats_many(chat_ids, event)
        elif kind == "subscribe_members":
            # Инструкция всем воркерам: подписать уже подключённые ws указанных
            # юзеров на новый chat_id. Выполняется локально каждым воркером.
            chat_id = uuid.UUID(envelope["target"])
            user_ids = {uuid.UUID(u) for u in envelope["user_ids"]}
            self._apply_subscribe_members(chat_id, user_ids)

    # ─── Local dispatch ────────────────────────────────────────────────

    async def _dispatch_chat(
        self,
        chat_id: uuid.UUID,
        event: dict,
        exclude_user: uuid.UUID | None,
    ) -> None:
        subs = list(self._channels.get(chat_id, set()))
        dead: list[WebSocket] = []
        for uid, ws in subs:
            if exclude_user is not None and uid == exclude_user:
                continue
            if not await self._safe_send(ws, event):
                dead.append(ws)
        for ws in dead:
            await self._drop(ws)

    async def _dispatch_user(self, user_id: uuid.UUID, event: dict) -> None:
        seen: set[int] = set()
        dead: list[WebSocket] = []
        for _chat_id, conns in list(self._channels.items()):
            for uid, ws in conns:
                if uid != user_id:
                    continue
                if id(ws) in seen:
                    continue
                seen.add(id(ws))
                if not await self._safe_send(ws, event):
                    dead.append(ws)
        for ws in dead:
            await self._drop(ws)

    async def _dispatch_chats_many(self, chat_ids: list[uuid.UUID], event: dict) -> None:
        seen: set[int] = set()
        dead: list[WebSocket] = []
        for cid in chat_ids:
            for _uid, ws in list(self._channels.get(cid, set())):
                if id(ws) in seen:
                    continue
                seen.add(id(ws))
                if not await self._safe_send(ws, event):
                    dead.append(ws)
        for ws in dead:
            await self._drop(ws)

    def _apply_subscribe_members(self, chat_id: uuid.UUID, user_ids: set[uuid.UUID]) -> None:
        for _chat_id, conns in list(self._channels.items()):
            for uid, ws in conns:
                if uid in user_ids:
                    self._channels[chat_id].add((uid, ws))
                    self._ws_channels[ws].add(chat_id)

    # ─── Send helpers ──────────────────────────────────────────────────

    def _lock_for(self, ws: WebSocket) -> asyncio.Lock:
        lock = self._ws_locks.get(ws)
        if lock is None:
            lock = asyncio.Lock()
            self._ws_locks[ws] = lock
        return lock

    async def _safe_send(self, ws: WebSocket, event: dict) -> bool:
        """Сериализованная отправка. True — успех, False — сокет мёртв."""
        try:
            async with self._lock_for(ws):
                await ws.send_json(event)
            return True
        except Exception as exc:
            logger.warning("[WS] send failed ws=%s event=%s err=%r",
                           id(ws), event.get("type"), exc)
            return False

    async def _drop(self, ws: WebSocket) -> None:
        """Отключить сокет из менеджера И явно закрыть его."""
        self.disconnect(ws)
        try:
            await ws.close()
        except Exception:
            pass

    # ─── Subscription API ──────────────────────────────────────────────

    def subscribe(self, ws: WebSocket, user_id: uuid.UUID, chat_id: uuid.UUID):
        self._channels[chat_id].add((user_id, ws))
        self._ws_channels[ws].add(chat_id)

    def unsubscribe(self, ws: WebSocket, chat_id: uuid.UUID):
        user_entries = {entry for entry in self._channels[chat_id] if entry[1] is ws}
        self._channels[chat_id] -= user_entries
        self._ws_channels[ws].discard(chat_id)

    def disconnect(self, ws: WebSocket):
        for chat_id in self._ws_channels.pop(ws, set()):
            self._channels[chat_id] = {
                entry for entry in self._channels[chat_id] if entry[1] is not ws
            }
        self._ws_locks.pop(ws, None)

    # ─── Public API (publish в Redis → все воркеры получат) ────────────

    async def broadcast(
        self,
        chat_id: uuid.UUID,
        event: dict,
        exclude_ws: WebSocket | None = None,
    ):
        """Разослать event всем подписчикам chat. exclude_ws — локальный ws
        отправителя (его user_id передаётся как exclude_user, чтобы другие
        воркеры тоже могли его пропустить).
        """
        exclude_user: str | None = None
        if exclude_ws is not None:
            # Находим user_id по ws локально
            for _cid, conns in self._channels.items():
                for uid, ws in conns:
                    if ws is exclude_ws:
                        exclude_user = str(uid)
                        break
                if exclude_user:
                    break
        envelope = {
            "kind": "chat",
            "target": str(chat_id),
            "event": event,
            "exclude_user": exclude_user,
        }
        pub = await self._get_pub()
        await pub.publish(_PUBSUB_CHANNEL, json.dumps(envelope))

    async def broadcast_to_many(self, chat_ids: list[uuid.UUID], event: dict):
        envelope = {
            "kind": "chats_many",
            "targets": [str(c) for c in chat_ids],
            "event": event,
        }
        pub = await self._get_pub()
        await pub.publish(_PUBSUB_CHANNEL, json.dumps(envelope))

    async def send_to_user(self, user_id: uuid.UUID, event: dict) -> int:
        """Отправить event всем ws пользователя. Возвращает 1 если publish
        прошёл (фактическая доставка на клиентов — best-effort, через Redis).
        """
        envelope = {
            "kind": "user",
            "target": str(user_id),
            "event": event,
        }
        pub = await self._get_pub()
        await pub.publish(_PUBSUB_CHANNEL, json.dumps(envelope))
        return 1

    def subscribe_all_members(self, chat_id: uuid.UUID, user_ids: list[uuid.UUID]) -> None:
        """Подписать уже подключённых WS-клиентов указанных юзеров на новый chat_id.
        Локально применяется сразу + publish команду другим воркерам.
        """
        self._apply_subscribe_members(chat_id, set(user_ids))
        envelope = {
            "kind": "subscribe_members",
            "target": str(chat_id),
            "user_ids": [str(u) for u in user_ids],
        }
        # Fire-and-forget task чтобы не блокировать sync-вызывающего.
        async def _pub():
            try:
                pub = await self._get_pub()
                await pub.publish(_PUBSUB_CHANNEL, json.dumps(envelope))
            except Exception as exc:
                logger.warning("[WS] subscribe_members publish failed: %r", exc)
        try:
            asyncio.get_running_loop().create_task(_pub())
        except RuntimeError:
            # Нет event-loop'а (тестовый контекст) — просто пропускаем
            pass


manager = ConnectionManager()
