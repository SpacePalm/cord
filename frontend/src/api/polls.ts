import { api } from './client';
import type { Poll } from '../types';

export const pollsApi = {
  vote: (pollId: string, optionId: string): Promise<Poll> =>
    api.post<Poll>(`/polls/${pollId}/vote`, { option_id: optionId }),

  unvote: (pollId: string): Promise<void> =>
    api.delete<void>(`/polls/${pollId}/vote`),
};
