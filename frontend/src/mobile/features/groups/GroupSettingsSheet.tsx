// Server settings — iOS GroupSettingsView: one inset-grouped list in a large sheet:
// Overview (canManageGroup: avatar, name, save) · Members — N (role tags, status dots, swipe Kick /
// Make|Remove editor) · Invite (canInvite: create / copy / share / expiry / regenerate) · Leave / Delete
// (destructive alerts) · Error.
import { useEffect, useRef, useState } from 'react';
import { groupsApi } from '../../../api/groups';
import { useAuthStore } from '../../../store/authStore';
import { useSessionStore } from '../../../store/sessionStore';
import type { Chat, Group, InviteInfo, Member } from '../../../types';
import { SheetScreen } from '../../nav/Screen';
import { BarTextButton } from '../../nav/BarButton';
import { mobileNav } from '../../nav/NavStack';
import { present, type SheetCtx } from '../../present/PresentationProvider';
import {
  Avatar,
  ButtonRow,
  CordButton,
  CordField,
  ErrorRow,
  InsetGroupedList,
  ListSection,
  Row,
  SwipeRow,
  type SwipeAction,
} from '../../ui';
import { useMT, useMobileLocale } from '../../i18n';
import { AvatarUploader } from '../media/AvatarUploader';
import { copyText, trimSpaces, useGroup, useGroupMembers, useGroupPermissions, userMessage } from './data';
import { useRegisterQueryClient } from './queryClientRef';
import './groups.css';

export interface GroupSettingsSheetProps extends SheetCtx {
  groupId: string;
}

/** iOS DateFormatter "d MMM, HH:mm" in the UI locale ("9 окт., 14:30" / "9 Oct, 14:30"). */
function formatExpiry(iso: string, locale: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const dm = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).formatToParts(d);
  const day = dm.find((p) => p.type === 'day')?.value ?? String(d.getDate());
  const month = dm.find((p) => p.type === 'month')?.value ?? '';
  const hm = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const hh = hm.find((p) => p.type === 'hour')?.value ?? '';
  const mm = hm.find((p) => p.type === 'minute')?.value ?? '';
  return `${day} ${month}, ${hh.padStart(2, '0')}:${mm}`;
}

function RoleTag({ text, color }: { text: string; color: string }) {
  return (
    <span className="m-grp-role-tag" style={{ color, background: `color-mix(in srgb, ${color} 18%, transparent)` }}>
      {text}
    </span>
  );
}

