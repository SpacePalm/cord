import { api } from './client';

export interface VoiceToken {
  token: string;
  url: string;
  call_started_at: number;
}

export interface VoiceParticipantInfo {
  identity: string;
  name: string;
  image_path: string;
}

export const voiceApi = {
  getToken: (channelId: string) =>
    api.post<VoiceToken>(`/voice/token?channel_id=${channelId}`),

  listParticipants: (channelId: string) =>
    api.get<VoiceParticipantInfo[]>(`/voice/participants?channel_id=${channelId}`),

  leave: (channelId: string) =>
    api.post(`/voice/leave?channel_id=${channelId}`),
};
