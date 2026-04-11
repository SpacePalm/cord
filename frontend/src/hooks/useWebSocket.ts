import { useEffect, useRef, useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Message } from '../types';
import type { UnreadData } from '../api/notifications';
import { useAuthStore } from '../store/authStore';
import { useSessionStore } from '../store/sessionStore';

interface WsMessageCreated {
  type: 'message_created';
  message: Message;
  group_id: string;
}

interface WsMessageEdited {
  type: 'message_edited';
  message: Message;
}

interface WsMessageDeleted {
  type: 'message_deleted';
  chat_id: string;
  message_id: string;
}

interface WsTyping {
  type: 'typing';
  chat_id: string;
  user_id: string;
  display_name: string;
}

interface WsVoiceParticipants {
  type: 'voice_participants';
  channel_id: string;
  participants: { identity: string; name: string; image_path: string }[];
}

type WsEvent = WsMessageCreated | WsMessageEdited | WsMessageDeleted | WsTyping | WsVoiceParticipants;

// Typing state — shared across components
const typingMap = new Map<string, Map<string, { name: string; timeout: ReturnType<typeof setTimeout> }>>();
const typingListeners = new Set<() => void>();

function notifyTypingListeners() {
  typingListeners.forEach((fn) => fn());
}

export function useTypingUsers(chatId: string): string[] {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((v) => v + 1);
    typingListeners.add(listener);
    return () => { typingListeners.delete(listener); };
  }, []);
  const users = typingMap.get(chatId);
  if (!users || users.size === 0) return [];
  return Array.from(users.values()).map((u) => u.name);
}

export function useCordWebSocket() {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const reconnectDelay = useRef(1000);

  const connect = useCallback(() => {
    const token = localStorage.getItem('access_token');
    if (!token) return;

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`, [`auth.${token}`]);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectDelay.current = 1000;
    };

    ws.onmessage = (ev) => {
      let event: WsEvent;
      try {
        event = JSON.parse(ev.data);
      } catch {
        return;
      }

      if (event.type === 'message_created') {
        const msg = event.message;
        queryClient.setQueryData<Message[]>(['messages', msg.chat_id], (old) => {
          if (!old) return old;
          if (old.some((m) => m.id === msg.id)) return old;
          return [...old, msg];
        });
        // Increment unread count — skip own messages and active chat
        const myId = useAuthStore.getState().user?.id;
        const activeChat = useSessionStore.getState().lastChannelId;
        if (msg.author_id !== myId && msg.chat_id !== activeChat) {
          queryClient.setQueryData<UnreadData>(['unread'], (old) => {
            if (!old) return old;
            const prev = old.unread[msg.chat_id];
            return {
              unread: {
                ...old.unread,
                [msg.chat_id]: {
                  count: (prev?.count ?? 0) + 1,
                  group_id: prev?.group_id ?? event.group_id,
                },
              },
            };
          });
        }
      }

      if (event.type === 'message_edited') {
        const msg = event.message;
        queryClient.setQueryData<Message[]>(['messages', msg.chat_id], (old) => {
          if (!old) return old;
          return old.map((m) => (m.id === msg.id ? msg : m));
        });
      }

      if (event.type === 'message_deleted') {
        queryClient.setQueryData<Message[]>(['messages', event.chat_id], (old) => {
          if (!old) return old;
          return old.filter((m) => m.id !== event.message_id);
        });
      }

      if (event.type === 'voice_participants') {
        queryClient.setQueryData(
          ['voice-participants', event.channel_id],
          event.participants,
        );
      }

      if (event.type === 'typing') {
        const chatId = event.chat_id;
        if (!typingMap.has(chatId)) typingMap.set(chatId, new Map());
        const users = typingMap.get(chatId)!;
        const existing = users.get(event.user_id);
        if (existing) clearTimeout(existing.timeout);
        users.set(event.user_id, {
          name: event.display_name,
          timeout: setTimeout(() => {
            users.delete(event.user_id);
            if (users.size === 0) typingMap.delete(chatId);
            notifyTypingListeners();
          }, 3000),
        });
        notifyTypingListeners();
      }
    };

    ws.onclose = (ev) => {
      wsRef.current = null;
      if (ev.code === 4001) return; // auth failure
      reconnectTimer.current = setTimeout(() => {
        reconnectDelay.current = Math.min(reconnectDelay.current * 2, 30000);
        connect();
      }, reconnectDelay.current);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [queryClient]);

  const reconnect = useCallback(() => {
    wsRef.current?.close();
  }, []);

  const sendTyping = useCallback((chatId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'typing', chat_id: chatId }));
    }
  }, []);

  useEffect(() => {
    // Даём время на загрузку страницы и авторизацию перед первым подключением
    const delay = setTimeout(connect, 1000);
    return () => {
      clearTimeout(delay);
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { reconnect, sendTyping };
}
