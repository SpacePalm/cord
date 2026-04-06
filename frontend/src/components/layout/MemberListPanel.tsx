// Group member list panel with online status.
// Online = heartbeat within the last 2 min.

import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { groupsApi } from '../../api/groups';
import type { Member } from '../../types';
import { useT } from '../../i18n';

interface MemberListPanelProps {
  groupId: string;
  onClose: () => void;
}

export function MemberListPanel({ groupId, onClose }: MemberListPanelProps) {
  const t = useT();
  const { data: members } = useQuery<Member[]>({
    queryKey: ['group-members', groupId],
    queryFn: () => groupsApi.getMembers(groupId),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const memberList = members ?? [];
  const online = memberList.filter((m) => m.is_online);
  const offline = memberList.filter((m) => !m.is_online);

  return (
    <div className="w-60 border-l border-[var(--border-color)] bg-[var(--bg-secondary)] flex flex-col shrink-0">
      {/* Header */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-[var(--border-color)] shrink-0">
        <span className="text-sm font-semibold text-[var(--text-primary)]">{t('members')}</span>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 py-3">
        {online.length > 0 && (
          <div className="mb-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] px-2 mb-1">
              {t('members.online')} — {online.length}
            </p>
            {online.map((m) => (
              <MemberItem key={m.user_id} member={m} online />
            ))}
          </div>
        )}

        {offline.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] px-2 mb-1">
              {t('members.offline')} — {offline.length}
            </p>
            {offline.map((m) => (
              <MemberItem key={m.user_id} member={m} online={false} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MemberItem({ member, online }: { member: Member; online: boolean }) {
  const initials = (member.display_name || member.username).slice(0, 2).toUpperCase();

  return (
    <div className={`flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/5 transition-colors ${!online ? 'opacity-40' : ''}`}>
      <div className="relative shrink-0">
        {member.image_path ? (
          <img src={member.image_path} alt="" className="w-8 h-8 rounded-full object-cover" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-[var(--accent)] flex items-center justify-center text-white text-xs font-bold">
            {initials}
          </div>
        )}
        <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[var(--bg-secondary)] ${online ? 'bg-green-500' : 'bg-gray-500'}`} />
      </div>

      <div className="min-w-0">
        <p className="text-sm text-[var(--text-primary)] truncate leading-tight">
          {member.display_name}
        </p>
        <p className="text-[11px] text-[var(--text-muted)] truncate leading-tight">
          @{member.username}
        </p>
      </div>
    </div>
  );
}
