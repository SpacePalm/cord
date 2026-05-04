import { api, postForm } from './client';
import type { User, AuthTokens } from '../types';

export interface LoginRequest {
  email: string;
  password: string;
}

export interface SessionInfo {
  id: string;
  user_agent: string;
  ip: string | null;
  created_at: string;
  last_used_at: string;
  expires_at: string;
  is_current: boolean;
}

export interface RefreshResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
}

export interface ProfileUpdateRequest {
  display_name?: string;
  email?: string;
  current_password?: string;
  new_password?: string;
}

export const authApi = {
  login: (data: LoginRequest) =>
    api.post<AuthTokens>('/auth/login', data),

  register: (data: RegisterRequest) =>
    api.post<{ id: string; username: string; email: string }>('/auth/register', data),

  me: () =>
    api.get<User>('/auth/me'),

  updateProfile: (data: ProfileUpdateRequest) =>
    api.patch<User>('/auth/profile', data),

  uploadAvatar: (file: File): Promise<User> => {
    const form = new FormData();
    form.append('file', file);
    return postForm<User>('/auth/avatar', form);
  },

  heartbeat: () =>
    api.post<{ ok: boolean }>('/auth/heartbeat'),

  updateStatus: (status: string, statusText?: string | null) =>
    api.put<User>('/auth/status', { status, status_text: statusText }),

  saveTheme: (theme: unknown) =>
    api.put<{ ok: boolean }>('/auth/theme', theme),

  savePreferences: (prefs: unknown) =>
    api.put<{ ok: boolean }>('/auth/preferences', prefs),

  // Refresh не использует обычный api.post — нужен особый путь без auto-refresh-цикла
  refresh: async (refresh_token: string): Promise<RefreshResponse> => {
    const r = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token }),
    });
    if (!r.ok) throw new Error(`Refresh failed: ${r.status}`);
    return r.json();
  },

  // Logout без access — позволяет вылогиниться даже с истёкшим JWT
  logoutOnServer: async (refresh_token: string): Promise<void> => {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token }),
    });
  },

  listSessions: () => api.get<SessionInfo[]>('/auth/sessions'),
  revokeSession: (id: string) => api.delete<void>(`/auth/sessions/${id}`),
  revokeOtherSessions: () => api.delete<void>('/auth/sessions'),
};
