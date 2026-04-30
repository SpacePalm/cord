// API для глобального поиска пользователей и сообщений.
// Эндпоинты:
//   GET /api/users/search           — для секции «Люди» в палитре
//   GET /api/search/messages        — для палитры (простой) и расширенной модалки
//   GET /api/search/scope           — данные фильтров расширенного поиска

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
  chat_color?: string | null;
  group_id: string;
  group_name: string;
  author_id: string;
  author_username: string;
  author_display_name: string;
  author_image_path?: string | null;
  content: string | null;
  attachment_names: string[];
  has_image: boolean;
  has_file: boolean;
  has_voice: boolean;
  has_link: boolean;
  has_poll: boolean;
  is_pinned: boolean;
  is_edited: boolean;
  is_forwarded: boolean;
  created_at: string;
}

/** Все параметры расширенного поиска. Все опциональны. */
export interface MessageSearchParams {
  q?: string;
  limit?: number;
  offset?: number;            // Смещение от начала; 0 — первая страница
  group_ids?: string[];
  chat_ids?: string[];
  from_user_ids?: string[];
  before?: string;            // ISO date
  after?: string;
  has_image?: boolean;
  has_file?: boolean;
  has_link?: boolean;
  has_voice?: boolean;
  has_poll?: boolean;
  pinned_only?: boolean;
  is_edited?: boolean;
  is_forwarded?: boolean;
  mentions_me?: boolean;
  min_length?: number;
  max_length?: number;
  sort?: 'relevance' | 'newest' | 'oldest';
}

export interface ScopeChat {
  id: string;
  name: string;
  type: 'text' | 'voice';
  color?: string | null;
  group_id: string;
}

export interface ScopeGroup {
  id: string;
  name: string;
  is_personal: boolean;
  is_dm: boolean;
}

export interface ScopeUser {
  id: string;
  username: string;
  display_name: string;
  image_path?: string | null;
}

export interface ScopeOut {
  groups: ScopeGroup[];
  chats: ScopeChat[];
  members: ScopeUser[];
}

function buildSearchParams(p: MessageSearchParams): URLSearchParams {
  const sp = new URLSearchParams();
  if (p.q) sp.set('q', p.q);
  if (p.limit !== undefined) sp.set('limit', String(p.limit));
  if (p.offset !== undefined && p.offset > 0) sp.set('offset', String(p.offset));
  for (const id of p.group_ids ?? []) sp.append('group_ids', id);
  for (const id of p.chat_ids ?? []) sp.append('chat_ids', id);
  for (const id of p.from_user_ids ?? []) sp.append('from_user_ids', id);
  if (p.before) sp.set('before', p.before);
  if (p.after) sp.set('after', p.after);
  if (p.has_image) sp.set('has_image', 'true');
  if (p.has_file) sp.set('has_file', 'true');
  if (p.has_link) sp.set('has_link', 'true');
  if (p.has_voice) sp.set('has_voice', 'true');
  if (p.has_poll) sp.set('has_poll', 'true');
  if (p.pinned_only) sp.set('pinned_only', 'true');
  if (p.is_edited) sp.set('is_edited', 'true');
  if (p.is_forwarded) sp.set('is_forwarded', 'true');
  if (p.mentions_me) sp.set('mentions_me', 'true');
  if (p.min_length !== undefined) sp.set('min_length', String(p.min_length));
  if (p.max_length !== undefined) sp.set('max_length', String(p.max_length));
  if (p.sort) sp.set('sort', p.sort);
  return sp;
}

export const searchApi = {
  users: (q: string, limit = 20) =>
    api.get<UserShort[]>(`/users/search?q=${encodeURIComponent(q)}&limit=${limit}`),

  messages: (params: MessageSearchParams) => {
    const sp = buildSearchParams({ limit: 25, ...params });
    return api.get<GlobalMessageHit[]>(`/search/messages?${sp}`);
  },

  scope: () => api.get<ScopeOut>('/search/scope'),
};
