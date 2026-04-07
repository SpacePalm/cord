import { api, postForm, postFormWithProgress } from './client';
import type { Message } from '../types';

export const messagesApi = {
  /** История сообщений с курсорной пагинацией */
  list: (chatId: string, before?: string, after?: string, limit = 50) => {
    const p = new URLSearchParams({ limit: String(limit) });
    if (before) p.set('before', before);
    if (after) p.set('after', after);
    return api.get<Message[]>(`/chats/${chatId}/messages?${p}`);
  },

  send: (
    chatId: string,
    content: string,
    files: File[],
    replyToId?: string,
    poll?: { question: string; options: string[] },
    onProgress?: (pct: number) => void,
  ): Promise<Message> => {
    const form = new FormData();
    if (content.trim()) form.append('content', content.trim());
    files.forEach((f) => form.append('files', f));
    if (replyToId) form.append('reply_to_id', replyToId);
    if (poll) {
      form.append('poll_question', poll.question);
      poll.options.forEach((o) => form.append('poll_options', o));
    }
    if (onProgress && files.length > 0) {
      return postFormWithProgress<Message>(`/chats/${chatId}/messages`, form, onProgress);
    }
    return postForm<Message>(`/chats/${chatId}/messages`, form);
  },

  forward: (targetChatId: string, sourceMessageId: string): Promise<Message> =>
    api.post<Message>(`/chats/${targetChatId}/messages/forward`, {
      source_message_id: sourceMessageId,
    }),

  edit: (chatId: string, messageId: string, content: string): Promise<Message> =>
    api.patch<Message>(`/chats/${chatId}/messages/${messageId}`, { content }),

  delete: (chatId: string, messageId: string): Promise<void> =>
    api.delete<void>(`/chats/${chatId}/messages/${messageId}`),

  search: (chatId: string, q: string, limit = 20) =>
    api.get<Message[]>(`/chats/${chatId}/messages/search?q=${encodeURIComponent(q)}&limit=${limit}`),

  media: (chatId: string, before?: string) => {
    const p = new URLSearchParams();
    if (before) p.set('before', before);
    return api.get<Message[]>(`/chats/${chatId}/media?${p}`);
  },

  links: (chatId: string, before?: string) => {
    const p = new URLSearchParams();
    if (before) p.set('before', before);
    return api.get<Message[]>(`/chats/${chatId}/links?${p}`);
  },
};
