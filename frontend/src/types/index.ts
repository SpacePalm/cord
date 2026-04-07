export interface User {
  id: string;
  username: string;
  display_name: string;
  email: string;
  role: string;
  image_path: string;
  theme_json?: string | null;
}

export interface Group {
  id: string;
  name: string;
  owner_id: string;
  image_path: string;
  created_at: string;
}

export interface Chat {
  id: string;
  name: string;
  group_id: string;
  type: 'text' | 'voice';
  created_at: string;
}

export interface ReplyTo {
  message_id: string;
  author_display_name: string;
  content: string | null;
}

export interface ForwardedFrom {
  message_id: string;
  author_display_name: string;
  content: string | null;
  chat_name: string;
}

export interface PollOption {
  id: string;
  text: string;
  votes_count: number;
  voted: boolean;
}

export interface Poll {
  id: string;
  question: string;
  options: PollOption[];
  user_voted_option_id: string | null;
  total_votes: number;
}

export interface Message {
  id: string;
  content: string | null;
  author_id: string;
  author_username: string;
  author_display_name: string;
  author_image_path: string;
  chat_id: string;
  is_edited: boolean;
  created_at: string;
  updated_at: string;
  attachments: string[];
  forwarded_from: ForwardedFrom | null;
  reply_to: ReplyTo | null;
  poll: Poll | null;
}

export interface AuthTokens {
  access_token: string;
  token_type: string;
}

export interface Member {
  user_id: string;
  username: string;
  display_name: string;
  image_path: string;
  joined_at: string;
  is_online: boolean;
  role: string;
}

export interface InviteInfo {
  code: string;
  expires_at: string;
  url: string;
}
