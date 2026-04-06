import { api, postForm } from './client';
import type { Group, Chat, Member, InviteInfo } from '../types';

export const groupsApi = {
  /** Группы текущего пользователя */
  list: () => api.get<Group[]>('/groups'),

  /** Создать группу */
  create: (name: string) => api.post<Group>('/groups', { name }),

  /** Удалить группу */
  delete: (groupId: string) => api.delete<void>(`/groups/${groupId}`),

  /** Вступить в группу */
  join: (groupId: string) => api.post<void>(`/groups/${groupId}/join`),

  /** Покинуть группу */
  leave: (groupId: string) => api.post<void>(`/groups/${groupId}/leave`),

  /** Каналы группы */
  listChats: (groupId: string) => api.get<Chat[]>(`/groups/${groupId}/chats`),

  /** Создать канал */
  createChat: (groupId: string, name: string, type: 'text' | 'voice') =>
    api.post<Chat>(`/groups/${groupId}/chats`, { name, type }),

  /** Удалить канал */
  deleteChat: (groupId: string, chatId: string) =>
    api.delete<void>(`/groups/${groupId}/chats/${chatId}`),

  /** Участники группы */
  getMembers: (groupId: string) => api.get<Member[]>(`/groups/${groupId}/members`),

  /** Кикнуть участника */
  kickMember: (groupId: string, userId: string) => api.delete<void>(`/groups/${groupId}/members/${userId}`),

  /** Обновить название */
  update: (groupId: string, name: string) => api.patch<Group>(`/groups/${groupId}`, { name }),

  /** Загрузить аватарку группы */
  uploadAvatar: (groupId: string, file: File): Promise<Group> => {
    const form = new FormData();
    form.append('file', file);
    return postForm<Group>(`/groups/${groupId}/avatar`, form);
  },

  /** Создать/обновить инвайт */
  createInvite: (groupId: string) => api.post<InviteInfo>(`/groups/${groupId}/invite`),

  /** Переименовать канал */
  renameChat: (groupId: string, chatId: string, name: string) =>
    api.patch<Chat>(`/groups/${groupId}/chats/${chatId}`, { name }),

  /** Инфо об инвайте (публично) */
  getInvite: (code: string) => api.get<{ group_name: string; member_count: number }>(`/invite/${code}`),

  /** Обновить роль участника */
  updateMemberRole: (groupId: string, userId: string, role: string) =>
    api.patch<void>(`/groups/${groupId}/members/${userId}/role?role=${role}`),

  /** Вступить по инвайту */
  joinByInvite: (code: string) => api.post<void>(`/invite/${code}/join`),
};
