import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useCallback, useMemo, useState } from 'react';
import { notificationsApi } from '../api/notifications';

export interface ToastNotification {
  id: number;
  /** Короткий идентификатор: «+N» (от unread-счётчика) */
  message: string;
  /** Имя отправителя для богатых тостов (опционально) */
  title?: string;
  /** URL аватара отправителя (опционально) */
  avatar?: string;
  /** Клик по тосту — колбэк перехода в чат */
  onClick?: () => void;
}

// Глобальный канал для push-а богатых тостов извне (из MessageNotifier'а).
// useUnreadCounts подписан и добавляет в свой state.
let toastId = 0;
const toastListeners = new Set<(t: ToastNotification) => void>();

export function pushRichToast(toast: Omit<ToastNotification, 'id'>): void {
  const full: ToastNotification = { id: ++toastId, ...toast };
  toastListeners.forEach((fn) => fn(full));
}

// ─── Mobile in-app banner channel (iOS InAppBannerView) ──────────────────
// The mobile shell (src/mobile) shows a single-slot top banner instead of the desktop toast stack.
// MessageNotifier pushes here only on phones (isMobileNow()); desktop never uses this channel.
export interface MobileBannerEvent {
  id: number;
  /** "author · server" (channel) or "author" (DM). */
  title: string;
  /** Preview text (or "📎 Attachment"), already cut/prefixed like iOS. */
  body: string;
  /** Author avatar path (or null → initials). */
  avatar: string | null;
  /** For the initials fallback. */
  authorName: string;
  chatId: string;
  groupId: string;
  /** Nav title of the chat opened by a tap (author for DMs, server name for channels — as iOS). */
  routeTitle: string;
}

let mobileBannerId = 0;
const mobileBannerListeners = new Set<(b: MobileBannerEvent) => void>();

export function pushMobileBanner(banner: Omit<MobileBannerEvent, 'id'>): void {
  const full: MobileBannerEvent = { id: ++mobileBannerId, ...banner };
  mobileBannerListeners.forEach((fn) => fn(full));
}

export function subscribeMobileBanners(fn: (b: MobileBannerEvent) => void): () => void {
  mobileBannerListeners.add(fn);
  return () => {
    mobileBannerListeners.delete(fn);
  };
}

export function useUnreadCounts() {
  const { data } = useQuery({
    queryKey: ['unread'],
    queryFn: notificationsApi.getUnread,
    staleTime: 60_000,
  });

  const [toasts, setToasts] = useState<ToastNotification[]>([]);

  // Подписка на богатые тосты от MessageNotifier.
  // Все решения «показывать/не показывать» и уровни/mute принимаются там —
  // сюда приходят только тосты, которые уже прошли фильтры настроек.
  useEffect(() => {
    const handler = (t: ToastNotification) => {
      setToasts((prev) => [...prev, t]);
      setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), 5000);
    };
    toastListeners.add(handler);
    return () => { toastListeners.delete(handler); };
  }, []);

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

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const queryClient = useQueryClient();
  const markRead = useCallback((chatId: string) => {
    notificationsApi.markRead(chatId).then(() => {
      queryClient.invalidateQueries({ queryKey: ['unread'] });
      // DM-список тоже держит unread_count — обновляем и его.
      queryClient.invalidateQueries({ queryKey: ['dms'] });
    }).catch(() => {});
  }, [queryClient]);

  return { unreadByChat, unreadByGroup, markRead, toasts, dismissToast };
}
