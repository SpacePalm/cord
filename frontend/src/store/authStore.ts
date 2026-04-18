// Auth store. Zustand is like React useState, but global.
// Any component can call useAuthStore() and access user/token.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  token: string | null;
  setAuth: (user: User, token: string) => void;
  setUser: (user: User) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,

      setAuth: (user, token) => {
        localStorage.setItem('access_token', token);
        set({ user, token });
      },

      setUser: (user) => set({ user }),

      logout: () => {
        localStorage.removeItem('access_token');
        set({ user: null, token: null });
      },

      isAuthenticated: () => !!get().token,
    }),
    {
      name: 'cord-auth', // localStorage key
      partialize: (state) => ({ token: state.token, user: state.user }),
    }
  )
);
