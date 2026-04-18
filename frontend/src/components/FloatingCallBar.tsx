// Плавающая панель активного звонка — перетаскиваемая мышью, её можно переместить
// в любое место экрана. Позиция сохраняется в localStorage до следующего сеанса.
// Показывается когда voicePresence != null И пользователь смотрит другой канал/чат.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PhoneOff, Maximize2, Volume2, GripVertical } from 'lucide-react';
import { useSessionStore } from '../store/sessionStore';
import { dmsApi } from '../api/dms';
import { useT } from '../i18n';

interface Props {
  onExpand: () => void;
}

function useTicker(ms = 1000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((v) => v + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

const POSITION_KEY = 'cord:floating-call:pos';
const BAR_WIDTH = 300;  // минимальная ширина, для коррекции позиции при ресайзе окна

// Начальная позиция — нижний правый угол с отступом 16px, если ничего не сохранено.
function initialPosition(): { left: number; top: number } {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (typeof p.left === 'number' && typeof p.top === 'number') return p;
    }
  } catch { /* ignore */ }
  const left = Math.max(16, window.innerWidth - BAR_WIDTH - 16);
  const top = Math.max(16, window.innerHeight - 80);
  return { left, top };
}

export function FloatingCallBar({ onExpand }: Props) {
  const t = useT();
  const presence = useSessionStore((s) => s.voicePresence);
  const leaveVoice = useSessionStore((s) => s.leaveVoice);
  const callStartedAt = useSessionStore((s) => s.callStartedAt);
  useTicker(1000);

  const [pos, setPos] = useState(initialPosition);
  const dragRef = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // Поправить позицию, если окно отресайзили и бар ушёл за видимую часть
  useEffect(() => {
    const clamp = () => {
      setPos((p) => {
        const el = barRef.current;
        if (!el) return p;
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        return {
          left: Math.min(Math.max(4, p.left), window.innerWidth - w - 4),
          top: Math.min(Math.max(4, p.top), window.innerHeight - h - 4),
        };
      });
    };
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Не начинаем drag с кнопок — они должны кликаться нормально
    if ((e.target as HTMLElement).closest('button')) return;
    const el = barRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, moved: false };
    el.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.moved = true;
    const el = barRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    // Clamp в пределах окна с небольшим отступом
    const left = Math.min(Math.max(4, e.clientX - drag.dx), window.innerWidth - w - 4);
    const top = Math.min(Math.max(4, e.clientY - drag.dy), window.innerHeight - h - 4);
    setPos({ left, top });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) {
      try { localStorage.setItem(POSITION_KEY, JSON.stringify(pos)); } catch { /* quota */ }
    }
    dragRef.current = null;
    barRef.current?.releasePointerCapture(e.pointerId);
  };

  if (!presence) return null;

  const sec = callStartedAt ? Math.floor((Date.now() - callStartedAt) / 1000) : 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const timer = h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

  return createPortal(
    <div
      ref={barRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        touchAction: 'none',  // отключаем жесты прокрутки на тач-устройствах
        cursor: dragRef.current ? 'grabbing' : 'grab',
      }}
      className="z-[80] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl shadow-2xl pl-2 pr-3 py-2.5 flex items-center gap-2.5 min-w-[300px] max-w-[380px] select-none"
    >
      {/* Drag-хэндл — визуальная подсказка что можно тянуть */}
      <GripVertical size={14} className="text-[var(--text-muted)] shrink-0" />

      {/* Пульсирующая точка + иконка */}
      <div className="relative shrink-0">
        <div className="w-9 h-9 rounded-full bg-green-500/15 flex items-center justify-center">
          <Volume2 size={18} className="text-green-400" />
        </div>
        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-400 rounded-full animate-pulse" />
      </div>

      {/* Имя + таймер */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--text-primary)] truncate leading-tight">
          {presence.groupName}
        </p>
        <p className="text-[11px] text-[var(--text-muted)] truncate leading-tight tabular-nums">
          {t('voice.connected')} · {timer}
        </p>
      </div>

      {/* Развернуть */}
      <button
        onClick={onExpand}
        title={t('voice.expand')}
        className="w-8 h-8 rounded-full bg-[var(--bg-input)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/10 flex items-center justify-center transition-colors shrink-0"
      >
        <Maximize2 size={14} />
      </button>

      {/* Повесить трубку. Для DM сначала шлём cancel — второй стороне гасим
          оверлей и рингтон. Для обычных групповых звонков endpoint ответит 404,
          мы это молча проигнорируем. */}
      <button
        onClick={() => {
          if (presence) dmsApi.cancelCall(presence.groupId).catch(() => {});
          leaveVoice();
        }}
        title={t('voice.leave')}
        className="w-8 h-8 rounded-full bg-[var(--danger)] text-white hover:opacity-90 flex items-center justify-center shrink-0"
      >
        <PhoneOff size={14} />
      </button>
    </div>,
    document.body,
  );
}
