import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface NotificationState {
  browserEnabled: boolean;
  setBrowserEnabled: (v: boolean) => void;
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set) => ({
      browserEnabled: false,
      setBrowserEnabled: (v) => set({ browserEnabled: v }),
    }),
    { name: 'cord-notifications' }
  )
);
