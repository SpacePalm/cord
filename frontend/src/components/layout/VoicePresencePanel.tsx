// Показывается внизу ChannelSidebar когда ты подключён к голосовому каналу.

import { Signal, PhoneOff, Volume2 } from 'lucide-react';
import { useSessionStore } from '../../store/sessionStore';
import { useT } from '../../i18n';

export function VoicePresencePanel() {
  const t = useT();
  const presence = useSessionStore((s) => s.voicePresence);
  const leaveVoice = useSessionStore((s) => s.leaveVoice);

  if (!presence) return null;

  return (
    <div
      className="border-b border-[var(--border-color)] px-3 py-3"
      style={{ background: 'var(--bg-primary)' }}
    >
      {/* Верхняя строка: статус + кнопка выхода */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Signal size={14} className="text-green-400" />
          <span className="text-xs font-semibold text-green-400">{t('voice.connected')}</span>
        </div>
        <button
          onClick={leaveVoice}
          title={t('voice.leave')}
          className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-white/10 transition-colors"
        >
          <PhoneOff size={16} />
        </button>
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
