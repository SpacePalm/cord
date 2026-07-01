"""Серверный гейт уведомлений + фан-аут APNs-пушей.

Клиентский `NotificationGate` серверу недоступен (пуш нужен при закрытом
приложении), поэтому фильтрация (уровень/mute/DM/mention/personal) перенесена
сюда — порт логики из `frontend/.../MessageNotifier.tsx`.

Точка входа из `messages.py` — `enqueue_message_push` / `enqueue_bulk_forward_push`
(ставят `send_pushes` в BackgroundTask). `send_pushes` открывает СВЕЖУЮ
`AsyncSessionLocal` (сессия запроса уже закрыта к моменту выполнения таска).

Весь модуль — no-op, если APNs не сконфигурирован (`push_enabled()`).
"""
import json
import logging
import re
import uuid
from collections import defaultdict
from datetime import datetime

from sqlalchemy import select, delete as sa_delete, func

from app.apns import push_enabled, send_push

logger = logging.getLogger(__name__)

_MAX_BODY = 150


# ─── Серверный гейт (порт NotificationGate) ────────────────────────────

def should_push(
    *,
    level: str,
    is_own: bool,
    is_muted: bool,
    is_personal: bool,
    is_dm: bool,
    mentioned: bool,
) -> bool:
    """Тот же порядок, что и на клиенте (MessageNotifier):
    своё → off → muted → personal → уровень.
    `isActiveChatForeground` серверу неизвестен — foreground-дубль давится
    на клиенте (willPresent), см. спеку §4.
    """
    if is_own:
        return False
    if level == 'off':
        return False
    if is_muted:
        return False
    if is_personal:  # Saved Messages — никогда не пушим
        return False
    if level == 'all':
        return True
    if level == 'dm_only':
        return is_dm
    if level == 'mentions_dm':
        return is_dm or mentioned
    # Неизвестный уровень — трактуем как дефолт клиента (mentions_dm).
    return is_dm or mentioned


# ─── Разбор preferences_json получателя ────────────────────────────────
# Структура (frontend/src/utils/preferencesSync.ts):
#   { "notifications": {"level", "sound", "browserEnabled"}, "mutedChats": {chatId: bool} }
# preferences_json может быть NULL и перезаписывается целиком на PUT /auth/preferences
# → всегда `or '{}'` + дефолты.

def _parse_prefs(preferences_json: str | None) -> dict:
    try:
        prefs = json.loads(preferences_json or '{}')
        if not isinstance(prefs, dict):
            prefs = {}
    except Exception:
        prefs = {}
    notif = prefs.get('notifications')
    if not isinstance(notif, dict):
        notif = {}
    level = notif.get('level') or 'mentions_dm'
    sound_raw = notif.get('sound')
    sound = True if sound_raw is None else bool(sound_raw)
    muted = prefs.get('mutedChats')
    if not isinstance(muted, dict):
        muted = {}
    return {'level': level, 'sound': sound, 'muted': muted}


def _is_muted(muted: dict, chat_id: uuid.UUID) -> bool:
    return bool(muted.get(str(chat_id)))


def _mentioned(content: str | None, username: str | None) -> bool:
    """@username по границам слова, case-insensitive. Матчим по username
    (как клиентский regex и поиск), не по display_name."""
    if not content or not username:
        return False
    pattern = rf'(^|[^A-Za-z0-9_])@{re.escape(username)}(?![A-Za-z0-9_])'
    return re.search(pattern, content, re.IGNORECASE) is not None


# ─── Тело пуша из MessageOut ───────────────────────────────────────────

def _truncate(s: str) -> str:
    s = ' '.join((s or '').split())
    return s if len(s) <= _MAX_BODY else s[:_MAX_BODY - 1] + '…'


def _body_from_msg_out(m) -> str:
    """content / forwarded_from.content / «📎 Вложение» / вопрос опроса (§3.7)."""
    if m.content and m.content.strip():
        return _truncate(m.content)
    fwd = getattr(m, 'forwarded_from', None)
    if fwd is not None and fwd.content:
        return _truncate(fwd.content)
    if getattr(m, 'attachments', None):
        return '📎 Вложение'
    poll = getattr(m, 'poll', None)
    if poll is not None and getattr(poll, 'question', None):
        return _truncate(f'📊 {poll.question}')
    return 'Новое сообщение'


async def _unread_totals(db, user_ids: list[uuid.UUID]) -> dict:
    """Batched badge: суммарный unread для КАЖДОГО из user_ids ОДНИМ запросом
    (устраняет N+1 по получателям). Возвращает {user_id: total}.

    Семантика идентична sum(compute_unread(u).values()): считает все каналы
    пользователя, без фильтра по автору сообщения (как клиентский unread/badge).
    """
    if not user_ids:
        return {}
    from app.models.group import GroupMember, Chat
    from app.models.message import Message
    from app.models.user_chat_state import UserChatState
    epoch = datetime(1970, 1, 1)
    stmt = (
        select(GroupMember.user_id, func.count(Message.id).label('count'))
        .select_from(GroupMember)
        .join(Chat, Chat.group_id == GroupMember.group_id)
        .outerjoin(
            UserChatState,
            (UserChatState.chat_id == Chat.id) & (UserChatState.user_id == GroupMember.user_id),
        )
        .outerjoin(
            Message,
            (Message.chat_id == Chat.id)
            & (Message.created_at > func.coalesce(UserChatState.last_read_at, epoch)),
        )
        .where(GroupMember.user_id.in_(user_ids))
        .group_by(GroupMember.user_id)
    )
    rows = await db.execute(stmt)
    return {r.user_id: r.count for r in rows}