export function GroupSettingsSheet({ groupId, dismiss }: GroupSettingsSheetProps) {
  const t = useMT();
  const locale = useMobileLocale();
  const qc = useRegisterQueryClient();
  const me = useAuthStore((s) => s.user);
  const group = useGroup(groupId);
  // `.task { loadMembers() }` — fresh on open; no polling, no pull-to-refresh
  const membersQ = useGroupMembers(groupId, { refetchOnMount: 'always' });
  const members = membersQ.data ?? [];
  const perms = useGroupPermissions(group, membersQ.data);

  // Snapshot of the group at open time (alerts/messages keep working while ['groups'] refetches).
  const [initial] = useState<Group | undefined>(group);
  const g = group ?? initial;

  const [nameText, setNameText] = useState(g?.name ?? '');
  const [busyRename, setBusyRename] = useState(false);
  const [renameSaved, setRenameSaved] = useState(false);
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [busyInvite, setBusyInvite] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [avatarV, setAvatarV] = useState(0);

  useEffect(() => {
    if (!nameText && g?.name) setNameText(g.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g?.name]);

  useEffect(() => {
    if (membersQ.isError) setErrorText(userMessage(membersQ.error, t('members.loadFailed')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membersQ.errorUpdatedAt]);
  // iOS loadMembers() clears errorText on success (after a kick / role change too)
  const firstData = useRef(true);
  useEffect(() => {
    if (firstData.current) {
      firstData.current = false;
      return;
    }
    if (membersQ.isSuccess) setErrorText(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membersQ.dataUpdatedAt]);

  if (!g) {
    return (
      <SheetScreen
        title=""
        trailing={
          <BarTextButton prominent onPress={() => void dismiss()}>
            {t('common.close')}
          </BarTextButton>
        }
      />
    );
  }

  // Web deviation: compare with the LIVE name, so Save disables after saving.
  const liveName = g.name;
  const trimmedName = trimSpaces(nameText);
  const renameDirty = !!trimmedName && trimmedName !== liveName;

  const reloadMembers = () => qc.invalidateQueries({ queryKey: ['group-members', groupId] });

  const rename = async () => {
    if (busyRename || !renameDirty) return;
    setBusyRename(true);
    setErrorText(null);
    try {
      await groupsApi.update(groupId, trimmedName);
      await qc.invalidateQueries({ queryKey: ['groups'] });
      setRenameSaved(true);
    } catch (e) {
      setErrorText(userMessage(e, t('server.renameFailed')));
    } finally {
      setBusyRename(false);
    }
  };

  const uploadAvatar = async (file: File) => {
    try {
      await groupsApi.uploadAvatar(groupId, file);
    } catch (e) {
      throw new Error(userMessage(e, t('avatar.uploadFailed')));
    }
    // same file name on the server → bust the browser cache for this sheet
    setAvatarV(Date.now());
    await qc.invalidateQueries({ queryKey: ['groups'] });
  };

  const setRole = async (m: Member, role: 'editor' | 'member') => {
    try {
      await groupsApi.updateMemberRole(groupId, m.user_id, role);
      await reloadMembers();
    } catch (e) {
      setErrorText(userMessage(e, t('members.roleFailed')));
    }
  };

  const kick = async (m: Member) => {
    try {
      await groupsApi.kickMember(groupId, m.user_id);
      await reloadMembers();
    } catch (e) {
      setErrorText(userMessage(e, t('members.kickFailed')));
    }
  };

  const createInvite = async () => {
    if (busyInvite) return;
    setBusyInvite(true);
    setErrorText(null);
    try {
      setInvite(await groupsApi.createInvite(groupId));
    } catch (e) {
      setErrorText(userMessage(e, t('server.inviteFailed')));
    } finally {
      setBusyInvite(false);
    }
  };

  const inviteURL = invite ? window.location.origin + invite.url : '';

  const share = async () => {
    const nav = navigator as Navigator & { share?: (d: { url?: string; title?: string }) => Promise<void> };
    if (typeof nav.share === 'function') {
      try {
        await nav.share({ url: inviteURL, title: liveName });
        return;
      } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') return;
      }
    }
    await copyText(inviteURL);
  };

  /** After leave/delete: the server vanishes from the root list → back to root. */
  const afterGone = async () => {
    const ss = useSessionStore.getState();
    const chats = qc.getQueryData<Chat[]>(['chats', groupId]) ?? [];
    if (ss.lastGroupId === groupId) ss.setLastGroup(null);
    if (ss.lastChannelId && chats.some((c) => c.id === ss.lastChannelId)) ss.setLastChannel(null);
    void qc.invalidateQueries({ queryKey: ['groups'] });
    void qc.invalidateQueries({ queryKey: ['unread'] });
    await present.dismissAll();
    mobileNav.popToRoot();
  };

  const leave = async () => {
    try {
      await groupsApi.leave(groupId);
      await afterGone();
    } catch (e) {
      setErrorText(userMessage(e, t('server.leaveFailed')));
    }
  };

  const del = async () => {
    try {
      await groupsApi.delete(groupId);
      await afterGone();
    } catch (e) {
      setErrorText(userMessage(e, t('server.deleteFailed')));
    }
  };

  const confirmLeave = () =>
    present.alert({
      title: t('server.leave'),
      message: t('server.leaveConfirm', liveName),
      actions: [
        { label: t('server.leave'), role: 'destructive', onPress: () => void leave() },
        { label: t('pollComposer.cancel'), role: 'cancel' },
      ],
    });

  const confirmDelete = () =>
    present.alert({
      title: t('server.delete'),
      message: t('server.deleteConfirm', liveName),
      actions: [
        { label: t('chat.delete'), role: 'destructive', onPress: () => void del() },
        { label: t('pollComposer.cancel'), role: 'cancel' },
      ],
    });

  const memberActions = (m: Member): SwipeAction[] => {
    const canActOn = !!perms?.canManageGroup && m.user_id !== g.owner_id && m.user_id !== me?.id;
    if (!canActOn) return [];
    const makeEditor = m.role !== 'editor';
    return [
      // destructive without tint → accent on iOS 26
      { icon: 'person.fill.xmark', label: t('members.kick'), onPress: () => void kick(m) },
      {
        icon: makeEditor ? 'person.badge.shield.checkmark' : 'person',
        label: t(makeEditor ? 'role.makeEditor' : 'role.removeEditor'),
        tint: 'var(--accent)',
        onPress: () => void setRole(m, makeEditor ? 'editor' : 'member'),
      },
    ];
  };

  const expires = invite ? formatExpiry(invite.expires_at, locale) : null;
  const avatarPath = g.image_path ? (avatarV ? `${g.image_path}?v=${avatarV}` : g.image_path) : null;

  return (
    <SheetScreen
      title={liveName}
      trailing={
        <BarTextButton prominent onPress={() => void dismiss()}>
          {t('common.close')}
        </BarTextButton>
      }
    >
      <InsetGroupedList>
        {perms?.canManageGroup && (
          <ListSection header={t('server.overview')}>
            <Row>
              <div className="m-grp-avatar-cell">
                <AvatarUploader imagePath={avatarPath} name={liveName} onUpload={uploadAvatar} size={88} />
              </div>
            </Row>
            <Row>
              <CordField
                label={t('server.name')}
                placeholder={t('server.name')}
                value={nameText}
                onChange={(v) => {
                  setNameText(v);
                  setRenameSaved(false);
                }}
                maxLength={100}
                enterKeyHint="done"
                onSubmit={() => (document.activeElement as HTMLElement | null)?.blur?.()}
                style={{ width: '100%' }}
              />
            </Row>
            <Row>
              <CordButton busy={busyRename} disabled={!renameDirty} onPress={() => void rename()}>
                {renameSaved ? t('common.saved') : t('common.save')}
              </CordButton>
            </Row>
          </ListSection>
        )}

        <ListSection header={t('members.count', members.length)}>
          {members.map((m) => {
            const isOwner = m.user_id === g.owner_id;
            const sub = m.status_text ? m.status_text : `@${m.username}`;
            return (
              <SwipeRow key={m.user_id} actions={memberActions(m)} fullSwipe={false}>
                <Row
                  leading={
                    <Avatar
                      src={m.image_path || null}
                      name={m.display_name}
                      size={32}
                      statusDot={{ status: m.status, isOnline: m.is_online, size: 11, ring: 'var(--bg-secondary)', offset: 1 }}
                    />
                  }
                  leadingGap={10}
                >
                  <div className="m-grp-member-line">
                    <span className="m-grp-member-name">{m.display_name}</span>
                    {isOwner ? (
                      <RoleTag text={t('role.owner')} color="var(--accent)" />
                    ) : m.role === 'editor' ? (
                      <RoleTag text={t('role.editor')} color="var(--text-muted)" />
                    ) : null}
                  </div>
                  <div className="m-grp-member-sub">{sub}</div>
                </Row>
              </SwipeRow>
            );
          })}
        </ListSection>

        {perms?.canInvite && (
          <ListSection header={t('server.invite')}>
            {invite ? (
              <>
                <Row>
                  <div className="m-grp-invite-url">{inviteURL}</div>
                </Row>
                <ButtonRow icon="doc.on.doc" title={t('server.copy')} onPress={() => void copyText(inviteURL)} />
                {/* web-only addition: system share sheet (falls back to copying) */}
                <ButtonRow icon="square.and.arrow.up" title={t('m.grp.share')} onPress={() => void share()} />
                {expires && (
                  <Row>
                    <div className="m-grp-hint">{t('server.inviteExpires', expires)}</div>
                  </Row>
                )}
                <ButtonRow
                  icon="arrow.clockwise"
                  title={t('server.inviteRegenerate')}
                  disabled={busyInvite}
                  onPress={() => void createInvite()}
                />
              </>
            ) : (
              <>
                <Row>
                  <div className="m-grp-hint">{t('server.inviteHint')}</div>
                </Row>
                <ButtonRow icon="link" title={t('server.inviteCreate')} disabled={busyInvite} onPress={() => void createInvite()} />
              </>
            )}
          </ListSection>
        )}

        {(perms ? !perms.isOwner || perms.canManageGroup : false) && (
          <ListSection>
            {!perms!.isOwner && (
              <ButtonRow icon="rectangle.portrait.and.arrow.right" title={t('server.leave')} role="destructive" onPress={confirmLeave} />
            )}
            {perms!.canManageGroup && <ButtonRow icon="trash" title={t('server.delete')} role="destructive" onPress={confirmDelete} />}
          </ListSection>
        )}

        {errorText && (
          <ListSection>
            <ErrorRow text={errorText} />
          </ListSection>
        )}
      </InsetGroupedList>
    </SheetScreen>
  );
}
