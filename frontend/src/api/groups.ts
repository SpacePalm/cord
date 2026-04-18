import { api, postForm } from './client';
import type { Group, Chat, Member, InviteInfo } from '../types';

export const groupsApi = {
  /** Группы текущего пользователя */
  list: () => api.get<Group[]>('/groups'),
  create: (name: string) => api.post<Group>('/groups', { name }),
  delete: (groupId: string) => api.delete<void>(`/groups/${groupId}`),
  join: (groupId: string) => api.post<void>(`/groups/${groupId}/join`),
  leave: (groupId: string) => api.post<void>(`/groups/${groupId}/leave`),
  listChats: (groupId: string) => api.get<Chat[]>(`/groups/${groupId}/chats`),
  createChat: (groupId: string, name: string, type: 'text' | 'voice') =>
    api.post<Chat>(`/groups/${groupId}/chats`, { name, type }),

  deleteChat: (groupId: string, chatId: string) =>
    api.delete<void>(`/groups/${groupId}/chats/${chatId}`),

  getMembers: (groupId: string) => api.get<Member[]>(`/groups/${groupId}/members`),
  kickMember: (groupId: string, userId: string) => api.delete<void>(`/groups/${groupId}/members/${userId}`),
  update: (groupId: string, name: string) => api.patch<Group>(`/groups/${groupId}`, { name }),

  uploadAvatar: (groupId: string, file: File): Promise<Group> => {
    const form = new FormData();
    form.append('file', file);
    return postForm<Group>(`/groups/${groupId}/avatar`, form);
  },

  createInvite: (groupId: string) => api.post<InviteInfo>(`/groups/${groupId}/invite`),

  renameChat: (groupId: string, chatId: string, name: string) =>
    api.patch<Chat>(`/groups/${groupId}/chats/${chatId}`, { name }),

  getInvite: (code: string) => api.get<{ group_name: string; member_count: number }>(`/invite/${code}`),

  updateMemberRole: (groupId: string, userId: string, role: string) =>
    api.patch<void>(`/groups/${groupId}/members/${userId}/role?role=${role}`),

  joinByInvite: (code: string) => api.post<void>(`/invite/${code}/join`),
};
