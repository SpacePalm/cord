// API для глобального поиска пользователей и сообщений (для CommandPalette).
// Эндпоинты: GET /api/users/search и GET /api/search/messages.

import { api } from './client';

export interface UserShort {
  id: string;
  username: string;
  display_name: string;
  image_path: string;
  status: string;
}

export interface GlobalMessageHit {
  id: string;
  chat_id: string;
  chat_name: string;
  group_id: string;
  group_name: string;
  author_id: string;
  author_display_name: string;
  content: string | null;
  created_at: string;
}

export const searchApi = {
  // Бэк клампит до 20 пользователей и 25 сообщений. Берём близко к максимуму —
  // в палитре по дефолту видно 5, остальное — по "Показать ещё" без новых запросов.
  users: (q: string, limit = 20) =>
    api.get<UserShort[]>(`/users/search?q=${encodeURIComponent(q)}&limit=${limit}`),

  messages: (q: string, limit = 25) =>
    api.get<GlobalMessageHit[]>(`/search/messages?q=${encodeURIComponent(q)}&limit=${limit}`),
};