# ─── Фан-аут ───────────────────────────────────────────────────────────

async def send_pushes(
    *,
    chat_id: uuid.UUID,
    group_id: uuid.UUID,
    sender_id: uuid.UUID,
    sender_name: str,
    content: str | None,
    body_text: str,
    message_id: str | None = None,
) -> None:
    """Фоновая задача: разослать пуш всем прошедшим гейт получателям чата.
    Открывает свежую сессию (сессия запроса уже закрыта). Никогда не бросает —
    пуши best-effort."""
    if not push_enabled():
        return
    try:
        from app.database import AsyncSessionLocal
        from app.models.group import Group, GroupMember
        from app.models.user import User
        from app.models.device_token import DeviceToken

        async with AsyncSessionLocal() as db:
            group = await db.get(Group, group_id)
            if group is None:
                return
            is_dm = bool(group.is_dm)
            is_personal = bool(group.is_personal)
            group_name = group.name or ''

            recipient_ids = (await db.execute(
                select(GroupMember.user_id).where(
                    GroupMember.group_id == group_id,
                    GroupMember.user_id != sender_id,
                )
            )).scalars().all()
            if not recipient_ids:
                return

            # Токены получателей одним запросом; получатели без устройств отсеиваются.
            token_rows = (await db.execute(
                select(DeviceToken.user_id, DeviceToken.token, DeviceToken.apns_env)
                .where(DeviceToken.user_id.in_(recipient_ids))
            )).all()
            if not token_rows:
                return
            tokens_by_user: dict = defaultdict(list)
            for r in token_rows:
                tokens_by_user[r.user_id].append((r.token, r.apns_env))

            # username + prefs только для получателей с устройствами.
            user_rows = (await db.execute(
                select(User.id, User.username, User.preferences_json)
                .where(User.id.in_(list(tokens_by_user.keys())))
            )).all()

            title_channel = f'{sender_name} · {group_name}' if group_name else sender_name
            # title одинаков для всех получателей (DM→автор, иначе автор·сервер).
            title = sender_name if is_dm else title_channel

            # Фаза 1: гейт — отбираем прошедших получателей (id + флаг звука).
            survivors: list[tuple[uuid.UUID, bool]] = []
            for u in user_rows:
                prefs = _parse_prefs(u.preferences_json)
                if should_push(
                    level=prefs['level'],
                    is_own=False,
                    is_muted=_is_muted(prefs['muted'], chat_id),
                    is_personal=is_personal,
                    is_dm=is_dm,
                    mentioned=_mentioned(content, u.username),
                ):
                    survivors.append((u.id, prefs['sound']))
            if not survivors:
                return

            # Фаза 2: badge всех выживших ОДНИМ запросом (без N+1 по получателям).
            badges = await _unread_totals(db, [uid for uid, _ in survivors])
            dead_tokens: list[str] = []

            for uid, sound in survivors:
                aps: dict = {
                    'alert': {'title': title, 'body': body_text},
                    'badge': int(badges.get(uid, 0)),
                    'thread-id': str(chat_id),
                }
                if sound:
                    aps['sound'] = 'default'
                payload: dict = {'aps': aps, 'chatId': str(chat_id), 'title': title}
                if message_id:
                    payload['messageId'] = str(message_id)

                for token, env in tokens_by_user[uid]:
                    status = await send_push(token, env, payload)
                    if status == 'gone':
                        dead_tokens.append(token)

            if dead_tokens:
                await db.execute(sa_delete(DeviceToken).where(DeviceToken.token.in_(dead_tokens)))
                await db.commit()
    except Exception as exc:
        logger.warning('[PUSH] send_pushes failed chat=%s: %r', chat_id, exc)


# ─── Enqueue-хелперы (вызываются из messages.py, sync) ─────────────────

def enqueue_message_push(background_tasks, chat_id: uuid.UUID, group_id: uuid.UUID, msg_out) -> None:
    """Поставить пуш по одному новому сообщению. Все данные берутся из msg_out
    (MessageOut — чистые данные, безопасно для BackgroundTask)."""
    if not push_enabled():
        return
    sender_name = msg_out.author_display_name or msg_out.author_username or 'Cord'
    background_tasks.add_task(
        send_pushes,
        chat_id=chat_id,
        group_id=group_id,
        sender_id=msg_out.author_id,
        sender_name=sender_name,
        content=msg_out.content,
        body_text=_body_from_msg_out(msg_out),
        message_id=str(msg_out.id),
    )


def enqueue_bulk_forward_push(background_tasks, chat_id: uuid.UUID, group_id: uuid.UUID, msg_outs: list) -> None:
    """Один агрегированный пуш на bulk-форвард («N пересланных сообщений»),
    чтобы не устроить шторм по одному на сообщение."""
    if not push_enabled() or not msg_outs:
        return
    first = msg_outs[0]
    sender_name = first.author_display_name or first.author_username or 'Cord'
    count = len(msg_outs)
    body = 'Пересланное сообщение' if count == 1 else f'{count} пересланных сообщений'
    background_tasks.add_task(
        send_pushes,
        chat_id=chat_id,
        group_id=group_id,
        sender_id=first.author_id,
        sender_name=sender_name,
        content=None,       # у форвардов нет @mention-контента
        body_text=body,
        message_id=None,    # агрегат — без messageId
    )
