import { useEffect, useRef, useCallback, useState, createContext, useContext, type ReactNode } from 'react';
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

interface WsStopTyping {
  type: 'stop_typing';
  chat_id: string;
  user_id: string;
}

interface WsVoiceParticipants {
  type: 'voice_participants';
  channel_id: string;
  participants: { identity: string; name: string; image_path: string }[];
}

interface WsIncomingCall {
  type: 'incoming_call';
  group_id: string;
  voice_chat_id: string;
  caller: {
    id: string;
    username: string;
    display_name: string;
    image_path: string;
  };
}

interface WsCallDeclined {
  type: 'call_declined';
  group_id: string;
  decliner: {
    id: string;
    username: string;
    display_name: string;
  };
}

interface WsCallCancelled {
  type: 'call_cancelled';
  group_id: string;
  caller: {
    id: string;
    username: string;
    display_name: string;
  };
}

type WsEvent = WsMessageCreated | WsMessageEdited | WsMessageDeleted | WsTyping | WsStopTyping | WsVoiceParticipants | WsIncomingCall | WsCallDeclined | WsCallCancelled;

// Fallback-таймаут: если пришёл typing, но stop_typing потерян (disconnect, замедление сети),
// всё равно снимаем индикатор. 6 секунд = 4с бездействия на отправителе + запас на задержку сети.
const TYPING_FALLBACK_MS = 6000;

// Typing state — shared across components
const typingMap = new Map<string, Map<string, { name: string; timeout: ReturnType<typeof setTimeout> }>>();
const typingListeners = new Set<() => void>();

// Подписчики на входящие звонки — для показа браузерных уведомлений и UI-оповещений.
export type IncomingCallEvent = WsIncomingCall;
const incomingCallListeners = new Set<(e: IncomingCallEvent) => void>();

export function onIncomingCall(fn: (e: IncomingCallEvent) => void): () => void {
  incomingCallListeners.add(fn);
  return () => { incomingCallListeners.delete(fn); };
}

// Подписчики на новые сообщения — для push/sound уведомлений.
export type IncomingMessageEvent = WsMessageCreated;
const incomingMessageListeners = new Set<(e: IncomingMessageEvent) => void>();

export function onIncomingMessage(fn: (e: IncomingMessageEvent) => void): () => void {
  incomingMessageListeners.add(fn);
  return () => { incomingMessageListeners.delete(fn); };
}

// Подписчики на «звонок отклонён» — инициатору приходит когда собеседник нажал отмену.
export type CallDeclinedEvent = WsCallDeclined;
const callDeclinedListeners = new Set<(e: CallDeclinedEvent) => void>();

export function onCallDeclined(fn: (e: CallDeclinedEvent) => void): () => void {
  callDeclinedListeners.add(fn);
  return () => { callDeclinedListeners.delete(fn); };
}

// Подписчики на «звонок отменён» — callee'у приходит, когда инициатор повесил
// трубку до того как ответили. Оверлей должен закрыться, рингтон — прекратиться.
export type CallCancelledEvent = WsCallCancelled;
const callCancelledListeners = new Set<(e: CallCancelledEvent) => void>();

export function onCallCancelled(fn: (e: CallCancelledEvent) => void): () => void {
  callCancelledListeners.add(fn);
  return () => { callCancelledListeners.delete(fn); };
}

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
        // Уведомляем подписчиков (MessageNotifier) — они сами отфильтруют по настройкам
        incomingMessageListeners.forEach((fn) => fn(event));
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
          const existing = queryClient.getQueryData<UnreadData>(['unread']);
          if (existing) {
            // Оптимистичный апдейт — кэш есть, просто инкрементим счётчик чата.
            const prev = existing.unread[msg.chat_id];
            queryClient.setQueryData<UnreadData>(['unread'], {
              unread: {
                ...existing.unread,
                [msg.chat_id]: {
                  count: (prev?.count ?? 0) + 1,
                  group_id: prev?.group_id ?? event.group_id,
                },
              },
            });
          } else {
            // Кэша нет (только залогинились / unread пуст) — форсим рефетч с сервера.
            queryClient.invalidateQueries({ queryKey: ['unread'] });
          }
          // Инвалидируем список DM — там свой счётчик unread_count + last_message
          // + сортировка по времени последнего сообщения. Пересчитывать вручную
          // накладно (нужны данные о is_dm, peer и т.д.), проще форснуть refetch.
          queryClient.invalidateQueries({ queryKey: ['dms'] });
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
          }, TYPING_FALLBACK_MS),
        });
        notifyTypingListeners();
      }

      if (event.type === 'stop_typing') {
        const users = typingMap.get(event.chat_id);
        if (!users) return;
        const existing = users.get(event.user_id);
        if (existing) clearTimeout(existing.timeout);
        users.delete(event.user_id);
        if (users.size === 0) typingMap.delete(event.chat_id);
        notifyTypingListeners();
      }

      if (event.type === 'incoming_call') {
        incomingCallListeners.forEach((fn) => fn(event));
      }

      if (event.type === 'call_declined') {
        callDeclinedListeners.forEach((fn) => fn(event));
      }

      if (event.type === 'call_cancelled') {
        callCancelledListeners.forEach((fn) => fn(event));
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

  const sendStopTyping = useCallback((chatId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'stop_typing', chat_id: chatId }));
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

  return { reconnect, sendTyping, sendStopTyping };
}

// ─── Context so WS lives at App level, pages consume via hook ──────

interface WsContextValue {
  reconnect: () => void;
  sendTyping: (chatId: string) => void;
  sendStopTyping: (chatId: string) => void;
}

const WsContext = createContext<WsContextValue>({
  reconnect: () => {},
  sendTyping: () => {},
  sendStopTyping: () => {},
});

export function CordWebSocketProvider({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.token);
  const value = useCordWebSocket();

  // Don't connect if not authenticated
  if (!token) return <>{children}</>;

  return <WsContext.Provider value={value}>{children}</WsContext.Provider>;
}

export function useWs() {
  return useContext(WsContext);
}
