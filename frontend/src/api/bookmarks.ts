import { api } from './client';
import type { Message } from '../types';

export interface BookmarkChatInfo {
  id: string;
  name: string;
  group_id: string;
}

export interface Bookmark {
  bookmarked_at: string;
  message: Message;
  chat: BookmarkChatInfo;
}

export const bookmarksApi = {
  add: (messageId: string) => api.post<void>(`/messages/${messageId}/bookmark`),
  remove: (messageId: string) => api.delete<void>(`/messages/${messageId}/bookmark`),

  /** Глобальный список закладок пользователя в обратном хронологическом порядке. */
  listMine: (before?: string, limit = 30) => {
    const p = new URLSearchParams({ limit: String(limit) });
    if (before) p.set('before', before);
    return api.get<Bookmark[]>(`/me/bookmarks?${p}`);
  },

  /** ID сообщений, которые лежат в закладках пользователя в данном чате. */
  inChat: (chatId: string) => api.get<string[]>(`/chats/${chatId}/bookmarks`),
};
