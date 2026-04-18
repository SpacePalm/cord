import { api } from './client';

export interface UnreadData {
  unread: Record<string, { count: number; group_id: string }>;
}

export const notificationsApi = {
  getUnread: () => api.get<UnreadData>('/chats/unread'),
  markRead: (chatId: string) => api.post<void>(`/chats/${chatId}/read`),
};
