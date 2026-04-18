import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Уровень нотификаций:
 *  - 'all' — показывать всё новое (DM, упоминания, обычные сообщения)
 *  - 'mentions_dm' — только DM и @упоминания в обычных чатах
 *  - 'dm_only' — только DM
 *  - 'off' — ничего
 */
export type NotificationLevel = 'all' | 'mentions_dm' | 'dm_only' | 'off';

interface NotificationState {
  // Включены ли browser-нотификации в принципе (permission granted + user opted-in)
  browserEnabled: boolean;
  setBrowserEnabled: (v: boolean) => void;

  level: NotificationLevel;
  setLevel: (v: NotificationLevel) => void;

  // Звук при уведомлении
  sound: boolean;
  setSound: (v: boolean) => void;

  // Громкость beep'а уведомлений, 0..1
  soundVolume: number;
  setSoundVolume: (v: number) => void;

  // Громкость гудков входящего звонка, 0..1 — отдельно от beep'а,
  // т.к. звонок обычно хочется слышать громче.
  ringtoneVolume: number;
  setRingtoneVolume: (v: number) => void;

  // Индивидуальный mute по чатам: chat_id → true
  mutedChats: Record<string, boolean>;
  toggleChatMute: (chatId: string) => void;
  isChatMuted: (chatId: string) => boolean;
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set, get) => ({
      browserEnabled: false,
      setBrowserEnabled: (v) => set({ browserEnabled: v }),

      level: 'mentions_dm',  // разумный дефолт: не спамим каждым сообщением
      setLevel: (v) => set({ level: v }),

      sound: true,
      setSound: (v) => set({ sound: v }),

      soundVolume: 0.6,
      setSoundVolume: (v) => set({ soundVolume: Math.max(0, Math.min(1, v)) }),

      ringtoneVolume: 0.8,
      setRingtoneVolume: (v) => set({ ringtoneVolume: Math.max(0, Math.min(1, v)) }),

      mutedChats: {},
      toggleChatMute: (chatId) =>
        set((s) => {
          const next = { ...s.mutedChats };
          if (next[chatId]) delete next[chatId];
          else next[chatId] = true;
          return { mutedChats: next };
        }),
      isChatMuted: (chatId) => !!get().mutedChats[chatId],
    }),
    { name: 'cord-notifications' }
  )
);
