// Оверлей входящего звонка: всплывает в правом нижнем углу при WS-событии
// incoming_call. Также стреляет browser Notification (если разрешено).
// "Принять" — присоединяется к voice-чату DM. "Отклонить" — просто закрывает.

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Phone, PhoneOff } from 'lucide-react';
import { onIncomingCall, onCallCancelled, type IncomingCallEvent } from '../hooks/useWebSocket';
import { useSessionStore } from '../store/sessionStore';
import { useNotificationStore } from '../store/notificationStore';
import { dmsApi, type DMItem } from '../api/dms';
import { startRingtone, stopRingtone } from '../utils/ringtone';
import { useT } from '../i18n';

// Дедуп входящих звонков по voice_chat_id — чтобы дубль подписки (StrictMode,
// HMR, несколько вкладок) не показывал оверлей и не дудел несколько раз.
const _seenCallIds = new Set<string>();
const _seenCallOrder: string[] = [];
function _markCallSeen(id: string): boolean {
  if (_seenCallIds.has(id)) return false;
  _seenCallIds.add(id);
  _seenCallOrder.push(id);
  if (_seenCallOrder.length > 50) {
    const rm = _seenCallOrder.shift();
    if (rm) _seenCallIds.delete(rm);
  }
  return true;
}

export function IncomingCallOverlay() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [call, setCall] = useState<IncomingCallEvent | null>(null);
  // Запоминаем запрошенное разрешение чтобы не дёргать пользователя повторно
  const permRequestedRef = useRef(false);

  // Определяем muted-статус для текущего звонка: в DMListPanel есть chat_id
  // text-чата этой группы, а mutedChats хранит ключи по chat_id.
  const dmChatIdForGroup = (group_id: string): string | undefined => {
    const dms = queryClient.getQueryData<DMItem[]>(['dms']) ?? [];
    return dms.find((d) => d.group_id === group_id)?.chat_id;
  };

  useEffect(() => {
    // Ленивый запрос разрешения при первом подключении — чтобы не спамить юзера
    // на холодном старте и только когда реально есть смысл (внутри авторизованной части).
    if (!permRequestedRef.current && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      permRequestedRef.current = true;
      Notification.requestPermission().catch(() => {});
    }

    // Если звонящий отменил до ответа — гасим рингтон и убираем оверлей.
    // Подписка живёт всё время пока компонент смонтирован.
    const offCancel = onCallCancelled((ev) => {
      setCall((current) => {
        if (current && current.group_id === ev.group_id) {
          stopRingtone();
          return null;
        }
        return current;
      });
    });

    const offIncoming = onIncomingCall((event) => {
      if (!_markCallSeen(event.voice_chat_id)) return;  // дубль
      setCall(event);

      // Учёт mute для DM этого звонка: если чат замьючен, подавляем звук
      // и browser Notification — но сам оверлей всё равно показываем,
      // чтобы пользователь мог принять решение.
      const dmChatId = dmChatIdForGroup(event.group_id);
      const settings = useNotificationStore.getState();
      const muted = dmChatId ? settings.mutedChats[dmChatId] === true : false;

      // Запуск ringtone (учитываем sound toggle и mute чата).
      // Отдельная громкость `ringtoneVolume` — звонок обычно хочется громче, чем beep сообщений.
      if (settings.sound && !muted) {
        startRingtone(settings.ringtoneVolume);
        // На всякий случай — авто-стоп через 30с, даже если пользователь ушёл
        setTimeout(stopRingtone, 30_000);
      }

      // Browser Notification — покажется даже в неактивной вкладке. Мьют подавляет.
      if (!muted && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          const n = new Notification(t('dms.incomingCall'), {
            body: event.caller.display_name || event.caller.username,
            icon: event.caller.image_path || '/logo.png',
            tag: `call-${event.voice_chat_id}`,
          });
          // Клик по уведомлению = принять
          n.onclick = () => {
            window.focus();
            accept(event);
            n.close();
          };
          // Автоматически закрыть через 30 сек — звонок «пропущен»
          setTimeout(() => n.close(), 30_000);
        } catch { /* quota/perm */ }
      }
    });

    return () => {
      offCancel();
      offIncoming();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const accept = (event: IncomingCallEvent) => {
    stopRingtone();
    const setLastGroup = useSessionStore.getState().setLastGroup;
    const setLastChannel = useSessionStore.getState().setLastChannel;
    const setDmMode = useSessionStore.getState().setDmMode;
    const joinVoice = useSessionStore.getState().joinVoice;

    setLastGroup(event.group_id);
    setDmMode(true);
    joinVoice(event.voice_chat_id, 'call', event.caller.display_name || event.caller.username, event.group_id);
    // text-chat id неизвестен (бэк шлёт только voice_chat_id). Выставим selection на voice chat
    // — fronted воспримет как «DM выбран», а далее при открытии список каналов DM подтянется.
    setLastChannel(event.voice_chat_id);
    if (location.pathname !== '/app') navigate('/app');
    setCall(null);
  };

  const dismiss = () => {
    stopRingtone();
    // Сообщаем инициатору об отмене: он получит WS `call_declined` и выйдет из LiveKit.
    if (call) dmsApi.declineCall(call.group_id).catch(() => {});
    setCall(null);
  };

  if (!call) return null;

  const name = call.caller.display_name || call.caller.username;
  const initials = name.slice(0, 2).toUpperCase();

  return createPortal(
    <div className="fixed bottom-4 right-4 z-[90] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl shadow-2xl px-4 py-3 flex items-center gap-3 min-w-[280px] animate-in">
      {call.caller.image_path ? (
        <img src={call.caller.image_path} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
      ) : (
        <div className="w-10 h-10 rounded-full bg-[var(--accent)] flex items-center justify-center text-white font-bold shrink-0">
          {initials}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{t('dms.incomingCall')}</p>
        <p className="text-sm font-medium text-[var(--text-primary)] truncate">{name}</p>
      </div>
      <button
        onClick={dismiss}
        className="w-9 h-9 rounded-full bg-[var(--danger)] text-white flex items-center justify-center hover:opacity-90 transition-opacity"
        title={t('dms.decline')}
      >
        <PhoneOff size={16} />
      </button>
      <button
        onClick={() => accept(call)}
        className="w-9 h-9 rounded-full bg-green-500 text-white flex items-center justify-center hover:opacity-90 transition-opacity"
        title={t('dms.accept')}
      >
        <Phone size={16} />
      </button>
    </div>,
    document.body,
  );
}
