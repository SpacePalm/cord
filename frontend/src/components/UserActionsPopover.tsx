// Универсальный поповер действий над пользователем.
// Используется на аватарах/именах в сообщениях, списках участников групп,
// голосовой комнате. Два ключевых действия: «Открыть чат» (DM) и «Позвонить».
//
// Мой собственный аватар меню не открывает — клик игнорируется.

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { MessageSquare, Phone } from 'lucide-react';
import { dmsApi } from '../api/dms';
import { useAuthStore } from '../store/authStore';
import { useSessionStore } from '../store/sessionStore';
import { useT } from '../i18n';

export interface PopoverUser {
  id: string;
  username: string;
  display_name: string;
  image_path?: string;
}

interface Props {
  user: PopoverUser;
  x: number;
  y: number;
  onClose: () => void;
}

export function UserActionsPopover({ user, x, y, onClose }: Props) {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ position: 'fixed', left: x, top: y, opacity: 0 });
  const [busy, setBusy] = useState(false);

  // Автофлип внутрь viewport: если элемент вылезет за правый/нижний край — сдвигаем
  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    const left = x + w > window.innerWidth - 4 ? Math.max(4, window.innerWidth - w - 4) : x;
    const top = y + h > window.innerHeight - 4 ? Math.max(4, y - h) : y;
    setStyle({ position: 'fixed', left, top, opacity: 1 });
  }, [x, y]);

  // Закрытие по клику вне и Esc
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);

  const goToApp = () => {
    if (location.pathname !== '/app') navigate('/app');
  };

  const openDM = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const dm = await dmsApi.openWith(user.id);
      useSessionStore.getState().setLastGroup(dm.group_id);
      useSessionStore.getState().setLastChannel(dm.chat_id);
      useSessionStore.getState().setDmMode(true);
      goToApp();
    } finally {
      onClose();
    }
  };

  const startCall = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const dm = await dmsApi.openWith(user.id);
      const call = await dmsApi.initiateCall(dm.group_id);
      useSessionStore.getState().setLastGroup(dm.group_id);
      useSessionStore.getState().setLastChannel(dm.chat_id);
      useSessionStore.getState().setDmMode(true);
      const label = dm.peer.display_name || dm.peer.username;
      useSessionStore.getState().joinVoice(call.voice_chat_id, 'call', `DM: ${label}`, dm.group_id);
      goToApp();
    } finally {
      onClose();
    }
  };

  const initials = (user.display_name || user.username).slice(0, 2).toUpperCase();
  const itemCls = 'flex items-center gap-2.5 w-full px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-white/10 hover:text-[var(--text-primary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

  return createPortal(
    <div
      ref={ref}
      style={style}
      className="min-w-[220px] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-xl z-[95] py-1"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Шапка с аватаркой и именем */}
      <div className="flex items-center gap-2.5 px-3 py-2 border-b border-[var(--border-color)]">
        {user.image_path ? (
          <img src={user.image_path} alt="" className="w-8 h-8 rounded-full object-cover" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-[var(--accent)] flex items-center justify-center text-white text-xs font-bold">
            {initials}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)] truncate">
            {user.display_name || user.username}
          </p>
          <p className="text-xs text-[var(--text-muted)] truncate">@{user.username}</p>
        </div>
      </div>

      <button onClick={openDM} disabled={busy} className={itemCls}>
        <MessageSquare size={15} />
        {t('user.openChat')}
      </button>
      <button onClick={startCall} disabled={busy} className={itemCls}>
        <Phone size={15} />
        {t('user.startCall')}
      </button>
    </div>,
    document.body,
  );
}

/**
 * Хук-обёртка: хранит состояние текущего открытого поповера и возвращает
 * обработчик клика + элемент для рендеринга. Используется в компонентах,
 * которые отрисовывают несколько юзеров (список участников, сообщения).
 */
export function useUserActionsPopover() {
  const [state, setState] = useState<{ user: PopoverUser; x: number; y: number } | null>(null);
  const currentUserId = useAuthStore((s) => s.user?.id);

  const openAt = (user: PopoverUser, e: React.MouseEvent) => {
    // Не открываем меню на себе — зачем писать себе и звонить?
    if (user.id === currentUserId) return;
    e.stopPropagation();
    setState({ user, x: e.clientX, y: e.clientY });
  };

  const element = state ? (
    <UserActionsPopover
      user={state.user}
      x={state.x}
      y={state.y}
      onClose={() => setState(null)}
    />
  ) : null;

  return { openAt, element };
}
