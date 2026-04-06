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
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-lg shadow-xl border border-[var(--border-color)] animate-slide-in"
          style={{ background: 'var(--bg-secondary)' }}
        >
          <div className="w-8 h-8 rounded-full bg-[var(--accent)]/20 flex items-center justify-center shrink-0">
            <MessageSquare size={16} className="text-[var(--accent)]" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {t('notifications.newMessage')}
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              {toast.message}
            </p>
          </div>
          <button
            onClick={() => onDismiss(toast.id)}
            className="p-1 rounded hover:bg-white/10 text-[var(--text-muted)] shrink-0"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
