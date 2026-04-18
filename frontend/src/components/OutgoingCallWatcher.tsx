// Сайд-эффект для инициатора звонка: слушает WS `call_declined` и:
//   1. Покидает LiveKit-комнату (leaveVoice)
//   2. Показывает тост «собеседник отклонил»

import { useEffect } from 'react';
import { onCallDeclined } from '../hooks/useWebSocket';
import { useSessionStore } from '../store/sessionStore';
import { pushRichToast } from '../hooks/useUnreadCounts';
import { useT } from '../i18n';

// Дедуп по group_id + timestamp — чтобы повторный event не триггерил повторные
// leaveVoice + toast. Один звонок = один decline, поэтому достаточно 5с окна.
const _recentDeclines = new Map<string, number>();
function _shouldHandleDecline(groupId: string): boolean {
  const now = Date.now();
  // Чистим устаревшие (>10s)
  for (const [k, ts] of _recentDeclines) {
    if (now - ts > 10_000) _recentDeclines.delete(k);
  }
  if (_recentDeclines.has(groupId)) return false;
  _recentDeclines.set(groupId, now);
  return true;
}

export function OutgoingCallWatcher() {
  const t = useT();

  useEffect(() => {
    return onCallDeclined((event) => {
      if (!_shouldHandleDecline(event.group_id)) return;
      const session = useSessionStore.getState();
      // Если я сейчас в звонке именно в этой DM-группе — выхожу из LiveKit
      if (session.voicePresence?.groupId === event.group_id) {
        session.leaveVoice();
      }
      // Покажем тост, чтобы было понятно что не просто молчание
      pushRichToast({
        title: event.decliner.display_name || event.decliner.username,
        message: t('dms.callDeclined'),
      });
    });
  }, [t]);

  return null;
}
