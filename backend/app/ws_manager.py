"""WebSocket connection manager for real-time message delivery."""

import uuid
from collections import defaultdict
from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        # chat_id -> set of (user_id, websocket)
        self._channels: dict[uuid.UUID, set[tuple[uuid.UUID, WebSocket]]] = defaultdict(set)
        # websocket -> set of chat_ids (for cleanup on disconnect)
        self._ws_channels: dict[WebSocket, set[uuid.UUID]] = defaultdict(set)

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

    async def broadcast(self, chat_id: uuid.UUID, event: dict, exclude_ws: WebSocket | None = None):
        dead: list[WebSocket] = []
        for _user_id, ws in list(self._channels.get(chat_id, set())):
            if ws is exclude_ws:
                continue
            try:
                await ws.send_json(event)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

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
                try:
                    await ws.send_json(event)
                except Exception:
                    dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = ConnectionManager()
