// iOS AdminSecurityTab: fixed segmented band (Настройки / Блоки / Аккаунты / Журнал) above one List
// (scroll offset kept across segments), shared status message on top (successes auto-hide after 3s).
// Settings = fail2ban draft form (Save/Cancel row only when dirty); Blocks = IP block list (show expired, search,
// immediate unblock) + manual block form (duration Menu picker); Accounts = locked users (button-only unlock);
// Log = AuthLogSection. Data: settings → blocks → locked loaded sequentially on every tab entry.
import { useEffect, useRef, useState } from 'react';
import {
  adminAuthApi,
  type Fail2banSettings,
  type IpBlockEntry,
  type LockedUser,
} from '../../../api/adminAuth';
import { CordButton, ListSection, PickerRow, Row, SegmentedControl, Spinner, ToggleRow } from '../../ui';
import { useMT, useMobileLocale } from '../../i18n';
import {
  AdminBadge,
  AdminList,
  AdminMessageSection,
  BLOCK_DURATIONS,
  CenterSpinnerRow,
  FieldRow,
  IconButton,
  MutedTextRow,
  NumberFieldRow,
  TextButton,
  apiErrorText,
  relativeLikeIOS,
  useAlive,
  useBusySet,
  useTransientMessage,
} from './adminSupport';
import { AuthLogSection } from './AdminSecurityLog';

type Section = 'settings' | 'blocks' | 'locked' | 'log';
type NumField = Exclude<keyof Fail2banSettings, 'enabled'>;

const NUM_FIELDS: { field: NumField; key: string }[] = [
  { field: 'attempts_per_ip', key: 'admin.security.attemptsPerIp' },
  { field: 'attempts_per_account', key: 'admin.security.attemptsPerAccount' },
  { field: 'window_seconds', key: 'admin.security.windowSeconds' },
  { field: 'ip_block_seconds', key: 'admin.security.ipBlockSeconds' },
  { field: 'account_lock_seconds', key: 'admin.security.accountLockSeconds' },
  { field: 'log_retention_days', key: 'admin.security.logRetentionDays' },
  { field: 'ip_block_retention_days', key: 'admin.security.ipBlockRetentionDays' },
];

/** `Fail2banForm()` server defaults (never visible: the spinner row shows until the first load). */
const DEFAULT_FORM: Fail2banSettings = {
  enabled: true,
  attempts_per_ip: 10,
  attempts_per_account: 5,
  window_seconds: 300,
  ip_block_seconds: 3600,
  account_lock_seconds: 1800,
  log_retention_days: 30,
  ip_block_retention_days: 30,
};

function pickForm(s: Fail2banSettings): Fail2banSettings {
  return {
    enabled: s.enabled,
    attempts_per_ip: s.attempts_per_ip,
    attempts_per_account: s.attempts_per_account,
    window_seconds: s.window_seconds,
    ip_block_seconds: s.ip_block_seconds,
    account_lock_seconds: s.account_lock_seconds,
    log_retention_days: s.log_retention_days,
    ip_block_retention_days: s.ip_block_retention_days,
  };
}

function sameForm(a: Fail2banSettings, b: Fail2banSettings): boolean {
  return a.enabled === b.enabled && NUM_FIELDS.every(({ field }) => a[field] === b[field]);
}

