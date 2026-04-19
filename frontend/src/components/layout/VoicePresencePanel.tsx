// Показывается внизу ChannelSidebar / DMListPanel когда ты подключён к
// голосовому каналу. Отсюда можно:
//   - развернуть звонок на весь экран (onExpand — если передан и ты сейчас
//     смотришь другой канал);
//   - повесить трубку (leaveVoice + cancelCall для DM, чтобы у собеседника
//     перестал звонить рингтон).

import { Signal, PhoneOff, Volume2, Maximize2 } from 'lucide-react';
import { useSessionStore } from '../../store/sessionStore';
import { dmsApi } from '../../api/dms';
import { useT } from '../../i18n';

interface Props {
  onExpand?: () => void;
}

export function VoicePresencePanel({ onExpand }: Props = {}) {
  const t = useT();
  const presence = useSessionStore((s) => s.voicePresence);
  const lastChannelId = useSessionStore((s) => s.lastChannelId);
  const leaveVoice = useSessionStore((s) => s.leaveVoice);

  if (!presence) return null;

  const handleLeave = () => {
    // Для DM-звонков шлём cancel — у собеседника оверлей и рингтон остановятся.
    // Для обычных групповых голосовых endpoint ответит 404, молча игнор.
    dmsApi.cancelCall(presence.groupId).catch(() => {});
    leaveVoice();
  };

  // Кнопку «развернуть» показываем только если ты сейчас смотришь ДРУГОЙ канал,
  // иначе разворачивать нечего.
  const canExpand = onExpand && lastChannelId !== presence.channelId;

  return (
    <div
      className="border-b border-[var(--border-color)] px-3 py-3"
      style={{ background: 'var(--bg-primary)' }}
    >
      {/* Верхняя строка: статус + развернуть + выход */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Signal size={14} className="text-green-400 shrink-0" />
          <span className="text-xs font-semibold text-green-400 truncate">{t('voice.connected')}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {canExpand && (
            <button
              onClick={onExpand}
              title={t('voice.expand')}
              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 transition-colors"
            >
              <Maximize2 size={16} />
            </button>
          )}
          <button
            onClick={handleLeave}
            title={t('voice.leave')}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-white/10 transition-colors"
          >
            <PhoneOff size={16} />
          </button>
        </div>
      </div>

      {/* Название канала */}
      <div className="flex items-center gap-2 px-0.5">
        <Volume2 size={14} className="shrink-0 text-[var(--text-muted)]" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)] truncate">
            {presence.channelName}
          </p>
          <p className="text-[11px] text-[var(--text-muted)] truncate">
            {presence.groupName}
          </p>
        </div>
      </div>
    </div>
  );
}
