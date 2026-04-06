import { api } from './client';

export interface AdminUser {
  id: string;
  username: string;
  display_name: string;
  email: string;
  role: string;
  is_active: boolean;
  image_path: string;
  created_at: string;
}

export interface AdminGroup {
  id: string;
  name: string;
  owner_id: string;
  owner_username: string;
  image_path: string;
  member_count: number;
  channel_count: number;
  created_at: string;
}

export interface AdminMember {
  user_id: string;
  username: string;
  display_name: string;
  image_path: string;
  joined_at: string;
}

export interface AppSettings {
  registration_enabled: boolean;
}

export interface DiskStats {
  disk: {
    total_bytes: number;
    avatars_bytes: number;
    group_avatars_bytes: number;
    message_files_bytes: number;
  };
  db: {
    users: number;
    groups: number;
    messages: number;
    attachments: number;
  };
}

export const adminApi = {
  getSettings: () => api.get<AppSettings>('/admin/settings'),
  updateSettings: (data: Partial<AppSettings>) =>
    api.patch<AppSettings>('/admin/settings', data),

  getUsers: (q?: string) =>
    api.get<AdminUser[]>(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  updateUser: (userId: string, data: { role?: string; is_active?: boolean }) =>
    api.patch<AdminUser>(`/admin/users/${userId}`, data),
  deleteUser: (userId: string) => api.delete<void>(`/admin/users/${userId}`),

  getGroups: () => api.get<AdminGroup[]>('/admin/groups'),
  deleteGroup: (groupId: string) => api.delete<void>(`/admin/groups/${groupId}`),
  getGroupMembers: (groupId: string) =>
    api.get<AdminMember[]>(`/admin/groups/${groupId}/members`),
  kickGroupMember: (groupId: string, userId: string) =>
    api.delete<void>(`/admin/groups/${groupId}/members/${userId}`),

  getStats: () => api.get<DiskStats>('/admin/stats'),
  cleanupMessages: (days: number) =>
    api.post<{ deleted: number }>('/admin/cleanup/messages', { days }),
  cleanupAttachments: () =>
    api.post<{ deleted: number }>('/admin/cleanup/attachments', {}),
};