export function AdminSecurityTab() {
  const t = useMT();
  const locale = useMobileLocale();
  const alive = useAlive();
  const { message, show } = useTransientMessage();
  const [section, setSection] = useState<Section>('settings');

  // settings
  const [settings, setSettings] = useState<Fail2banSettings | null>(null);
  const [form, setForm] = useState<Fail2banSettings>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const dirty = settings ? !sameForm(pickForm(settings), form) : false;

  // blocks
  const [blocks, setBlocks] = useState<IpBlockEntry[]>([]);
  const [showExpired, setShowExpired] = useState(false);
  const [blockSearch, setBlockSearch] = useState('');
  const [loadingBlocks, setLoadingBlocks] = useState(true);
  const [newIp, setNewIp] = useState('');
  const [newReason, setNewReason] = useState('');
  const [newDuration, setNewDuration] = useState(BLOCK_DURATIONS[0].key);
  const [creating, setCreating] = useState(false);
  const blockBusy = useBusySet();
  const blocksGen = useRef(0);
  const showExpiredRef = useRef(showExpired);
  showExpiredRef.current = showExpired;

  // locked users
  const [locked, setLocked] = useState<LockedUser[]>([]);
  const [lockedSearch, setLockedSearch] = useState('');
  const [loadingLocked, setLoadingLocked] = useState(true);
  const lockedBusy = useBusySet();

  const loadBlocks = async (expired = showExpiredRef.current) => {
    const g = ++blocksGen.current;
    setLoadingBlocks(true);
    try {
      const list = await adminAuthApi.blocks(!expired);
      if (alive.current && g === blocksGen.current) setBlocks(list);
    } catch {
      if (alive.current && g === blocksGen.current) show(t('admin.loadFailed'), true);
    } finally {
      if (alive.current && g === blocksGen.current) setLoadingBlocks(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const s = await adminAuthApi.getSettings();
        if (!alive.current) return;
        setSettings(s);
        setForm(pickForm(s));
      } catch {
        if (alive.current) show(t('admin.loadFailed'), true);
      }
      if (!alive.current) return;
      await loadBlocks(false);
      if (!alive.current) return;
      setLoadingLocked(true);
      try {
        const list = await adminAuthApi.lockedUsers();
        if (alive.current) setLocked(list);
      } catch {
        if (alive.current) show(t('admin.loadFailed'), true);
      } finally {
        if (alive.current) setLoadingLocked(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveSettings = async () => {
    setSaving(true);
    try {
      const s = await adminAuthApi.updateSettings(form);
      if (!alive.current) return;
      setSettings(s);
      setForm(pickForm(s));
      show(t('admin.security.settingsSaved'), false);
    } catch (e) {
      if (alive.current) show(apiErrorText(e, t('admin.actionFailed')), true);
    } finally {
      if (alive.current) setSaving(false);
    }
  };

  const createBlock = async () => {
    const ip = newIp.replace(/^[ \t]+|[ \t]+$/g, '');
    if (!ip || creating) return;
    setCreating(true);
    try {
      const reason = newReason.replace(/^[ \t]+|[ \t]+$/g, '');
      const seconds = BLOCK_DURATIONS.find((d) => d.key === newDuration)?.seconds ?? null;
      await adminAuthApi.createBlock({
        ip,
        ...(reason ? { reason } : null),
        ...(seconds != null ? { duration_seconds: seconds } : null),
      });
      if (!alive.current) return;
      setNewIp('');
      setNewReason('');
      await loadBlocks();
    } catch (e) {
      if (alive.current) show(apiErrorText(e, t('admin.actionFailed')), true);
    } finally {
      if (alive.current) setCreating(false);
    }
  };

  const unblock = async (b: IpBlockEntry) => {
    blockBusy.add(b.ip);
    try {
      await adminAuthApi.deleteBlock(b.ip);
      if (alive.current) setBlocks((list) => list.filter((x) => x.ip !== b.ip));
    } catch (e) {
      if (alive.current) show(apiErrorText(e, t('admin.actionFailed')), true);
    } finally {
      if (alive.current) blockBusy.remove(b.ip);
    }
  };

  const unlock = async (u: LockedUser) => {
    lockedBusy.add(u.user_id);
    try {
      await adminAuthApi.unlockUser(u.user_id);
      if (alive.current) setLocked((list) => list.filter((x) => x.user_id !== u.user_id));
    } catch (e) {
      if (alive.current) show(apiErrorText(e, t('admin.actionFailed')), true);
    } finally {
      if (alive.current) lockedBusy.remove(u.user_id);
    }
  };

  const bq = blockSearch.replace(/^[ \t]+|[ \t]+$/g, '').toLowerCase();
  const filteredBlocks = bq
    ? blocks.filter(
        (b) => b.ip.toLowerCase().includes(bq) || (b.reason ?? '').toLowerCase().includes(bq) || (b.blocked_by ?? '').toLowerCase().includes(bq),
      )
    : blocks;
  const lq = lockedSearch.replace(/^[ \t]+|[ \t]+$/g, '').toLowerCase();
  const filteredLocked = lq
    ? locked.filter((u) => u.username.toLowerCase().includes(lq) || (u.email ?? '').toLowerCase().includes(lq))
    : locked;

  const settingsSection = (
    <ListSection header={t('admin.security.settingsSection')}>
      {!settings ? (
        <CenterSpinnerRow />
      ) : (
        <>
          <ToggleRow title={t('admin.security.enabled')} checked={form.enabled} onChange={(v) => setForm((f) => ({ ...f, enabled: v }))} />
          {NUM_FIELDS.map(({ field, key }) => (
            <NumberFieldRow
              key={field}
              title={t(key)}
              value={form[field]}
              onChange={(n) => setForm((f) => ({ ...f, [field]: n }))}
              width={90}
              locale={locale}
            />
          ))}
          {dirty && (
            <Row>
              <div className="m-adm-dirty">
                <CordButton disabled={saving} onPress={() => void saveSettings()} style={{ flex: '1 1 auto', width: 'auto', minWidth: 0 }}>
                  {t('common.save')}
                </CordButton>
                <button
                  type="button"
                  className="m-adm-cancel"
                  disabled={saving}
                  onClick={() => settings && setForm(pickForm(settings))}
                >
                  {t('common.cancel')}
                </button>
                {saving && <Spinner />}
              </div>
            </Row>
          )}
        </>
      )}
    </ListSection>
  );

  const blocksSections = (
    <>
      <ListSection
        header={t('admin.security.blocksSection')}
        headerAccessory={loadingBlocks ? undefined : <span>{t('admin.security.blocksCount', filteredBlocks.length)}</span>}
      >
        <ToggleRow
          title={t('admin.security.showExpired')}
          checked={showExpired}
          onChange={(v) => {
            setShowExpired(v);
            void loadBlocks(v);
          }}
        />
        <FieldRow placeholder={t('admin.security.blockSearch')} value={blockSearch} onChange={setBlockSearch} />
        {loadingBlocks ? (
          <CenterSpinnerRow />
        ) : filteredBlocks.length === 0 ? (
          <MutedTextRow text={t('admin.security.noBlocks')} />
        ) : (
          filteredBlocks.map((b) => (
            <Row
              key={b.ip}
              className="m-adm-row m-adm-g28"
              trailing={
                blockBusy.busy.has(b.ip) ? (
                  <Spinner />
                ) : (
                  <IconButton icon="trash" ariaLabel={`${t('admin.security.unblock')} ${b.ip}`} onPress={() => void unblock(b)} />
                )
              }
            >
              <div className="m-adm-vstack m-adm-gap2 m-adm-pad2">
                <div className="m-adm-line">
                  <span className="m-adm-sub15 ios-mono m-adm-1l">{b.ip}</span>
                  {b.blocked_by === 'manual' ? (
                    <AdminBadge text={t('admin.security.manual')} color="var(--accent)" />
                  ) : (
                    <AdminBadge text={t('admin.security.auto')} color="var(--text-muted)" />
                  )}
                </div>
                {!!b.reason && <div className="m-adm-cap2 m-adm-1l">{b.reason}</div>}
                <div className="m-adm-cap2">
                  {b.expires_at
                    ? t('admin.security.expires', relativeLikeIOS(b.expires_at, locale))
                    : t('admin.security.permanent')}
                </div>
              </div>
            </Row>
          ))
        )}
      </ListSection>

      <ListSection header={t('admin.security.addBlock')}>
        <FieldRow placeholder={t('admin.security.ipPlaceholder')} value={newIp} onChange={setNewIp} />
        <FieldRow placeholder={t('admin.security.reasonPlaceholder')} value={newReason} onChange={setNewReason} />
        <PickerRow
          title={t('admin.security.duration')}
          value={newDuration}
          options={BLOCK_DURATIONS.map((d) => ({ value: d.key, label: t(d.key) }))}
          onChange={setNewDuration}
        />
        <Row>
          <CordButton
            disabled={creating || !newIp.replace(/^[ \t]+|[ \t]+$/g, '')}
            onPress={() => void createBlock()}
            className={creating ? 'm-adm-btn-busy' : undefined}
          >
            {creating ? (
              <>
                <span>{t('admin.security.block')}</span>
                <Spinner />
              </>
            ) : (
              t('admin.security.block')
            )}
          </CordButton>
        </Row>
      </ListSection>
    </>
  );

  const lockedSection = (
    <ListSection
      header={t('admin.security.lockedSection')}
      headerAccessory={loadingLocked ? undefined : <span>{t('admin.security.lockedCount', filteredLocked.length)}</span>}
    >
      <FieldRow placeholder={t('admin.security.lockedSearch')} value={lockedSearch} onChange={setLockedSearch} />
      {loadingLocked ? (
        <CenterSpinnerRow />
      ) : filteredLocked.length === 0 ? (
        <MutedTextRow text={t('admin.security.noLocked')} />
      ) : (
        filteredLocked.map((u) => (
          <Row
            key={u.user_id}
            className="m-adm-row m-adm-g28"
            trailing={
              lockedBusy.busy.has(u.user_id) ? (
                <Spinner />
              ) : (
                <TextButton color="var(--accent)" onPress={() => void unlock(u)}>
                  {t('admin.security.unlock')}
                </TextButton>
              )
            }
          >
            <div className="m-adm-vstack m-adm-gap2 m-adm-pad2">
              <div className="m-adm-sub15 m-adm-1l">{u.username}</div>
              <div className="m-adm-cap2 m-adm-1l">{u.email}</div>
              <div className="m-adm-cap2">
                {t('admin.security.lockedUntil', relativeLikeIOS(u.locked_until, locale)) +
                  ' · ' +
                  t('admin.security.failedCount', u.failed_attempts)}
              </div>
            </div>
          </Row>
        ))
      )}
    </ListSection>
  );

  return (
    <>
      <div className="m-adm-segband">
        <SegmentedControl
          value={section}
          onChange={setSection}
          options={[
            { value: 'settings', label: t('admin.security.secSettings') },
            { value: 'blocks', label: t('admin.security.secBlocks') },
            { value: 'locked', label: t('admin.security.secLocked') },
            { value: 'log', label: t('admin.security.secLog') },
          ]}
        />
      </div>
      <AdminList>
        <AdminMessageSection message={message} />
        {section === 'settings' && settingsSection}
        {section === 'blocks' && blocksSections}
        {section === 'locked' && lockedSection}
        {section === 'log' && <AuthLogSection onBlocksChanged={() => void loadBlocks()} />}
      </AdminList>
    </>
  );
}
