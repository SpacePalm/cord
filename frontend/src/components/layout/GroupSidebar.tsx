// Левый сайдбар: список серверов (групп) в виде кружочков, как в Discord

import { Plus, Shield, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import type { Group } from '../../types';
import { useT } from '../../i18n';

interface GroupSidebarProps {
  groups: Group[];
  selectedGroupId: string | null;
  onSelectGroup: (id: string) => void;
  onCreateGroup: () => void;
  unreadByGroup?: Record<string, number>;
}

function GroupIcon({ group, selected, onClick, unreadCount = 0 }: {
  group: Group;
  selected: boolean;
  onClick: () => void;
  unreadCount?: number;
}) {
  const hasImage = !!group.image_path;
  const initials = group.name.slice(0, 2).toUpperCase();

  return (
    <button
      onClick={onClick}
      title={group.name}
      className={`
        relative w-12 h-12 rounded-full flex items-center justify-center
        font-bold text-sm transition-all duration-150
        hover:rounded-2xl
        ${selected
          ? 'rounded-2xl bg-[var(--accent)] text-white'
          : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--accent)] hover:text-white'
        }
      `}
    >
      {hasImage ? (
        <img
          src={group.image_path}
          alt={group.name}
          className="w-full h-full rounded-[inherit] object-cover"
        />
      ) : (
        initials
      )}
      {/* Индикатор выбранного сервера */}
      {selected && (
        <span className="absolute -left-3 top-1/2 -translate-y-1/2 w-1 h-8 bg-white rounded-r-full" />
      )}
      {/* Бейдж непрочитанных */}
      {unreadCount > 0 && (
        <span className="absolute -bottom-0.5 -right-0.5 bg-[var(--danger)] text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  );
}

export function GroupSidebar({
  groups,
  selectedGroupId,
  onSelectGroup,
  onCreateGroup,
  unreadByGroup,
}: GroupSidebarProps) {
  const t = useT();
  const navigate = useNavigate();
  const userRole = useAuthStore((s) => s.user?.role);
  const logout = useAuthStore((s) => s.logout);

  return (
    <div
      className="w-[72px] flex flex-col items-center py-3 gap-2 overflow-y-auto"
      style={{ background: 'var(--bg-primary)' }}
    >
      {/* Logo */}
      <button
        className="w-12 h-12 rounded-full overflow-hidden hover:rounded-2xl transition-all shrink-0 bg-[var(--bg-tertiary)] flex items-center justify-center p-1.5"
        title={t('sidebar.cord')}
      >
        <img src="/logo.png" alt="Cord" className="w-full h-full object-contain" />
      </button>

      <div className="w-8 h-px bg-[var(--bg-secondary)] my-1" />

      {/* Список групп */}
      {groups.map((group) => (
        <GroupIcon
          key={group.id}
          group={group}
          selected={selectedGroupId === group.id}
          onClick={() => onSelectGroup(group.id)}
          unreadCount={unreadByGroup?.[group.id] ?? 0}
        />
      ))}

      {/* Кнопка создания сервера */}
      <button
        onClick={onCreateGroup}
        title={t('server.create')}
        className="w-12 h-12 rounded-full bg-[var(--bg-secondary)] flex items-center justify-center text-green-400 hover:bg-green-500 hover:text-white hover:rounded-2xl transition-all"
      >
        <Plus size={24} />
      </button>

      {/* Кнопка админ-панели — только для администраторов */}
      {userRole === 'admin' && (
        <>
          <div className="w-8 h-px bg-[var(--bg-secondary)] my-1" />
          <button
            onClick={() => navigate('/admin')}
            title={t('sidebar.admin')}
            className="w-12 h-12 rounded-full bg-[var(--bg-secondary)] flex items-center justify-center text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white hover:rounded-2xl transition-all"
          >
            <Shield size={20} />
          </button>
        </>
      )}

      {/* Spacer + кнопка выхода внизу */}
      <div className="mt-auto" />
      <div className="w-8 h-px bg-[var(--bg-secondary)] my-1" />
      <button
        onClick={logout}
        title={t('sidebar.logout')}
        className="w-12 h-12 rounded-full bg-[var(--bg-secondary)] flex items-center justify-center text-[var(--danger,#ef4444)] hover:bg-[var(--danger,#ef4444)] hover:text-white hover:rounded-2xl transition-all"
      >
        <LogOut size={20} />
      </button>
    </div>
  );
}
