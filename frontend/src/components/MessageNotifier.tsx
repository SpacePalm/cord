// Слушает WS-события `message_created` и показывает содержательные browser-нотификации
// (и опционально звук). Решение фильтрации: уровень из настроек + mute отдельных чатов
// + @mention-детект по содержимому. Ничего не рендерит в DOM — чистый side-effect.

import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { onIncomingMessage, type IncomingMessageEvent } from '../hooks/useWebSocket';
import { pushRichToast } from '../hooks/useUnreadCounts';
import { useAuthStore } from '../store/authStore';
import { useSessionStore } from '../store/sessionStore';
import { useNotificationStore } from '../store/notificationStore';
import { playNotificationSound } from '../utils/notificationSound';
import type { Group, Chat } from '../types';

// Определяет, упомянут ли пользователь в тексте сообщения.
// Простой regex: @ + слово, границы — не буква/цифра/подчерк.
function containsMention(content: string | null | undefined, username: string): boolean {
  if (!content || !username) return false;
  const re = new RegExp(`(^|[^A-Za-z0-9_])@${username}(?![A-Za-z0-9_])`, 'i');
  return re.test(content);
}

function previewText(content: string | null | undefined, max = 120): string {
  if (!content) return '';
  const normalized = content.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? normalized.slice(0, max - 1) + '…' : normalized;
}

// Модуль-уровневый кэш обработанных message-id — защита от дубля уведомлений
// если подписка случайно зарегистрирована >1 раз (StrictMode в dev, накопления
// при HMR, или когда открыто несколько вкладок с тем же юзером). Храним последние 200.
const _seenMessageIds = new Set<string>();
const _seenOrder: string[] = [];
function _markSeen(id: string): boolean {
  if (_seenMessageIds.has(id)) return false;
  _seenMessageIds.add(id);
  _seenOrder.push(id);
  if (_seenOrder.length > 200) {
    const removed = _seenOrder.shift();
    if (removed) _seenMessageIds.delete(removed);
  }
  return true;
}

export function MessageNotifier() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.user);

  useEffect(() => {
    if (!me) return;

    return onIncomingMessage((event: IncomingMessageEvent) => {
      const msg = event.message;
      if (!me || msg.author_id === me.id) return;  // своё сообщение
      if (!_markSeen(msg.id)) return;  // уже обрабатывали этот id — дубль подписки

      // Свежие настройки (не из-замкнутого селектора, чтобы не пересоздавать подписку)
      const settings = useNotificationStore.getState();
      if (settings.level === 'off') return;
      if (!settings.browserEnabled) return;
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      if (settings.mutedChats[msg.chat_id]) return;

      // Определяем контекст: DM или обычный канал, через кэш React Query
      const groups = (queryClient.getQueryData<Group[]>(['groups']) ?? []) as Group[];
      const group = groups.find((g) => g.id === event.group_id);
      const isDm = !!group?.is_dm;
      const isPersonal = !!group?.is_personal;
      if (isPersonal) return;  // Saved Messages — никаких уведомлений

      const mentioned = containsMention(msg.content, me.username);

      // Применяем уровень
      if (settings.level === 'dm_only' && !isDm) return;
      if (settings.level === 'mentions_dm' && !isDm && !mentioned) return;
      // 'all' — всё что прошло выше

      // Не отвлекаем если этот чат уже открыт и вкладка в фокусе
      const session = useSessionStore.getState();
      const isOpenChat = session.lastChannelId === msg.chat_id;
      const tabActive = typeof document !== 'undefined' && document.hasFocus();
      if (isOpenChat && tabActive) return;

      // Заголовок: для DM — имя собеседника; для канала — «#name · Server»
      let title: string;
      const authorName = msg.author_display_name || msg.author_username || 'Unknown';
      if (isDm) {
        title = authorName;
      } else {
        // Имя канала — из кэша всех каналов группы
        const chats = (queryClient.getQueryData<Chat[]>(['chats', event.group_id]) ?? []) as Chat[];
        const chat = chats.find((c) => c.id === msg.chat_id);
        const chatName = chat ? `#${chat.name}` : '#channel';
        const groupName = group?.name || '';
        title = `${authorName} · ${chatName}${groupName ? ` · ${groupName}` : ''}`;
      }

      const preview = previewText(msg.content);
      const body = mentioned
        ? `✳ ${preview}`
        : preview || (msg.attachments?.length ? '📎 вложение' : '');

      // Хэлпер перехода в нужный чат (используется и из Notification, и из toast)
      const gotoChat = () => {
        useSessionStore.getState().setLastGroup(event.group_id);
        useSessionStore.getState().setLastChannel(msg.chat_id);
        if (isDm) useSessionStore.getState().setDmMode(true);
        if (location.pathname !== '/app') navigate('/app');
      };

      // ── Browser Notification (OS-level) — работает и когда вкладка неактивна
      try {
        const n = new Notification(title, {
          body,
          icon: msg.author_image_path || '/logo.png',
          tag: `msg-${msg.chat_id}`,
          requireInteraction: mentioned,
        });
        n.onclick = () => {
          window.focus();
          gotoChat();
          n.close();
        };
        setTimeout(() => n.close(), mentioned ? 60_000 : 10_000);
      } catch { /* quota/perm */ }

      // ── In-app toast (правый верхний угол) — работает даже когда ОС-нотификации
      //    запрещены или браузер их давит. Для полноты UX показываем всегда.
      pushRichToast({
        title,
        message: body || '...',
        avatar: msg.author_image_path || undefined,
        onClick: gotoChat,
      });

      if (settings.sound) playNotificationSound(settings.soundVolume);
    });
  }, [me, navigate, location.pathname, queryClient]);

  return null;
}
