// iOS AdminUsersTab: server search (350ms debounce, spinner on every load), 3-line user rows
// (Avatar 40 · name + admin/blocked badges · @username · email), ⋯ Menu (admin toggle, block toggle, divider,
// delete → confirmation anchored to the row). Per-row busy spinners; action errors replace the list with the
// error card until the next load (iOS quirk, replicated).
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { adminApi, type AdminUser } from '../../../api/admin';
import { useAuthStore } from '../../../store/authStore';
import { Avatar, ListSection, Row, Spinner } from '../../ui';
import { usePresent, type MenuItem } from '../../present/PresentationProvider';
import { useMT } from '../../i18n';
import {
  AdminBadge,
  AdminList,
  AdminMessageSection,
  CenterSpinnerRow,
  MoreMenu,
  MutedTextRow,
  SearchSection,
  apiErrorText,
  useAlive,
  useBusySet,
  useDebounced,
} from './adminSupport';

export function AdminUsersTab() {
  const t = useMT();
  const present = usePresent();
  const meId = useAuthStore((s) => s.user?.id);
  const alive = useAlive();

  const [search, setSearch] = useState('');
  const q = useDebounced(search, 350);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { busy, add, remove } = useBusySet();
  const gen = useRef(0);

  const load = useCallback(
    async (query: string) => {
      const g = ++gen.current;
      setLoading(true);
      setError(null);
      try {
        const list = await adminApi.getUsers(query.trim() || undefined);
        if (!alive.current || g !== gen.current) return;
        setUsers(list);
        setLoading(false);
      } catch (e) {
        if (!alive.current || g !== gen.current) return;
        setError(apiErrorText(e, t('admin.loadFailed')));
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    void load(q);
  }, [q, load]);

  const update = async (u: AdminUser, body: { role?: string; is_active?: boolean }) => {
    add(u.id);
    try {
      const updated = await adminApi.updateUser(u.id, body);
      if (!alive.current) return;
      setUsers((list) => list.map((x) => (x.id === updated.id ? updated : x)));
    } catch (e) {
      if (alive.current) setError(apiErrorText(e, t('admin.actionFailed')));
    } finally {
      if (alive.current) remove(u.id);
    }
  };

  const del = async (u: AdminUser) => {
    add(u.id);
    try {
      await adminApi.deleteUser(u.id);
      if (!alive.current) return;
      setUsers((list) => list.filter((x) => x.id !== u.id));
    } catch (e) {
      if (alive.current) setError(apiErrorText(e, t('admin.actionFailed')));
    } finally {
      if (alive.current) remove(u.id);
    }
  };

  const askDelete = (u: AdminUser, row: HTMLElement | null) => {
    present.confirm({
      title: t('admin.users.deleteConfirm', u.username),
      anchor: row,
      actions: [
        { label: t('common.delete'), role: 'destructive', onPress: () => void del(u) },
        { label: t('common.cancel'), role: 'cancel' },
      ],
    });
  };

  return (
    <AdminList>
      <SearchSection placeholder={t('admin.users.searchPlaceholder')} value={search} onChange={setSearch} />
      {loading ? (
        <ListSection clear>
          <CenterSpinnerRow clear />
        </ListSection>
      ) : error ? (
        <AdminMessageSection message={{ text: error, isError: true }} />
      ) : users.length === 0 ? (
        <ListSection clear>
          <MutedTextRow text={t('admin.users.empty')} center />
        </ListSection>
      ) : (
        <ListSection header={t('admin.users.count', users.length)}>
          {users.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              isSelf={u.id === meId}
              busy={busy.has(u.id)}
              onAdminToggle={() => void update(u, { role: u.role === 'admin' ? 'user' : 'admin' })}
              onActiveToggle={() => void update(u, { is_active: !u.is_active })}
              onDelete={(row) => askDelete(u, row)}
            />
          ))}
        </ListSection>
      )}
    </AdminList>
  );
}

function UserRow({
  user,
  isSelf,
  busy,
  onAdminToggle,
  onActiveToggle,
  onDelete,
}: {
  user: AdminUser;
  isSelf: boolean;
  busy: boolean;
  onAdminToggle: () => void;
  onActiveToggle: () => void;
  onDelete: (row: HTMLElement | null) => void;
}) {
  const t = useMT();
  const present = usePresent();
  const moreRef = useRef<HTMLButtonElement>(null);
  const isAdmin = user.role === 'admin';
  const name = user.display_name || user.username;

  const items = (): MenuItem[] => [
    isAdmin
      ? { label: t('admin.users.demote'), icon: 'person', onSelect: onAdminToggle }
      : { label: t('admin.users.promote'), icon: 'shield', onSelect: onAdminToggle },
    user.is_active
      ? { label: t('admin.users.block'), icon: 'hand.raised', onSelect: onActiveToggle }
      : { label: t('admin.users.unblock'), icon: 'hand.raised.slash', onSelect: onActiveToggle },
    'divider',
    {
      label: t('common.delete'),
      icon: 'trash',
      role: 'destructive',
      onSelect: () => onDelete(moreRef.current?.closest('.ios-row') as HTMLElement | null),
    },
  ];

  // iOS List: the Menu is the row's only control → a tap anywhere on the row opens it (anchored to the ⋯).
  const openFromRow = (_e: MouseEvent<HTMLElement>) => {
    if (moreRef.current) present.showMenu(moreRef.current, items());
  };
  const actionable = !isSelf && !busy;

  return (
    <Row
      className="m-adm-row m-adm-g32"
      leading={<Avatar src={user.image_path || null} name={name} size={40} />}
      onPress={actionable ? openFromRow : undefined}
      trailing={
        isSelf ? (
          <span className="m-adm-cap2">{t('admin.you')}</span>
        ) : busy ? (
          <Spinner />
        ) : (
          <MoreMenu items={items} ariaLabel={name} btnRef={moreRef} />
        )
      }
    >
      <div className="m-adm-vstack m-adm-gap2 m-adm-pad4">
        <div className="m-adm-line">
          <span className="m-adm-body17 m-adm-1l">{name}</span>
          {isAdmin && <AdminBadge text={t('admin.roleAdmin')} color="var(--accent)" />}
          {!user.is_active && <AdminBadge text={t('admin.users.blocked')} color="var(--danger)" />}
        </div>
        <div className="m-adm-cap m-adm-1l">@{user.username}</div>
        <div className="m-adm-cap2 m-adm-1l">{user.email}</div>
      </div>
    </Row>
  );
}
