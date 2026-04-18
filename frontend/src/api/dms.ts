// API для Direct Messages.

import { api } from './client';

export interface DMPeer {
  id: string;
  username: string;
  display_name: string;
  image_path: string;
  // Выбранный статус: online/idle/dnd/invisible
  status: string;
  // Фактическое наличие в сети (heartbeat в Redis)
  is_online: boolean;
}

export interface DMItem {
  group_id: string;
  chat_id: string;
  peer: DMPeer;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
}

export interface DMOpenResponse {
  group_id: string;
  chat_id: string;
  peer: DMPeer;
  is_new: boolean;
}

export interface DMCallResponse {
  voice_chat_id: string;
  peer: DMPeer;
}

export const dmsApi = {
  list: () => api.get<DMItem[]>('/dms'),
  openWith: (userId: string) => api.post<DMOpenResponse>(`/dms/with/${userId}`, {}),
  initiateCall: (groupId: string) => api.post<DMCallResponse>(`/dms/${groupId}/call`, {}),
  declineCall: (groupId: string) => api.post<void>(`/dms/${groupId}/call/decline`, {}),
  cancelCall: (groupId: string) => api.post<void>(`/dms/${groupId}/call/cancel`, {}),
};
