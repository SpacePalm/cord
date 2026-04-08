import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { notificationsApi } from '../api/notifications';
import { useNotificationStore } from '../store/notificationStore';
import { useSessionStore } from '../store/sessionStore';

export interface ToastNotification {
  id: number;
  message: string;
}

let toastId = 0;

export function useUnreadCounts() {
  const { data } = useQuery({
    queryKey: ['unread'],
    queryFn: notificationsApi.getUnread,
    staleTime: 60_000,
  });

  const prevDataRef = useRef<string>('');
  const initializedRef = useRef(false);
  const browserEnabled = useNotificationStore((s) => s.browserEnabled);
  const lastChannelId = useSessionStore((s) => s.lastChannelId);
  const [toasts, setToasts] = useState<ToastNotification[]>([]);

  const { unreadByChat, unreadByGroup } = useMemo(() => {
    const byChat: Record<string, number> = {};
    const byGroup: Record<string, number> = {};
    if (data?.unread) {
      for (const [chatId, info] of Object.entries(data.unread)) {
        byChat[chatId] = info.count;
        byGroup[info.group_id] = (byGroup[info.group_id] ?? 0) + info.count;
      }
    }
    return { unreadByChat: byChat, unreadByGroup: byGroup };
  }, [data]);

  // Баннер-уведомления
  useEffect(() => {
    const currentJson = JSON.stringify(data?.unread ?? {});

    if (!initializedRef.current) {
      initializedRef.current = true;
      prevDataRef.current = currentJson;
      return;
    }

    if (currentJson === prevDataRef.current) return;

    const prev: Record<string, { count: number }> = JSON.parse(prevDataRef.current || '{}');
    const curr = data?.unread ?? {};
    prevDataRef.current = currentJson;

    let newCount = 0;
    for (const [chatId, info] of Object.entries(curr)) {
      if (chatId === lastChannelId) continue;
      const prevCount = prev[chatId]?.count ?? 0;
      if (info.count > prevCount) {
        newCount += info.count - prevCount;
      }
    }

    if (newCount > 0) {
      // Browser notification (только когда вкладка не в фокусе)
      if (browserEnabled && Notification.permission === 'granted' && !document.hasFocus()) {
        new Notification('Cord', {
          body: `${newCount} new message${newCount > 1 ? 's' : ''}`,
          icon: '/favicon.ico',
        });
      }

      // Toast баннер (всегда)
      const id = ++toastId;
      setToasts((prev) => [...prev, { id, message: `+${newCount}` }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
    }
  }, [data, browserEnabled, lastChannelId]);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const queryClient = useQueryClient();
  const markRead = useCallback((chatId: string) => {
    notificationsApi.markRead(chatId).then(() => {
      queryClient.invalidateQueries({ queryKey: ['unread'] });
    }).catch(() => {});
  }, [queryClient]);

  return { unreadByChat, unreadByGroup, markRead, toasts, dismissToast };
}
