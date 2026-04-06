import { api, postForm } from './client';
import type { User, AuthTokens } from '../types';

export interface LoginRequest {
  email: string;
  password: string;
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
};
