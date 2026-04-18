"""WebSocket connection manager for real-time message delivery."""

import asyncio
import logging
import uuid
from collections import defaultdict
from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self):
        # chat_id -> set of (user_id, websocket)
        self._channels: dict[uuid.UUID, set[tuple[uuid.UUID, WebSocket]]] = defaultdict(set)
        # websocket -> set of chat_ids (for cleanup on disconnect)
        self._ws_channels: dict[WebSocket, set[uuid.UUID]] = defaultdict(set)
        # Per-websocket lock: starlette/uvicorn не сериализует concurrent send_json.
        # Если два POST-а одновременно делают broadcast, два `await send_json` на
        # одном и том же сокете могут переплестись — wsproto не thread-safe,
        # фреймы теряются. Лок гарантирует последовательность отправок.
        self._ws_locks: dict[WebSocket, asyncio.Lock] = {}

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

    def subscribe(self, ws: WebSocket, user_id: uuid.UUID, chat_id: uuid.UUID):
        self._channels[chat_id].add((user_id, ws))
        self._ws_channels[ws].add(chat_id)
        logger.warning("[WS] SUBSCRIBE ws=%s user=%s chat=%s total=%d",
                       id(ws), user_id, chat_id, len(self._channels[chat_id]))

    def unsubscribe(self, ws: WebSocket, chat_id: uuid.UUID):
        user_entries = {entry for entry in self._channels[chat_id] if entry[1] is ws}
        if user_entries:
            logger.warning("[WS] UNSUBSCRIBE ws=%s chat=%s (had %d entries)",
                           id(ws), chat_id, len(user_entries))
        self._channels[chat_id] -= user_entries
        self._ws_channels[ws].discard(chat_id)

    def disconnect(self, ws: WebSocket):
        chats = self._ws_channels.pop(ws, set())
        if chats:
            logger.warning("[WS] disconnect cleanup ws=%s removes from %d chats", id(ws), len(chats))
        for chat_id in chats:
            self._channels[chat_id] = {
                entry for entry in self._channels[chat_id] if entry[1] is not ws
            }
        self._ws_locks.pop(ws, None)

    async def _drop(self, ws: WebSocket) -> None:
        """Отключить сокет из менеджера И явно закрыть его.

        Без явного close: backend считает сокет «мёртвым» (не шлёт туда событий),
        но браузер держит TCP открытым — onclose не срабатывает, реконнект не
        идёт, все последующие сообщения молча теряются до reload. Принудительный
        close заставляет клиента увидеть disconnect и переподключиться.
        """
        self.disconnect(ws)
        try:
            await ws.close()
        except Exception:
            pass

    async def broadcast(self, chat_id: uuid.UUID, event: dict, exclude_ws: WebSocket | None = None):
        subs = list(self._channels.get(chat_id, set()))
        sub_info = [f"{str(uid)[:8]}:{id(w)}" for uid, w in subs]
        logger.warning("[WS] broadcast chat=%s event=%s subscribers=%d %s",
                       chat_id, event.get("type"), len(subs), sub_info)
        dead: list[WebSocket] = []
        sent_ok = 0
        for _user_id, ws in subs:
            if ws is exclude_ws:
                continue
            if await self._safe_send(ws, event):
                sent_ok += 1
            else:
                dead.append(ws)
        logger.warning("[WS] broadcast done chat=%s sent=%d dead=%d",
                       chat_id, sent_ok, len(dead))
        for ws in dead:
            await self._drop(ws)

    async def broadcast_to_many(self, chat_ids: list[uuid.UUID], event: dict):
        """Broadcast event to unique websockets across multiple channels."""
        sent: set[int] = set()
        dead: list[WebSocket] = []
        for cid in chat_ids:
            for _user_id, ws in list(self._channels.get(cid, set())):
                ws_id = id(ws)
                if ws_id in sent:
                    continue
                sent.add(ws_id)
                if not await self._safe_send(ws, event):
                    dead.append(ws)
        for ws in dead:
            await self._drop(ws)

    async def send_to_user(self, user_id: uuid.UUID, event: dict) -> int:
        """Доставить event по всем активным сокетам пользователя (он может быть
        подключен с нескольких устройств). Возвращает количество успешных отправок.
        Если получатель офлайн — 0 (fire-and-forget).
        """
        sent: set[int] = set()
        delivered = 0
        dead: list[WebSocket] = []
        for _chat_id, conns in list(self._channels.items()):
            for uid, ws in conns:
                if uid != user_id:
                    continue
                ws_id = id(ws)
                if ws_id in sent:
                    continue
                sent.add(ws_id)
                if await self._safe_send(ws, event):
                    delivered += 1
                else:
                    dead.append(ws)
        for ws in dead:
            await self._drop(ws)
        return delivered

    def subscribe_all_members(self, chat_id: uuid.UUID, user_ids: list[uuid.UUID]) -> None:
        """Подписать уже подключённых WS-клиентов указанных юзеров на новый chat_id.
        Нужно при создании чата в рантайме (например, voice-чата DM при звонке) —
        иначе они не получат последующие события по этому каналу.
        """
        target = set(user_ids)
        for _chat_id, conns in list(self._channels.items()):
            for uid, ws in conns:
                if uid in target:
                    self._channels[chat_id].add((uid, ws))
                    self._ws_channels[ws].add(chat_id)


manager = ConnectionManager()
