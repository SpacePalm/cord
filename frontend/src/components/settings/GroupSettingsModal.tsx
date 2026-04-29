import { useState, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Camera, Check, Trash2, Hash, Volume2, Pencil, Copy, RefreshCw, UserX, AlertTriangle } from 'lucide-react';
import { groupsApi } from '../../api/groups';
import { useAuthStore } from '../../store/authStore';
import { useT, useLocale } from '../../i18n';
import type { Group, Chat } from '../../types';
import { ImageCropModal } from '../ui/ImageCropModal';
import { ChannelColorPicker } from '../ui/ChannelColorPicker';

type Tab = 'overview' | 'members' | 'channels' | 'invite';

interface GroupSettingsModalProps {
  group: Group;
  channels: Chat[];
  onClose: () => void;
  onGroupUpdated: (g: Group) => void;
  onChannelsChanged: () => void;
  isPersonal?: boolean;
}

// ---------------------------------------------------------------------------
// OverviewTab
// ---------------------------------------------------------------------------
function OverviewTab({ group, onGroupUpdated, onClose }: { group: Group; onGroupUpdated: (g: Group) => void; onClose: () => void }) {
  const t = useT();
  const currentUser = useAuthStore((s) => s.user);
  const [name, setName] = useState(group.name);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const saveMutation = useMutation({
    mutationFn: async () => {
      let updated = group;
      if (pendingFile) {
        updated = await groupsApi.uploadAvatar(group.id, pendingFile);
      }
      if (name.trim() !== group.name) {
        updated = await groupsApi.update(group.id, name.trim());
      }
      return updated;
    },
    onSuccess: (g) => {
      onGroupUpdated(g);
      setPendingFile(null);
      setAvatarPreview(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
    onError: () => setError(t('settings.loadError')),
  });

  const initials = (group.name || '?').slice(0, 2).toUpperCase();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCropSrc(URL.createObjectURL(file));
    e.target.value = '';
  };

  const handleCropped = (file: File) => {
    setPendingFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  const isDirty = pendingFile !== null || name.trim() !== group.name;

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold text-[var(--text-primary)]">{t('server.overview')}</h2>

      {/* Avatar */}
      <div className="flex items-center gap-4">
        <div className="relative w-20 h-20 shrink-0">
          {avatarPreview || group.image_path ? (
            <img
              src={avatarPreview ?? group.image_path}
              alt="avatar"
              className="w-20 h-20 rounded-2xl object-cover"
            />
          ) : (
            <div className="w-20 h-20 rounded-2xl bg-[var(--accent)] flex items-center justify-center text-white text-2xl font-bold">
              {initials}
            </div>
          )}
          <button
            onClick={() => fileRef.current?.click()}
            className="absolute inset-0 rounded-2xl bg-black/50 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
          >
            <Camera size={20} className="text-white" />
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
        </div>
        <div className="text-sm text-[var(--text-muted)]">
          <p>{t('server.avatarHint')}</p>
          <p>{t('server.avatarFormat')}</p>
        </div>
      </div>

      {/* Name */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1.5">
          {t('server.name')}
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          className="w-full px-3 py-2 rounded bg-[var(--bg-input)] text-[var(--text-primary)] border border-[var(--border-color)] focus:outline-none focus:border-[var(--accent)] text-sm"
        />
      </div>

      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

      <button
        onClick={() => saveMutation.mutate()}
        disabled={!isDirty || saveMutation.isPending}
        className="self-start px-4 py-2 rounded bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors flex items-center gap-2"
      >
        {saved ? <Check size={14} /> : null}
        {saveMutation.isPending ? t('saving') : saved ? t('saved') : t('save')}
      </button>

      {cropSrc && (
        <ImageCropModal
          src={cropSrc}
          shape="square"
          onCrop={handleCropped}
          onClose={() => setCropSrc(null)}
        />
      )}

      {/* Delete Group — only visible to owner */}
      {currentUser?.id === group.owner_id && (
        <DeleteGroupSection group={group} onClose={onClose} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DeleteGroupSection
// ---------------------------------------------------------------------------
function DeleteGroupSection({ group, onClose }: { group: Group; onClose: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => groupsApi.delete(group.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      onClose();
    },
  });

  return (
    <>
      <div className="border-t border-[var(--border-color)] pt-6 mt-2">
        <button
          onClick={() => setConfirmOpen(true)}
          className="px-4 py-2 rounded bg-[var(--danger)] text-white text-sm font-medium hover:opacity-90 transition-opacity flex items-center gap-2"
        >
          <Trash2 size={14} />
          {t('server.delete')}
        </button>
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={() => setConfirmOpen(false)}>
          <div
            className="w-full max-w-sm bg-[var(--bg-secondary)] rounded-xl shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-[var(--danger)]/15 flex items-center justify-center shrink-0">
                <AlertTriangle size={20} className="text-[var(--danger)]" />
              </div>
              <h3 className="text-base font-semibold text-[var(--text-primary)]">{t('server.delete')}</h3>
            </div>
            <p className="text-sm text-[var(--text-secondary)] mb-5">
              {t('server.deleteConfirm').replace('{name}', group.name)}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmOpen(false)}
                className="flex-1 py-2 rounded-lg text-sm font-medium bg-white/5 text-[var(--text-secondary)] hover:bg-white/10 transition-colors"
              >
                {t('cancel')}
              </button>
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="flex-1 py-2 rounded-lg text-sm font-medium bg-[var(--danger)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {deleteMutation.isPending ? t('loading') : t('delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// MembersTab
// ---------------------------------------------------------------------------
function MembersTab({ group }: { group: Group }) {
  const t = useT();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const isOwner = currentUser?.id === group.owner_id;

  const { data: members, isLoading } = useQuery({
    queryKey: ['group-members', group.id],
    queryFn: () => groupsApi.getMembers(group.id),
  });

  const kickMutation = useMutation({
    mutationFn: (userId: string) => groupsApi.kickMember(group.id, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['group-members', group.id] }),
  });

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      groupsApi.updateMemberRole(group.id, userId, role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['group-members', group.id] }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-[var(--text-primary)]">
        {t('members')} — {members?.length ?? 0}
      </h2>
      <div className="flex flex-col gap-1">
        {members?.map((m) => {
          const initials = (m.display_name || m.username).slice(0, 2).toUpperCase();
          const isThisOwner = m.user_id === group.owner_id;
          const isEditor = m.role === 'editor';
          const isSelf = m.user_id === currentUser?.id;
          return (
            <div key={m.user_id} className="flex items-center gap-3 px-2 py-2 rounded hover:bg-[var(--bg-input)] group/row">
              {m.image_path ? (
                <img src={m.image_path} alt="avatar" className="w-8 h-8 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-[var(--accent)] flex items-center justify-center text-white text-xs font-bold shrink-0">
                  {initials}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                  {m.display_name}
                  {isThisOwner && (
                    <span className="ml-2 text-xs text-[var(--accent)] font-normal">{t('role.owner')}</span>
                  )}
                  {isEditor && !isThisOwner && (
                    <span className="ml-2 text-xs text-[var(--text-muted)] font-normal">{t('role.editor')}</span>
                  )}
                </p>
                <p className="text-xs text-[var(--text-muted)] truncate">@{m.username}</p>
              </div>
              <div className="flex items-center gap-1">
                {isOwner && !isSelf && !isThisOwner && (
                  <button
                    onClick={() => roleMutation.mutate({ userId: m.user_id, role: isEditor ? 'member' : 'editor' })}
                    disabled={roleMutation.isPending}
                    className="opacity-0 group-hover/row:opacity-100 px-2 py-1 rounded text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 transition-all"
                  >
                    {isEditor ? t('role.removeEditor') : t('role.makeEditor')}
                  </button>
                )}
                {isOwner && !isThisOwner && (
                  <button
                    onClick={() => kickMutation.mutate(m.user_id)}
                    disabled={kickMutation.isPending}
                    title={t('admin.kick')}
                    className="opacity-0 group-hover/row:opacity-100 p-1 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-all"
                  >
                    <UserX size={15} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChannelsTab
// ---------------------------------------------------------------------------
function ChannelsTab({ group, channels, onChannelsChanged, isPersonal = false }: { group: Group; channels: Chat[]; onChannelsChanged: () => void; isPersonal?: boolean }) {
  const t = useT();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'text' | 'voice'>('text');
  const [newColor, setNewColor] = useState<string | null>(null);
  const textChannelCount = channels.filter((c) => c.type === 'text').length;

  const renameMutation = useMutation({
    mutationFn: ({ chatId, name }: { chatId: string; name: string }) =>
      groupsApi.renameChat(group.id, chatId, name),
    onSuccess: () => {
      onChannelsChanged();
      setEditingId(null);
    },
  });

  // Изменение цвета — отдельная мутация. Оптимистично можно не делать,
  // т.к. /chats список рефетчится через onChannelsChanged.
  const colorMutation = useMutation({
    mutationFn: ({ chatId, color }: { chatId: string; color: string | null }) =>
      groupsApi.updateChat(group.id, chatId, { color }),
    onSuccess: () => onChannelsChanged(),
  });

  const deleteMutation = useMutation({
    mutationFn: (chatId: string) => groupsApi.deleteChat(group.id, chatId),
    onSuccess: () => onChannelsChanged(),
  });

  const createMutation = useMutation({
    mutationFn: () => groupsApi.createChat(group.id, newName.trim(), newType, newColor),
    onSuccess: () => {
      onChannelsChanged();
      setNewName('');
      setNewColor(null);
    },
  });

  const handleRenameKeyDown = (e: React.KeyboardEvent, chatId: string) => {
    if (e.key === 'Enter') commitRename(chatId);
    if (e.key === 'Escape') setEditingId(null);
  };

  const commitRename = (chatId: string) => {
    if (editName.trim()) renameMutation.mutate({ chatId, name: editName.trim() });
    else setEditingId(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-[var(--text-primary)]">{t('group.groups')}</h2>

      <div className="flex flex-col gap-1">
        {channels.map((ch) => (
          <div key={ch.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--bg-input)] group/row">
            <ChannelColorPicker
              value={ch.color}
              onChange={(color) => colorMutation.mutate({ chatId: ch.id, color })}
              title={t('group.color') ?? 'Color'}
            />
            {ch.type === 'voice' ? (
              <Volume2 size={15} className="text-[var(--text-muted)] shrink-0" />
            ) : (
              <Hash size={15} className="text-[var(--text-muted)] shrink-0" />
            )}

            {editingId === ch.id ? (
              <input
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => handleRenameKeyDown(e, ch.id)}
                onBlur={() => commitRename(ch.id)}
                className="flex-1 px-2 py-0.5 rounded bg-[var(--bg-input)] text-[var(--text-primary)] border border-[var(--accent)] text-sm focus:outline-none"
              />
            ) : (
              <span className="flex-1 text-sm text-[var(--text-primary)] truncate">{ch.name}</span>
            )}

            <div className="flex items-center gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
              <button
                onClick={() => { setEditingId(ch.id); setEditName(ch.name); }}
                title="Переименовать"
                className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10"
              >
                <Pencil size={13} />
              </button>
              {!(isPersonal && textChannelCount <= 1 && ch.type === 'text') && (
                <button
                  onClick={() => deleteMutation.mutate(ch.id)}
                  disabled={deleteMutation.isPending}
                  title={t('delete')}
                  className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add channel form */}
      <div className="border-t border-[var(--border-color)] pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">{t('group.add')}</p>
        <div className="flex gap-2 items-center">
          <ChannelColorPicker value={newColor} onChange={setNewColor} title={t('group.color') ?? 'Color'} />
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) createMutation.mutate(); }}
            placeholder={t('group.name')}
            maxLength={50}
            className="flex-1 px-3 py-1.5 rounded bg-[var(--bg-input)] text-[var(--text-primary)] border border-[var(--border-color)] focus:outline-none focus:border-[var(--accent)] text-sm"
          />
          {!isPersonal && (
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as 'text' | 'voice')}
              className="px-2 py-1.5 rounded bg-[var(--bg-input)] text-[var(--text-primary)] border border-[var(--border-color)] text-sm focus:outline-none"
            >
              <option value="text">{t('group.text')}</option>
              <option value="voice">{t('group.voice')}</option>
            </select>
          )}
          <button
            onClick={() => createMutation.mutate()}
            disabled={!newName.trim() || createMutation.isPending}
            className="px-3 py-1.5 rounded bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors"
          >
            {t('server.create')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InviteTab
// ---------------------------------------------------------------------------
function InviteTab({ group }: { group: Group }) {
  const t = useT();
  const locale = useLocale();
  const [inviteInfo, setInviteInfo] = useState<{ code: string; expires_at: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const createMutation = useMutation({
    mutationFn: () => groupsApi.createInvite(group.id),
    onSuccess: (data) => setInviteInfo(data),
    onError: () => setError(t('invite.error')),
  });

  const fullUrl = inviteInfo ? window.location.origin + '/invite/' + inviteInfo.code : '';

  const handleCopy = () => {
    navigator.clipboard.writeText(fullUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const expiresDate = inviteInfo
    ? new Date(inviteInfo.expires_at).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })
    : null;

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-[var(--text-primary)]">{t('server.inviteMembers')}</h2>
      <p className="text-sm text-[var(--text-muted)]">
        Создайте ссылку-приглашение. Она будет действительна 24 часа.
      </p>

      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

      {!inviteInfo ? (
        <button
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          className="self-start px-4 py-2 rounded bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors"
        >
          {createMutation.isPending ? t('loading') : t('invite.join')}
        </button>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <input
              readOnly
              value={fullUrl}
              className="flex-1 px-3 py-2 rounded bg-[var(--bg-input)] text-[var(--text-primary)] border border-[var(--border-color)] text-sm focus:outline-none select-all"
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button
              onClick={handleCopy}
              title="Скопировать"
              className="px-3 py-2 rounded bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors flex items-center gap-1.5 text-sm font-medium"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Скопировано' : 'Копировать'}
            </button>
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            Истекает: {expiresDate}
          </p>
          <button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            className="self-start flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            <RefreshCw size={13} />
            {t('admin.refresh')}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal shell
// ---------------------------------------------------------------------------
export function GroupSettingsModal({ group, channels, onClose, onGroupUpdated, onChannelsChanged, isPersonal = false }: GroupSettingsModalProps) {
  const t = useT();
  const [tab, setTab] = useState<Tab>(isPersonal ? 'channels' : 'overview');

  const TAB_LABELS: { id: Tab; label: string }[] = isPersonal
    ? [{ id: 'channels', label: t('group.groups') }]
    : [
        { id: 'overview', label: t('server.overview') },
        { id: 'members', label: t('members') },
        { id: 'channels', label: t('group.groups') },
        { id: 'invite', label: t('server.invite') },
      ];

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[var(--bg-secondary)] rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)]">
          <h1 className="font-semibold text-[var(--text-primary)]">{isPersonal ? t('saved.manageChats') : t('server.settings')}</h1>
          <button
            onClick={onClose}
            className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-3 border-b border-[var(--border-color)]">
          {TAB_LABELS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-3 py-2 text-sm rounded-t transition-colors ${
                tab === id
                  ? 'text-[var(--text-primary)] border-b-2 border-[var(--accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {!isPersonal && tab === 'overview' && (
            <OverviewTab group={group} onGroupUpdated={onGroupUpdated} onClose={onClose} />
          )}
          {!isPersonal && tab === 'members' && (
            <MembersTab group={group} />
          )}
          {tab === 'channels' && (
            <ChannelsTab group={group} channels={channels} onChannelsChanged={onChannelsChanged} isPersonal={isPersonal} />
          )}
          {!isPersonal && tab === 'invite' && (
            <InviteTab group={group} />
          )}
        </div>
      </div>
    </div>
  );
}
