import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Shield, Users, Server, Settings, ArrowLeft, Trash2, UserX,
  Search, RefreshCw, HardDrive, MessageSquare, Paperclip,
  ChevronDown, ChevronRight, Check, AlertTriangle, Lock,
} from 'lucide-react';
import { SecurityTab } from '../components/admin/SecurityTab';
import { adminApi } from '../api/admin';
import type { AdminUser } from '../api/admin';
import { useAuthStore } from '../store/authStore';
import { useSessionStore } from '../store/sessionStore';
import { useT } from '../i18n';

function AdminPaletteButton() {
  const t = useT();
  const openPalette = useSessionStore((s) => s.openPalette);
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <button
      onClick={openPalette}
      className="flex items-center gap-2 px-2.5 py-1 rounded bg-[var(--bg-input)] hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors text-xs"
      title={t('palette.open')}
    >
      <Search size={12} />
      <span>{t('palette.quickSearch')}</span>
      <kbd className="text-[9px] border border-[var(--border-color)] rounded px-1 text-[var(--text-muted)]">
        {isMac ? '⌘K' : 'Ctrl+K'}
      </kbd>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function Avatar({ name, src, size = 8 }: { name: string; src?: string; size?: number }) {
  const initials = name.slice(0, 2).toUpperCase();
  const cls = `w-${size} h-${size} rounded-full object-cover shrink-0`;
  if (src) return <img src={src} alt={name} className={cls} />;
  return (
    <div className={`w-${size} h-${size} rounded-full bg-[var(--accent)] flex items-center justify-center text-white text-xs font-bold shrink-0`}>
      {initials}
    </div>
  );
}

// ---------------------------------------------------------------------------
// UsersTab
// ---------------------------------------------------------------------------
function UsersTab() {
  const t = useT();
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 400);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['admin-users', debouncedSearch],
    queryFn: () => adminApi.getUsers(debouncedSearch || undefined),
  });

  const updateMutation = useMutation({
    mutationFn: ({ userId, data }: { userId: string; data: { role?: string; is_active?: boolean } }) =>
      adminApi.updateUser(userId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (userId: string) => adminApi.deleteUser(userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const handleDelete = (u: AdminUser) => {
    if (!confirm(t('admin.deleteUserConfirm', { username: u.username }))) return;
    deleteMutation.mutate(u.id);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('admin.searchUsers')}
            className="w-full pl-9 pr-3 py-2 rounded bg-[var(--bg-input)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
          />
        </div>
        <span className="text-sm text-[var(--text-muted)]">{users.length} {t('admin.userCount')}</span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {users.map((u) => {
            const isSelf = u.id === currentUser?.id;
            return (
              <div key={u.id} className="flex items-center gap-3 px-4 py-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)]">
                <Avatar name={u.display_name || u.username} src={u.image_path || undefined} size={10} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-[var(--text-primary)] text-sm">{u.display_name}</span>
                    <span className="text-xs text-[var(--text-muted)]">@{u.username}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                      u.role === 'admin' ? 'bg-[var(--accent)]/20 text-[var(--accent)]' : 'bg-white/5 text-[var(--text-muted)]'
                    }`}>
                      {u.role === 'admin' ? t('admin.admin') : t('admin.user')}
                    </span>
                    {!u.is_active && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--danger)]/20 text-[var(--danger)] font-medium">
                        {t('admin.blocked')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">{u.email}</p>
                </div>

                {!isSelf && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => updateMutation.mutate({ userId: u.id, data: { role: u.role === 'admin' ? 'user' : 'admin' } })}
                      disabled={updateMutation.isPending}
                      title={u.role === 'admin' ? t('admin.revokeAdmin') : t('admin.makeAdmin')}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-colors disabled:opacity-50 ${
                        u.role === 'admin'
                          ? 'bg-white/5 text-[var(--text-muted)] hover:bg-white/10'
                          : 'bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20'
                      }`}
                    >
                      {u.role === 'admin' ? t('admin.revokeAdmin') : t('admin.admin')}
                    </button>
                    <button
                      onClick={() => updateMutation.mutate({ userId: u.id, data: { is_active: !u.is_active } })}
                      disabled={updateMutation.isPending}
                      title={u.is_active ? t('admin.block') : t('admin.unblock')}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-colors disabled:opacity-50 ${
                        u.is_active
                          ? 'bg-[var(--danger)]/10 text-[var(--danger)] hover:bg-[var(--danger)]/20'
                          : 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
                      }`}
                    >
                      {u.is_active ? t('admin.block') : t('admin.unblock')}
                    </button>
                    <button
                      onClick={() => handleDelete(u)}
                      disabled={deleteMutation.isPending}
                      title={t('delete')}
                      className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
                {isSelf && (
                  <span className="text-xs text-[var(--text-muted)] shrink-0">{t('admin.itsYou')}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GroupsTab
// ---------------------------------------------------------------------------
function GroupMembersList({ groupId, ownerId }: { groupId: string; ownerId: string }) {
  const t = useT();
  const qc = useQueryClient();

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['admin-group-members', groupId],
    queryFn: () => adminApi.getGroupMembers(groupId),
  });

  const kickMutation = useMutation({
    mutationFn: (userId: string) => adminApi.kickGroupMember(groupId, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-group-members', groupId] });
      qc.invalidateQueries({ queryKey: ['admin-groups'] });
    },
  });

  if (isLoading) return (
    <div className="py-3 flex justify-center">
      <div className="w-4 h-4 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
    </div>
  );

  return (
    <div className="px-4 pb-3 flex flex-col gap-1">
      {members.map((m) => (
        <div key={m.user_id} className="flex items-center gap-2 py-1 group/row">
          <Avatar name={m.display_name || m.username} src={m.image_path || undefined} size={6} />
          <span className="text-sm text-[var(--text-secondary)] flex-1">
            {m.display_name}
            <span className="text-[var(--text-muted)] ml-1">@{m.username}</span>
          </span>
          {m.user_id !== ownerId && (
            <button
              onClick={() => kickMutation.mutate(m.user_id)}
              disabled={kickMutation.isPending}
              title={t('admin.kick')}
              className="opacity-0 group-hover/row:opacity-100 p-1 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-all"
            >
              <UserX size={13} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function GroupsTab() {
  const t = useT();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['admin-groups'],
    queryFn: adminApi.getGroups,
  });

  const deleteMutation = useMutation({
    mutationFn: (groupId: string) => adminApi.deleteGroup(groupId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-groups'] }),
  });

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col gap-2">
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
        </div>
      ) : groups.map((g) => {
        const isOpen = expanded.has(g.id);
        const initials = g.name.slice(0, 2).toUpperCase();
        return (
          <div key={g.id} className="rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3">
              {g.image_path ? (
                <img src={g.image_path} alt={g.name} className="w-9 h-9 rounded-lg object-cover shrink-0" />
              ) : (
                <div className="w-9 h-9 rounded-lg bg-[var(--accent)] flex items-center justify-center text-white text-sm font-bold shrink-0">
                  {initials}
                </div>
              )}

              <div className="flex-1 min-w-0">
                <p className="font-medium text-[var(--text-primary)] text-sm truncate">{g.name}</p>
                <p className="text-xs text-[var(--text-muted)]">
                  {t('admin.owner', { username: g.owner_username })} · {t('admin.memberCount', { count: String(g.member_count) })} · {t('admin.channelCount', { count: String(g.channel_count) })}
                </p>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => toggleExpand(g.id)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5 transition-colors"
                >
                  {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  {t('admin.members')}
                </button>
                <button
                  onClick={() => {
                    if (!confirm(t('admin.deleteServerConfirm', { name: g.name }))) return;
                    deleteMutation.mutate(g.id);
                  }}
                  disabled={deleteMutation.isPending}
                  title={t('delete')}
                  className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            {isOpen && <GroupMembersList groupId={g.id} ownerId={g.owner_id} />}
          </div>
        );
      })}

      {!isLoading && groups.length === 0 && (
        <p className="text-center text-sm text-[var(--text-muted)] py-12">{t('admin.noServers')}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SystemTab
// ---------------------------------------------------------------------------
function SystemTab() {
  const t = useT();
  const qc = useQueryClient();
  const [cleanupDays, setCleanupDays] = useState(90);
  const [includePersonal, setIncludePersonal] = useState(false);
  const [includeDm, setIncludeDm] = useState(false);
  const [cleanupMsgResult, setCleanupMsgResult] = useState<number | null>(null);
  const [cleanupAttResult, setCleanupAttResult] = useState<number | null>(null);

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: adminApi.getSettings,
  });

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: adminApi.getStats,
  });

  const settingsMutation = useMutation({
    mutationFn: (enabled: boolean) => adminApi.updateSettings({ registration_enabled: enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-settings'] }),
  });

  const cleanupMsgMutation = useMutation({
    mutationFn: () => adminApi.cleanupMessages(cleanupDays, includePersonal, includeDm),
    onSuccess: (data) => {
      setCleanupMsgResult(data.deleted);
      refetchStats();
    },
  });

  const cleanupAttMutation = useMutation({
    mutationFn: adminApi.cleanupAttachments,
    onSuccess: (data) => {
      setCleanupAttResult(data.deleted);
      refetchStats();
    },
  });

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto w-full">

      {/* Registration toggle */}
      <section className="p-5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)]">
        <h3 className="font-semibold text-[var(--text-primary)] mb-1">{t('admin.registration')}</h3>
        <p className="text-sm text-[var(--text-muted)] mb-4">{t('admin.registrationHint')}</p>
        {settingsLoading ? (
          <div className="w-5 h-5 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
        ) : (
          <label className="flex items-center gap-3 cursor-pointer w-fit">
            <div
              onClick={() => settingsMutation.mutate(!settings?.registration_enabled)}
              className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${
                settings?.registration_enabled ? 'bg-[var(--accent)]' : 'bg-white/10'
              } ${settingsMutation.isPending ? 'opacity-50 pointer-events-none' : ''}`}
            >
              <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                settings?.registration_enabled ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </div>
            <span className="text-sm text-[var(--text-primary)]">
              {settings?.registration_enabled ? t('admin.regOpen') : t('admin.regClosed')}
            </span>
          </label>
        )}
      </section>

      {/* Stats */}
      <section className="p-5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)]">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-[var(--text-primary)]">{t('admin.statistics')}</h3>
          <button
            onClick={() => refetchStats()}
            className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5 transition-colors"
            title={t('admin.refresh')}
          >
            <RefreshCw size={14} className={statsLoading ? 'animate-spin' : ''} />
          </button>
        </div>

        {stats && (
          <>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {[
                { icon: Users, label: t('admin.users'), value: stats.db.users },
                { icon: Server, label: t('admin.servers'), value: stats.db.groups },
                { icon: MessageSquare, label: t('admin.messages'), value: stats.db.messages.toLocaleString() },
                { icon: Paperclip, label: t('admin.attachments'), value: stats.db.attachments.toLocaleString() },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="flex items-center gap-3 px-4 py-3 rounded-lg bg-[var(--bg-input)]">
                  <Icon size={18} className="text-[var(--accent)] shrink-0" />
                  <div>
                    <p className="text-lg font-bold text-[var(--text-primary)] leading-tight">{value}</p>
                    <p className="text-xs text-[var(--text-muted)]">{label}</p>
                  </div>
                </div>
              ))}
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <HardDrive size={15} className="text-[var(--text-muted)]" />
                <span className="text-sm text-[var(--text-primary)] font-medium">{t('admin.disk')}{formatBytes(stats.disk.total_bytes)}</span>
              </div>
              <div className="flex flex-col gap-1 pl-5">
                {[
                  { label: t('admin.userAvatars'), bytes: stats.disk.avatars_bytes },
                  { label: t('admin.serverAvatars'), bytes: stats.disk.group_avatars_bytes },
                  { label: t('admin.messageFiles'), bytes: stats.disk.message_files_bytes },
                ].map(({ label, bytes }) => (
                  <div key={label} className="flex items-center justify-between text-xs">
                    <span className="text-[var(--text-muted)]">{label}</span>
                    <span className="text-[var(--text-secondary)] font-mono">{formatBytes(bytes)}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </section>

      {/* Cleanup */}
      <section className="p-5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)]">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle size={16} className="text-yellow-500" />
          <h3 className="font-semibold text-[var(--text-primary)]">{t('admin.cleanup')}</h3>
        </div>
        <p className="text-sm text-[var(--text-muted)] mb-5">{t('admin.cleanupWarning')}</p>

        <div className="flex flex-col gap-4">
          {/* Old messages */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--text-primary)]">{t('admin.deleteOldMessages')}</p>
              <p className="text-xs text-[var(--text-muted)]">{t('admin.deleteOldMessagesHint')}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <input
                type="number"
                value={cleanupDays}
                onChange={(e) => setCleanupDays(Math.max(1, Number(e.target.value)))}
                min={1}
                className="w-16 px-2 py-1.5 rounded bg-[var(--bg-input)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] text-center focus:outline-none focus:border-[var(--accent)]"
              />
              <span className="text-sm text-[var(--text-muted)]">{t('admin.days')}</span>
              <button
                onClick={() => {
                  // Выбираем confirm-текст в зависимости от включённых тумблеров
                  const confirmKey = includePersonal && includeDm
                    ? 'admin.deleteMessagesConfirmWithBoth'
                    : includePersonal
                      ? 'admin.deleteMessagesConfirmWithPersonal'
                      : includeDm
                        ? 'admin.deleteMessagesConfirmWithDm'
                        : 'admin.deleteMessagesConfirm';
                  if (!confirm(t(confirmKey, { days: String(cleanupDays) }))) return;
                  setCleanupMsgResult(null);
                  cleanupMsgMutation.mutate();
                }}
                disabled={cleanupMsgMutation.isPending}
                className="px-3 py-1.5 rounded bg-[var(--danger)]/10 text-[var(--danger)] hover:bg-[var(--danger)]/20 text-sm font-medium transition-colors disabled:opacity-50"
              >
                {cleanupMsgMutation.isPending ? t('admin.deleting') : t('delete')}
              </button>
            </div>
            <label className="w-full flex items-center gap-3 cursor-pointer select-none">
              <div
                onClick={() => setIncludePersonal(v => !v)}
                className={`relative w-9 h-5 rounded-full transition-colors ${
                  includePersonal ? 'bg-[var(--danger)]' : 'bg-white/10'
                }`}
              >
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                  includePersonal ? 'translate-x-4' : 'translate-x-0.5'
                }`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-[var(--text-primary)]">{t('admin.includePersonal')}</p>
                <p className="text-[11px] text-[var(--text-muted)]">{t('admin.includePersonalHint')}</p>
              </div>
            </label>
            <label className="w-full flex items-center gap-3 cursor-pointer select-none">
              <div
                onClick={() => setIncludeDm(v => !v)}
                className={`relative w-9 h-5 rounded-full transition-colors ${
                  includeDm ? 'bg-[var(--danger)]' : 'bg-white/10'
                }`}
              >
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                  includeDm ? 'translate-x-4' : 'translate-x-0.5'
                }`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-[var(--text-primary)]">{t('admin.includeDm')}</p>
                <p className="text-[11px] text-[var(--text-muted)]">{t('admin.includeDmHint')}</p>
              </div>
            </label>
            {cleanupMsgResult !== null && (
              <div className="w-full flex items-center gap-1 text-xs text-green-400">
                <Check size={12} /> {t('admin.deletedMessages', { count: String(cleanupMsgResult) })}
              </div>
            )}
          </div>

          <div className="h-px bg-[var(--border-color)]" />

          {/* Orphaned attachments */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--text-primary)]">{t('admin.deleteUnused')}</p>
              <p className="text-xs text-[var(--text-muted)]">{t('admin.deleteUnusedHint')}</p>
            </div>
            <button
              onClick={() => {
                if (!confirm(t('admin.deleteAttachmentsConfirm'))) return;
                setCleanupAttResult(null);
                cleanupAttMutation.mutate();
              }}
              disabled={cleanupAttMutation.isPending}
              className="px-3 py-1.5 rounded bg-[var(--danger)]/10 text-[var(--danger)] hover:bg-[var(--danger)]/20 text-sm font-medium transition-colors disabled:opacity-50 shrink-0"
            >
              {cleanupAttMutation.isPending ? t('admin.cleaning') : t('admin.clean')}
            </button>
            {cleanupAttResult !== null && (
              <div className="w-full flex items-center gap-1 text-xs text-green-400">
                <Check size={12} /> {t('admin.deletedFiles', { count: String(cleanupAttResult) })}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AdminPage
// ---------------------------------------------------------------------------
type Tab = 'users' | 'groups' | 'system' | 'security';

export function AdminPage() {
  const t = useT();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  // Начальная вкладка из query-параметра ?tab=... (используется CommandPalette)
  const initialTab: Tab = (() => {
    const q = new URLSearchParams(window.location.search).get('tab');
    return q === 'groups' || q === 'system' || q === 'security' ? (q as Tab) : 'users';
  })();
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => {
    if (user && user.role !== 'admin') navigate('/app', { replace: true });
  }, [user, navigate]);

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'users', label: t('admin.users'), icon: Users },
    { id: 'groups', label: t('admin.servers'), icon: Server },
    { id: 'security', label: t('admin.security'), icon: Lock },
    { id: 'system', label: t('admin.system'), icon: Settings },
  ];

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-3 border-b border-[var(--border-color)] shrink-0"
        style={{ background: 'var(--bg-secondary)' }}
      >
        <div className="flex items-center gap-2">
          <Shield size={20} className="text-[var(--accent)]" />
          <span className="font-bold text-[var(--text-primary)]">{t('admin.title')}</span>
        </div>
        <div className="flex items-center gap-3">
          <AdminPaletteButton />
          <button
            onClick={() => navigate('/app')}
            className="flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            <ArrowLeft size={16} /> {t('admin.toApp')}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div
        className="flex gap-1 px-6 py-2 border-b border-[var(--border-color)] shrink-0"
        style={{ background: 'var(--bg-secondary)' }}
      >
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded text-sm font-medium transition-colors ${
              tab === id
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5'
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-4xl w-full mx-auto">
          {tab === 'users' && <UsersTab />}
          {tab === 'groups' && <GroupsTab />}
          {tab === 'security' && <SecurityTab />}
          {tab === 'system' && <SystemTab />}
        </div>
      </div>
    </div>
  );
}
