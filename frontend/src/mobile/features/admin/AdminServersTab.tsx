// iOS AdminServersTab: client-side instant search, server rows (disclosure chevron · Avatar 40 ·
// name + "Владелец @x · N участн. · M кан."), tap = expand members inline (loaded once per tab lifetime), member
// kick (immediate) and ⋯ → "Удалить сервер" with a confirmation anchored to the row. Errors replace the list with
// the error card (iOS quirk).
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { adminApi, type AdminGroup, type AdminMember } from '../../../api/admin';
import { Avatar, Icon, ListSection, Row, Spinner } from '../../ui';
import { usePresent, type MenuItem } from '../../present/PresentationProvider';
import { useMT } from '../../i18n';
import {
  AdminBadge,
  AdminList,
  AdminMessageSection,
  CenterSpinnerRow,
  IconButton,
  MoreMenu,
  MutedTextRow,
  SearchSection,
  apiErrorText,
  useAlive,
  useBusySet,
} from './adminSupport';

export function AdminServersTab() {
  const t = useMT();
  const present = usePresent();
  const alive = useAlive();

  const [search, setSearch] = useState('');
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [members, setMembers] = useState<Record<string, AdminMember[]>>({});
  const [loadingMembers, setLoadingMembers] = useState<ReadonlySet<string>>(() => new Set());
  const { busy, add, remove } = useBusySet();

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const list = await adminApi.getGroups();
        if (alive.current) setGroups(list);
      } catch (e) {
        if (alive.current) setError(apiErrorText(e, t('admin.loadFailed')));
      } finally {
        if (alive.current) setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? groups.filter((g) => g.name.toLowerCase().includes(q) || (g.owner_username ?? '').toLowerCase().includes(q))
    : groups;

  const loadMembers = async (g: AdminGroup) => {
    setLoadingMembers((s) => new Set(s).add(g.id));
    try {
      const list = await adminApi.getGroupMembers(g.id);
      if (alive.current) setMembers((m) => ({ ...m, [g.id]: list }));
    } catch {
      if (!alive.current) return;
      setMembers((m) => ({ ...m, [g.id]: [] }));
      setError(t('admin.loadFailed'));
    } finally {
      if (alive.current)
        setLoadingMembers((s) => {
          const n = new Set(s);
          n.delete(g.id);
          return n;
        });
    }
  };

  const toggle = (g: AdminGroup) => {
    if (expanded.has(g.id)) {
      setExpanded((s) => {
        const n = new Set(s);
        n.delete(g.id);
        return n;
      });
    } else {
      setExpanded((s) => new Set(s).add(g.id));
      if (members[g.id] === undefined && !loadingMembers.has(g.id)) void loadMembers(g);
    }
  };

  const deleteGroup = async (g: AdminGroup) => {
    add(g.id);
    try {
      await adminApi.deleteGroup(g.id);
      if (!alive.current) return;
      setGroups((list) => list.filter((x) => x.id !== g.id));
      setExpanded((s) => {
        const n = new Set(s);
        n.delete(g.id);
        return n;
      });
      setMembers((m) => {
        const n = { ...m };
        delete n[g.id];
        return n;
      });
    } catch (e) {
      if (alive.current) setError(apiErrorText(e, t('admin.actionFailed')));
    } finally {
      if (alive.current) remove(g.id);
    }
  };

  const kick = async (g: AdminGroup, m: AdminMember) => {
    add(m.user_id);
    try {
      await adminApi.kickGroupMember(g.id, m.user_id);
      if (!alive.current) return;
      setMembers((all) => ({ ...all, [g.id]: (all[g.id] ?? []).filter((x) => x.user_id !== m.user_id) }));
      setGroups((list) => list.map((x) => (x.id === g.id ? { ...x, member_count: Math.max(0, x.member_count - 1) } : x)));
    } catch (e) {
      if (alive.current) setError(apiErrorText(e, t('admin.actionFailed')));
    } finally {
      if (alive.current) remove(m.user_id);
    }
  };

  const askDelete = (g: AdminGroup, row: HTMLElement | null) => {
    present.confirm({
      title: t('admin.servers.deleteConfirm', g.name),
      anchor: row,
      actions: [
        { label: t('common.delete'), role: 'destructive', onPress: () => void deleteGroup(g) },
        { label: t('common.cancel'), role: 'cancel' },
      ],
    });
  };

  const memberRows = (g: AdminGroup): ReactNode => {
    if (loadingMembers.has(g.id)) return <CenterSpinnerRow key={`${g.id}:loading`} padY={4} />;
    const list = members[g.id];
    if (!list) return null;
    if (list.length === 0)
      return (
        <Row key={`${g.id}:empty`} style={{ paddingLeft: 40 }}>
          <div className="m-adm-cap">{t('admin.servers.noMembers')}</div>
        </Row>
      );
    return list.map((m) => {
      const isOwner = m.user_id === g.owner_id;
      const name = m.display_name || m.username;
      return (
        <Row
          key={`${g.id}:${m.user_id}`}
          className="m-adm-row m-adm-g28"
          style={{ paddingLeft: 40 }}
          leading={<Avatar src={m.image_path || null} name={name} size={28} />}
          leadingGap={10}
          trailing={
            isOwner ? undefined : busy.has(m.user_id) ? (
              <Spinner />
            ) : (
              <IconButton icon="person.fill.xmark" ariaLabel={`@${m.username}`} onPress={() => void kick(g, m)} />
            )
          }
        >
          <div className="m-adm-vstack m-adm-gap1 m-adm-pad2">
            <div className="m-adm-line">
              <span className="m-adm-sub15 m-adm-1l">{name}</span>
              {isOwner && <AdminBadge text={t('admin.roleOwner')} color="var(--accent)" />}
            </div>
            <div className="m-adm-cap2 m-adm-1l">@{m.username}</div>
          </div>
        </Row>
      );
    });
  };

  return (
    <AdminList>
      <SearchSection placeholder={t('admin.servers.searchPlaceholder')} value={search} onChange={setSearch} />
      {loading ? (
        <ListSection clear>
          <CenterSpinnerRow clear />
        </ListSection>
      ) : error ? (
        <AdminMessageSection message={{ text: error, isError: true }} />
      ) : filtered.length === 0 ? (
        <ListSection clear>
          <MutedTextRow text={t('admin.servers.empty')} center />
        </ListSection>
      ) : (
        <ListSection header={t('admin.servers.count', filtered.length)}>
          {filtered.map((g) => (
            <Fragment key={g.id}>
              <ServerRow
                group={g}
                expanded={expanded.has(g.id)}
                busy={busy.has(g.id)}
                onToggle={() => toggle(g)}
                onDelete={(row) => askDelete(g, row)}
              />
              {expanded.has(g.id) ? memberRows(g) : null}
            </Fragment>
          ))}
        </ListSection>
      )}
    </AdminList>
  );
}

