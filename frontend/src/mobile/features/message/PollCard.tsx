// iOS `PollView` (Features/Chat/PollView.swift): card min(280, column), padding 8, bg --bg-input@40%, radius
// --radius, VStack(6): question 15/600 · option rows (bg --bg-input radius 6, padding 7×8, accent fill bar
// 18% / 35% when voted, checkmark.circle.fill before the voted text, absolute count 12 secondary) · footer
// "Голосов: N" 11 muted. Tap another option → vote; tap your option → retract.
// Data: pollsApi.vote → returned Poll replaces the message's poll (iOS `setPoll`); unvote (204) → local patch
// (iOS `ChatStore.unvote`). Both patch the ['messages', chatId] cache; if the message isn't in it (older page
// kept by the chat screen) the query is invalidated and `onPollChange` lets the owner patch its own copy.
import './message.css';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { pollsApi } from '../../../api/polls';
import type { Message, Poll } from '../../../types';
import { Icon } from '../../ui';
import { useMT } from '../../i18n';

export interface PollCardProps {
  poll: Poll;
  chatId: string;
  messageId: string;
  /** Called with the new poll after a vote / retract succeeded. */
  onPollChange?: (poll: Poll) => void;
}

function isVoted(poll: Poll, optId: string): boolean {
  const opt = poll.options.find((o) => o.id === optId);
  return poll.user_voted_option_id === optId || !!opt?.voted;
}

/** iOS ChatStore.unvote: decrement the voted option + total, clear the voted flag. */
export function retractLocally(poll: Poll): Poll {
  const votedId = poll.user_voted_option_id ?? poll.options.find((o) => o.voted)?.id ?? null;
  if (!votedId) return poll;
  return {
    ...poll,
    user_voted_option_id: null,
    total_votes: Math.max(0, poll.total_votes - 1),
    options: poll.options.map((o) => (o.id === votedId ? { ...o, voted: false, votes_count: Math.max(0, o.votes_count - 1) } : { ...o, voted: false })),
  };
}

export function PollCard({ poll, chatId, messageId, onPollChange }: PollCardProps) {
  const t = useMT();
  const qc = useQueryClient();
  const pending = useRef(false);
  const [, setBusy] = useState(false);

  const apply = (next: Poll) => {
    let found = false;
    qc.setQueryData<Message[]>(['messages', chatId], (old) => {
      if (!old) return old;
      return old.map((m) => {
        if (m.id !== messageId) return m;
        found = true;
        return { ...m, poll: next };
      });
    });
    if (!found) void qc.invalidateQueries({ queryKey: ['messages', chatId] });
    onPollChange?.(next);
  };

  const tap = (optId: string) => {
    if (pending.current) return; // ignore taps while a vote request is in flight (web guard)
    pending.current = true;
    setBusy(true);
    const done = () => {
      pending.current = false;
      setBusy(false);
    };
    if (isVoted(poll, optId)) {
      pollsApi
        .unvote(poll.id)
        .then(() => apply(retractLocally(poll)))
        .catch(() => {})
        .finally(done);
    } else {
      pollsApi
        .vote(poll.id, optId)
        .then((p) => apply(p))
        .catch(() => {})
        .finally(done);
    }
  };

  const total = poll.total_votes;
  return (
    <div className="m-msg-poll">
      <div className="m-msg-poll-q">{poll.question}</div>
      {poll.options.map((opt) => {
        const voted = isVoted(poll, opt.id);
        const fraction = total > 0 ? opt.votes_count / total : 0;
        return (
          <button
            key={opt.id}
            type="button"
            className={'m-msg-poll-opt' + (voted ? ' is-voted' : '')}
            onClick={(e) => {
              e.stopPropagation();
              tap(opt.id);
            }}
          >
            <span className="m-msg-poll-bar" style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }} aria-hidden />
            {voted ? <Icon name="checkmark.circle.fill" size={15} className="m-msg-poll-check" /> : null}
            <span className="m-msg-poll-text">{opt.text}</span>
            <span className="m-msg-poll-count">{opt.votes_count}</span>
          </button>
        );
      })}
      <div className="m-msg-poll-foot">{t('poll.votes', total)}</div>
    </div>
  );
}
