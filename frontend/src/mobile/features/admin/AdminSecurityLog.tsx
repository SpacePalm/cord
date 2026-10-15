// iOS AdminAuthLogSection: login-attempt log inside the Security tab — segmented By IP / List,
// filters (350ms debounce → reset load of the current mode), offset pagination via an explicit "Загрузить ещё"
// row, grouped rows with inline expand + block Menu (5 durations) / unblock. Reset loads keep the rows when the
// list is non-empty (spinner only over an empty list); errors are silent. Mounted only while the Log segment is
// active (filters/mode reset on every entry, like iOS).
import { useEffect, useRef, useState } from 'react';
import { adminAuthApi, type AuthLogEntry, type GroupedIp } from '../../../api/adminAuth';
import { Icon, ListSection, PickerRow, Row, SegmentedControl, Spinner } from '../../ui';
import { MenuButton } from '../../present/MenuButton';
import { useMT, useMobileLocale } from '../../i18n';
import {
  AdminBadge,
  BLOCK_DURATIONS,
  CenterSpinnerRow,
  FieldRow,
  HeaderRefreshButton,
  LoadMoreRow,
  MutedTextRow,
  TextButton,
  dateTimeShort,
  relativeLikeIOS,
  useAlive,
  useBusySet,
} from './adminSupport';

type Mode = 'grouped' | 'list';
type SuccessFilter = 'fail' | 'success' | 'all';

const LIST_PAGE = 50;
const GROUPED_PAGE = 30;

