"""WebSocket endpoint for real-time message delivery."""

import json
import logging
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.auth import decode_access_token
from app.database import AsyncSessionLocal
from app.models.user import User
from app.models.group import Chat, GroupMember
from app.ws_manager import manager

logger = logging.getLogger(__name__)
router = APIRouter()


async def _authenticate(token: str) -> User | None:
    payload = decode_access_token(token)
    if not payload or "sub" not in payload:
        return None
    async with AsyncSessionLocal() as db:
        return await db.get(User, uuid.UUID(payload["sub"]))


async def _user_chat_ids(user_id: uuid.UUID) -> set[uuid.UUID]:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Chat.id)
            .join(GroupMember, GroupMember.group_id == Chat.group_id)
            .where(GroupMember.user_id == user_id)
        )
        return {row[0] for row in result.all()}


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    # Extract token from Sec-WebSocket-Protocol header: "auth.<jwt>"
    token: str | None = None
    for proto in ws.headers.get("sec-websocket-protocol", "").split(","):
        proto = proto.strip()
        if proto.startswith("auth."):
            token = proto[5:]
            break

    if not token:
        await ws.close(code=4001, reason="Unauthorized")
        return

    user = await _authenticate(token)
    if not user:
        await ws.close(code=4001, reason="Unauthorized")
        return

    # Accept with the same subprotocol so the browser doesn't reject
    await ws.accept(subprotocol=f"auth.{token}")

    chat_ids = await _user_chat_ids(user.id)
    for chat_id in chat_ids:
        manager.subscribe(ws, user.id, chat_id)

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            action = msg.get("action")

            # Ping/pong — клиент шлёт каждые 25 сек, мы отвечаем pong'ом.
            # Без активности идёт молчаливый дисконнект через 30 сек → клиент
            # переподключается и подтягивает пропущенное. Держит соединение
            # живым через nginx/мобильные прокси (они рубят idle WS).
            if action == "ping":
                try:
                    await ws.send_json({"type": "pong"})
                except Exception:
                    pass
                continue

            chat_id_str = msg.get("chat_id")
            if not action or not chat_id_str:
                continue

            try:
                chat_id = uuid.UUID(chat_id_str)
            except ValueError:
                continue

            if action == "subscribe" and chat_id in (await _user_chat_ids(user.id)):
                manager.subscribe(ws, user.id, chat_id)
            elif action == "unsubscribe":
                manager.unsubscribe(ws, chat_id)
            elif action in ("typing", "stop_typing"):
                # Re-проверяем членство на каждом typing-событии. Иначе после
                # kick-а user'а он продолжит слать typing в чат, где раньше был,
                # и member'ы будут видеть призрачного «участника».
                if chat_id not in (await _user_chat_ids(user.id)):
                    manager.unsubscribe(ws, chat_id)
                    continue
                event_type = action  # "typing" or "stop_typing"
                payload: dict = {"type": event_type, "chat_id": chat_id_str, "user_id": str(user.id)}
                if event_type == "typing":
                    payload["display_name"] = user.display_name or user.username
                await manager.broadcast(chat_id, payload, exclude_ws=ws)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("[WS] loop exception ws=%s err=%r", id(ws), exc)
    finally:
        manager.disconnect(ws)
