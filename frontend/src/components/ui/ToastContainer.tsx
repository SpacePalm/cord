import { X, MessageSquare } from 'lucide-react';
import type { ToastNotification } from '../../hooks/useUnreadCounts';
import { useT } from '../../i18n';

interface ToastContainerProps {
  toasts: ToastNotification[];
  onDismiss: (id: number) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  const t = useT();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none max-w-[360px]">
      {toasts.map((toast) => {
        const title = toast.title ?? t('notifications.newMessage');
        const handleClick = () => {
          toast.onClick?.();
          onDismiss(toast.id);
        };
        return (
          <div
            key={toast.id}
            onClick={toast.onClick ? handleClick : undefined}
            className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-lg shadow-xl border border-[var(--border-color)] animate-slide-in ${
              toast.onClick ? 'cursor-pointer hover:bg-[var(--bg-input)]' : ''
            }`}
            style={{ background: 'var(--bg-secondary)' }}
          >
            {/* Аватар отправителя или иконка-fallback */}
            {toast.avatar ? (
              <img src={toast.avatar} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
            ) : (
              <div className="w-9 h-9 rounded-full bg-[var(--accent)]/20 flex items-center justify-center shrink-0">
                <MessageSquare size={16} className="text-[var(--accent)]" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                {title}
              </p>
              <p className="text-xs text-[var(--text-muted)] line-clamp-2 break-words">
                {toast.message}
              </p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onDismiss(toast.id); }}
              className="p-1 rounded hover:bg-white/10 text-[var(--text-muted)] shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