function ServerRow({
  group,
  expanded,
  busy,
  onToggle,
  onDelete,
}: {
  group: AdminGroup;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onDelete: (row: HTMLElement | null) => void;
}) {
  const t = useMT();
  const moreRef = useRef<HTMLButtonElement>(null);
  const items: MenuItem[] = [
    {
      label: t('admin.servers.delete'),
      icon: 'trash',
      role: 'destructive',
      onSelect: () => onDelete(moreRef.current?.closest('.ios-row') as HTMLElement | null),
    },
  ];
  return (
    <Row
      className="m-adm-row m-adm-g32"
      onPress={onToggle}
      highlight={false}
      ariaLabel={group.name}
      leading={
        <span className="m-adm-srv-lead">
          <Avatar src={group.image_path || null} name={group.name} size={40} />
          <span className="m-adm-disclosure" aria-hidden>
            <Icon name={expanded ? 'chevron.down' : 'chevron.right'} size={13} strokeWidth={2.25} />
          </span>
        </span>
      }
      trailing={busy ? <Spinner /> : <MoreMenu items={items} ariaLabel={group.name} btnRef={moreRef} />}
    >
      <div className="m-adm-vstack m-adm-gap2 m-adm-pad4">
        <div className="m-adm-body17 m-adm-1l">{group.name}</div>
        <div className="m-adm-cap m-adm-1l">
          {t('admin.servers.meta', group.owner_username ?? '', group.member_count, group.channel_count)}
        </div>
      </div>
    </Row>
  );
}
