// API для админ-эндпоинтов fail2ban: настройки, лог попыток, IP-блоки, локи аккаунтов.

import { api } from './client';

export interface Fail2banSettings {
  enabled: boolean;
  attempts_per_ip: number;
  attempts_per_account: number;
  window_seconds: number;
  ip_block_seconds: number;
  account_lock_seconds: number;
  log_retention_days: number;
  ip_block_retention_days: number;
}

export type Fail2banSettingsPatch = Partial<Fail2banSettings>;

export interface AuthLogEntry {
  id: string;
  ip: string;
  username_attempted: string;
  success: boolean;
  user_agent: string | null;
  user_id: string | null;
  created_at: string;
}

export interface GroupedAttempt {
  username: string;
  count: number;
  last_at: string;
}

export interface GroupedIp {
  ip: string;
  total: number;
  failed: number;
  succeeded: number;
  distinct_users: number;
  last_at: string;
  is_blocked: boolean;
  block_expires_at: string | null;
  by_user: GroupedAttempt[];
}

export interface IpBlockEntry {
  ip: string;
  reason: string;
  expires_at: string | null;
  blocked_by: string;
  attempts_count: number;
  blocked_at: string;
}

export interface IpBlockCreate {
  ip: string;
  reason?: string;
  duration_seconds?: number | null;
}

export interface LockedUser {
  user_id: string;
  username: string;
  email: string;
  failed_attempts: number;
  last_failed_at: string | null;
  locked_until: string;
}

export const adminAuthApi = {
  getSettings: () => api.get<Fail2banSettings>('/admin/auth/settings'),
  updateSettings: (patch: Fail2banSettingsPatch) =>
    api.patch<Fail2banSettings>('/admin/auth/settings', patch),

  log: (params: { ip?: string; username?: string; success?: boolean; after?: string; before?: string; limit?: number; offset?: number }) => {
    const sp = new URLSearchParams();
    if (params.ip)        sp.set('ip', params.ip);
    if (params.username)  sp.set('username', params.username);
    if (params.success !== undefined) sp.set('success', String(params.success));
    if (params.after)     sp.set('after', params.after);
    if (params.before)    sp.set('before', params.before);
    if (params.limit !== undefined)  sp.set('limit', String(params.limit));
    if (params.offset !== undefined) sp.set('offset', String(params.offset));
    return api.get<AuthLogEntry[]>(`/admin/auth/log?${sp}`);
  },

  logGrouped: (params: { after?: string; limit?: number; offset?: number; q?: string } = {}) => {
    const sp = new URLSearchParams();
    if (params.after) sp.set('after', params.after);
    if (params.limit !== undefined)  sp.set('limit', String(params.limit));
    if (params.offset !== undefined) sp.set('offset', String(params.offset));
    if (params.q)                    sp.set('q', params.q);
    return api.get<GroupedIp[]>(`/admin/auth/log/grouped?${sp}`);
  },

  cleanupLog: () => api.post<{ deleted: number }>('/admin/auth/log/cleanup'),

  blocks: (onlyActive = true) =>
    api.get<IpBlockEntry[]>(`/admin/auth/blocks?only_active=${onlyActive}`),
  createBlock: (body: IpBlockCreate) => api.post<IpBlockEntry>('/admin/auth/blocks', body),
  deleteBlock: (ip: string) =>
    api.delete<void>(`/admin/auth/blocks/${encodeURIComponent(ip)}`),

  lockedUsers: () => api.get<LockedUser[]>('/admin/auth/locked-users'),
  unlockUser: (userId: string) =>
    api.delete<void>(`/admin/auth/locked-users/${userId}`),
};
