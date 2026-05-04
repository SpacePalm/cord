// Auth store. Zustand is like React useState, but global.
// Any component can call useAuthStore() and access user/token.
//
// С 1.1: токенов теперь два.
// - access_token (15 мин, JWT) — носим в Authorization header
// - refresh_token (30 дней, opaque) — храним и обмениваем на новую пару при 401
//
// localStorage и в-памяти state синхронизированы вручную, потому что client.ts
// читает токены из localStorage напрямую (он не подписан на store).

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  token: string | null;          // access_token, для совместимости с существующим кодом
  refreshToken: string | null;
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;  // после refresh
  setUser: (user: User) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      refreshToken: null,

      setAuth: (user, accessToken, refreshToken) => {
        localStorage.setItem('access_token', accessToken);
        localStorage.setItem('refresh_token', refreshToken);
        set({ user, token: accessToken, refreshToken });
      },

      setTokens: (accessToken, refreshToken) => {
        localStorage.setItem('access_token', accessToken);
        localStorage.setItem('refresh_token', refreshToken);
        set({ token: accessToken, refreshToken });
      },

      setUser: (user) => set({ user }),

      logout: () => {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        set({ user: null, token: null, refreshToken: null });
      },

      isAuthenticated: () => !!get().token,
    }),
    {
      name: 'cord-auth',
      partialize: (state) => ({
        token: state.token,
        refreshToken: state.refreshToken,
        user: state.user,
      }),
    }
  )
);