export function AuthLogSection({ onBlocksChanged }: { onBlocksChanged?: () => void }) {
  const t = useMT();
  const locale = useMobileLocale();
  const alive = useAlive();

  const [mode, setMode] = useState<Mode>('grouped');

  // list view
  const [entries, setEntries] = useState<AuthLogEntry[]>([]);
  const [ipFilter, setIpFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [successFilter, setSuccessFilter] = useState<SuccessFilter>('fail');
  const [loadingList, setLoadingList] = useState(false);
  const [loadingMoreList, setLoadingMoreList] = useState(false);
  const [canMoreList, setCanMoreList] = useState(false);
  const loadedList = useRef(false);

  // grouped view
  const [groups, setGroups] = useState<GroupedIp[]>([]);
  const [groupSearch, setGroupSearch] = useState('');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const groupBusy = useBusySet();
  const [loadingGrouped, setLoadingGrouped] = useState(false);
  const [loadingMoreGrouped, setLoadingMoreGrouped] = useState(false);
  const [canMoreGrouped, setCanMoreGrouped] = useState(false);

  const listGen = useRef(0);
  const groupedGen = useRef(0);
  /** Debounced filter reload per mode (pending ⇔ timer set). */
  const filterTimer = useRef<Record<Mode, number | null>>({ grouped: null, list: null });
  /** A reset (page 0) load of that mode is in flight. */
  const resetting = useRef<Record<Mode, boolean>>({ grouped: false, list: false });

  // async loaders read the latest state (iOS reads @State at execution time)
  const S = useRef({ entries, groups, ipFilter, userFilter, successFilter, groupSearch, mode });
  S.current = { entries, groups, ipFilter, userFilter, successFilter, groupSearch, mode };

  const loadGrouped = async (reset: boolean) => {
    // "Load more" while the filter changed (debounce pending) or a reset is in flight would append a page
    // of the NEW query at the OLD list's offset (or be dropped by the reset) — wait for the reset instead.
    if (!reset && (resetting.current.grouped || filterTimer.current.grouped != null)) return;
    if (reset) resetting.current.grouped = true;
    const gen = ++groupedGen.current;
    const cur = S.current;
    if (reset) setLoadingGrouped(cur.groups.length === 0);
    else setLoadingMoreGrouped(true);
    const offset = reset ? 0 : cur.groups.length;
    try {
      const page = await adminAuthApi.logGrouped({
        q: cur.groupSearch.trim() || undefined,
        limit: GROUPED_PAGE,
        offset: offset > 0 ? offset : undefined,
      });
      if (!alive.current || gen !== groupedGen.current) return;
      setGroups((old) => (reset ? page : [...old, ...page]));
      setCanMoreGrouped(page.length === GROUPED_PAGE);
    } catch {
      if (!alive.current || gen !== groupedGen.current) return;
      if (reset) setGroups([]);
    } finally {
      if (gen === groupedGen.current) resetting.current.grouped = false;
      if (alive.current && gen === groupedGen.current) {
        setLoadingGrouped(false);
        setLoadingMoreGrouped(false);
      }
    }
  };

  const loadList = async (reset: boolean) => {
    if (!reset && (resetting.current.list || filterTimer.current.list != null)) return; // see loadGrouped
    if (reset) resetting.current.list = true;
    loadedList.current = true;
    const gen = ++listGen.current;
    const cur = S.current;
    if (reset) setLoadingList(cur.entries.length === 0);
    else setLoadingMoreList(true);
    const offset = reset ? 0 : cur.entries.length;
    try {
      const page = await adminAuthApi.log({
        ip: cur.ipFilter.trim() || undefined,
        username: cur.userFilter.trim() || undefined,
        success: cur.successFilter === 'all' ? undefined : cur.successFilter === 'success',
        limit: LIST_PAGE,
        offset: offset > 0 ? offset : undefined,
      });
      if (!alive.current || gen !== listGen.current) return;
      setEntries((old) => (reset ? page : [...old, ...page]));
      setCanMoreList(page.length === LIST_PAGE);
    } catch {
      if (!alive.current || gen !== listGen.current) return;
      if (reset) setEntries([]);
    } finally {
      if (gen === listGen.current) resetting.current.list = false;
      if (alive.current && gen === listGen.current) {
        setLoadingList(false);
        setLoadingMoreList(false);
      }
    }
  };

  const debounce = (m: Mode, op: () => void) => {
    const prev = filterTimer.current[m];
    if (prev != null) window.clearTimeout(prev);
    filterTimer.current[m] = window.setTimeout(() => {
      filterTimer.current[m] = null;
      if (alive.current) op();
    }, 350);
  };

  useEffect(() => {
    void loadGrouped(true);
    return () => {
      const timers = filterTimer.current;
      for (const m of ['grouped', 'list'] as const) {
        if (timers[m] != null) window.clearTimeout(timers[m]!);
        timers[m] = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeMode = (m: Mode) => {
    setMode(m);
    if (m === 'list' && !loadedList.current) void loadList(true);
    else if (m === 'grouped') void loadGrouped(true);
  };

  const refreshCurrent = () => {
    if (S.current.mode === 'grouped') void loadGrouped(true);
    else void loadList(true);
  };

  const toggle = (ip: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(ip)) n.delete(ip);
      else n.add(ip);
      return n;
    });

  const blockGrouped = async (g: GroupedIp, seconds: number | null) => {
    groupBusy.add(g.ip);
    try {
      await adminAuthApi.createBlock({
        ip: g.ip,
        reason: t('admin.security.autoReason', g.failed),
        ...(seconds != null ? { duration_seconds: seconds } : null),
      });
      onBlocksChanged?.();
      await loadGrouped(true);
    } catch {
      /* silent (iOS): the log is re-read manually */
    } finally {
      if (alive.current) groupBusy.remove(g.ip);
    }
  };

  const unblockGrouped = async (ip: string) => {
    groupBusy.add(ip);
    try {
      await adminAuthApi.deleteBlock(ip);
      onBlocksChanged?.();
      await loadGrouped(true);
    } catch {
      /* silent */
    } finally {
      if (alive.current) groupBusy.remove(ip);
    }
  };

  const successOptions: { value: SuccessFilter; label: string }[] = [
    { value: 'fail', label: t('admin.security.filterFail') },
    { value: 'success', label: t('admin.security.filterSuccess') },
    { value: 'all', label: t('admin.security.filterAll') },
  ];

  const header = (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {mode === 'grouped' && groups.length > 0 && (
        <span>{t('admin.security.groupedCount', `${groups.length}${canMoreGrouped ? '+' : ''}`)}</span>
      )}
      <HeaderRefreshButton ariaLabel={t('admin.security.logSection')} disabled={loadingGrouped || loadingList} onPress={refreshCurrent} />
    </span>
  );

  return (
    <>
      <ListSection header={t('admin.security.logSection')} headerAccessory={header}>
        <Row>
          <SegmentedControl
            style={{ width: '100%' }}
            value={mode}
            onChange={changeMode}
            options={[
              { value: 'grouped', label: t('admin.security.viewGrouped') },
              { value: 'list', label: t('admin.security.viewList') },
            ]}
          />
        </Row>
        {mode === 'grouped' ? (
          <FieldRow
            placeholder={t('admin.security.logSearchIp')}
            value={groupSearch}
            onChange={(v) => {
              setGroupSearch(v);
              debounce('grouped', () => void loadGrouped(true));
            }}
          />
        ) : (
          <>
            <FieldRow
              placeholder={t('admin.security.logSearchIp')}
              value={ipFilter}
              onChange={(v) => {
                setIpFilter(v);
                debounce('list', () => void loadList(true));
              }}
            />
            <FieldRow
              placeholder={t('admin.security.logSearchUser')}
              value={userFilter}
              onChange={(v) => {
                setUserFilter(v);
                debounce('list', () => void loadList(true));
              }}
            />
            <PickerRow
              title={t('admin.security.filterResult')}
              value={successFilter}
              options={successOptions}
              onChange={(v) => {
                setSuccessFilter(v);
                debounce('list', () => void loadList(true));
              }}
            />
          </>
        )}
      </ListSection>

      <ListSection>
        {mode === 'grouped' ? (
          loadingGrouped ? (
            <CenterSpinnerRow />
          ) : groups.length === 0 ? (
            <MutedTextRow text={t('admin.security.noLog')} />
          ) : (
            <>
              {groups.map((g) => (
                <GroupedRow
                  key={g.ip}
                  g={g}
                  expanded={expanded.has(g.ip)}
                  busy={groupBusy.busy.has(g.ip)}
                  locale={locale}
                  onToggle={() => toggle(g.ip)}
                  onBlock={(s) => void blockGrouped(g, s)}
                  onUnblock={() => void unblockGrouped(g.ip)}
                />
              ))}
              {canMoreGrouped && <LoadMoreRow label={t('admin.loadMore')} busy={loadingMoreGrouped} onPress={() => void loadGrouped(false)} />}
            </>
          )
        ) : loadingList ? (
          <CenterSpinnerRow />
        ) : entries.length === 0 ? (
          <MutedTextRow text={t('admin.security.noLog')} />
        ) : (
          <>
            {entries.map((e) => (
              <ListRow key={e.id} e={e} locale={locale} />
            ))}
            {canMoreList && <LoadMoreRow label={t('admin.loadMore')} busy={loadingMoreList} onPress={() => void loadList(false)} />}
          </>
        )}
      </ListSection>
    </>
  );
}

function GroupedRow({
  g,
  expanded,
  busy,
  locale,
  onToggle,
  onBlock,
  onUnblock,
}: {
  g: GroupedIp;
  expanded: boolean;
  busy: boolean;
  locale: string;
  onToggle: () => void;
  onBlock: (seconds: number | null) => void;
  onUnblock: () => void;
}) {
  const t = useMT();
  return (
    <Row>
      <div className="m-adm-grow">
        <div
          className="m-adm-gline is-toggle"
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          onClick={onToggle}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggle();
            }
          }}
        >
          <span className="m-adm-gchev" aria-hidden>
            <Icon name={expanded ? 'chevron.down' : 'chevron.right'} size={12} strokeWidth={2.25} />
          </span>
          <span className="m-adm-sub15 ios-mono m-adm-1l">{g.ip}</span>
          {g.is_blocked && <AdminBadge text={t('admin.users.blocked')} color="var(--danger)" />}
          <span className="m-adm-spacer" style={{ minWidth: 6 }} />
          <span className="m-adm-cap2" style={{ flex: 'none', whiteSpace: 'nowrap' }}>
            {relativeLikeIOS(g.last_at, locale)}
          </span>
        </div>
        <div className="m-adm-gline2">
          <span className="m-adm-cap2 m-adm-1l">{t('admin.security.attemptStats', g.total, g.failed, g.distinct_users)}</span>
          <span className="m-adm-spacer" style={{ minWidth: 6 }} />
          {busy ? (
            <Spinner />
          ) : g.is_blocked ? (
            <TextButton color="var(--accent)" onPress={() => onUnblock()}>
              {t('admin.security.unblock')}
            </TextButton>
          ) : (
            <MenuButton
              items={BLOCK_DURATIONS.map((d) => ({ label: t(d.key), onSelect: () => onBlock(d.seconds) }))}
            >
              <button type="button" className="m-adm-textbtn" style={{ color: 'var(--danger)' }}>
                {t('admin.security.block')}
              </button>
            </MenuButton>
          )}
        </div>
        {expanded &&
          (g.by_user ?? []).map((u, i) => (
            <div className="m-adm-guser" key={i}>
              <span className="m-adm-cap2 m-adm-1l" style={{ color: 'var(--text-secondary)' }}>
                {u.username}
              </span>
              <span className="m-adm-spacer" />
              <span className="m-adm-cap2" style={{ flex: 'none', whiteSpace: 'nowrap' }}>
                {t('admin.security.timesCount', u.count)}
              </span>
            </div>
          ))}
      </div>
    </Row>
  );
}

function ListRow({ e, locale }: { e: AuthLogEntry; locale: string }) {
  const t = useMT();
  return (
    <Row
      className="m-adm-row m-adm-g28"
      trailing={
        <span className="m-adm-cap2" style={{ whiteSpace: 'nowrap' }}>
          {dateTimeShort(e.created_at, locale)}
        </span>
      }
    >
      <div className="m-adm-vstack m-adm-gap2 m-adm-pad2">
        <div className="m-adm-line">
          <span className="m-adm-cap ios-mono m-adm-1l" style={{ color: 'var(--text-primary)' }}>
            {e.ip}
          </span>
          <AdminBadge
            text={t(e.success ? 'admin.security.resultOk' : 'admin.security.resultFail')}
            color={e.success ? 'var(--ios-green)' : 'var(--danger)'}
          />
        </div>
        <div className="m-adm-cap2 m-adm-1l">{e.username_attempted}</div>
      </div>
    </Row>
  );
}
