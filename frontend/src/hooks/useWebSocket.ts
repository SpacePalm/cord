import { useEffect, useRef, useCallback } from 'react';
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

type WsEvent = WsMessageCreated | WsMessageEdited | WsMessageDeleted;

export function useCordWebSocket() {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const reconnectDelay = useRef(1000);

  const connect = useCallback(() => {
    const token = localStorage.getItem('access_token');
    if (!token) return;

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws?token=${token}`);
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

  useEffect(() => {
    // Даём время на загрузку страницы и авторизацию перед первым подключением
    const delay = setTimeout(connect, 1000);
    return () => {
      clearTimeout(delay);
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { reconnect };
}
