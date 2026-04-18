"""
Эндпоинты для голосований.

  POST   /api/polls/{poll_id}/vote   — проголосовать за вариант
  DELETE /api/polls/{poll_id}/vote   — отозвать голос
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.auth import get_current_user
from app.models.user import User
from app.models.poll import Poll, PollOption, PollVote
from app.models.group import GroupMember
from app.schemas.message import PollOut, PollOptionOut

router = APIRouter(prefix='/api/polls', tags=['polls'])


def _poll_to_out(poll: Poll, user_id: uuid.UUID) -> PollOut:
    user_voted_id: uuid.UUID | None = None
    options_out: list[PollOptionOut] = []
    for opt in poll.options:
        voted = any(v.user_id == user_id for v in opt.votes)
        if voted:
            user_voted_id = opt.id
        options_out.append(PollOptionOut(
            id=opt.id,
            text=opt.text,
            votes_count=len(opt.votes),
            voted=voted,
        ))
    return PollOut(
        id=poll.id,
        question=poll.question,
        options=options_out,
        user_voted_option_id=user_voted_id,
        total_votes=sum(len(opt.votes) for opt in poll.options),
    )


async def _load_poll(poll_id: uuid.UUID, db: AsyncSession) -> Poll:
    result = await db.execute(
        select(Poll)
        .where(Poll.id == poll_id)
        .options(
            selectinload(Poll.options).selectinload(PollOption.votes),
            selectinload(Poll.votes),
        )
    )
    poll = result.scalar_one_or_none()
    if not poll:
        raise HTTPException(status_code=404, detail='Poll not found')
    return poll


class VoteIn(BaseModel):
    option_id: uuid.UUID


@router.post('/{poll_id}/vote', response_model=PollOut)
async def vote(
    poll_id: uuid.UUID,
    body: VoteIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Сохраняем до commit — после commit сессия экспайрит user и обращение к user.id
    # вызовет lazy load в sync-контексте (MissingGreenlet)
    user_id = user.id

    poll = await _load_poll(poll_id, db)

    # Проверяем, что вариант принадлежит этому опросу
    option_ids = {opt.id for opt in poll.options}
    if body.option_id not in option_ids:
        raise HTTPException(status_code=400, detail='Option does not belong to this poll')

    # Проверяем, что пользователь — участник группы через сообщение
    from app.models.message import Message
    from app.models.group import Chat
    msg_result = await db.execute(select(Message).where(Message.id == poll.message_id))
    msg = msg_result.scalar_one_or_none()
    if msg:
        chat = await db.get(Chat, msg.chat_id)
        if chat:
            member = await db.execute(
                select(GroupMember).where(
                    GroupMember.group_id == chat.group_id,
                    GroupMember.user_id == user_id,
                )
            )
            if not member.scalar_one_or_none():
                raise HTTPException(status_code=403, detail='Not a member of this group')

    # Если уже голосовал — обновляем голос
    existing = await db.execute(
        select(PollVote).where(PollVote.poll_id == poll_id, PollVote.user_id == user_id)
    )
    existing_vote = existing.scalar_one_or_none()
    if existing_vote:
        existing_vote.option_id = body.option_id
    else:
        db.add(PollVote(poll_id=poll_id, option_id=body.option_id, user_id=user_id))

    await db.commit()
    poll = await _load_poll(poll_id, db)
    return _poll_to_out(poll, user_id)


@router.delete('/{poll_id}/vote', status_code=204)
async def unvote(
    poll_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    user_id = user.id  # сохраняем до commit
    result = await db.execute(
        select(PollVote).where(PollVote.poll_id == poll_id, PollVote.user_id == user_id)
    )
    vote = result.scalar_one_or_none()
    if vote:
        await db.delete(vote)
        await db.commit()
