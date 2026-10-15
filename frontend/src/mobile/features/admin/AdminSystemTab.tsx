// iOS AdminSystemTab: registration toggle (optimistic + rollback, footer follows the value),
// statistics (2-column stat cards + decimal disk sizes, refresh in the header, failed reload wipes the stats),
// data cleanup (days, include toggles, two destructive rows → one confirmation anchored to the row), shared
// status message card at the bottom.
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { adminApi, type DiskStats } from '../../../api/admin';
import { ListSection, Row, Spinner, ToggleRow } from '../../ui';
import { usePresent } from '../../present/PresentationProvider';
import { useMT, useMobileLocale } from '../../i18n';
import {
  AdminList,
  AdminMessageSection,
  AdminStatCard,
  CenterSpinnerRow,
  HeaderRefreshButton,
  MutedTextRow,
  NumberFieldRow,
  apiErrorText,
  bytesLikeIOS,
  useAlive,
  useTransientMessage,
} from './adminSupport';

type CleanupKind = 'messages' | 'attachments';

export function AdminSystemTab() {
  const t = useMT();
  const locale = useMobileLocale();
  const present = usePresent();
  const alive = useAlive();
  const { message, show } = useTransientMessage();

  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [updatingRegistration, setUpdatingRegistration] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [stats, setStats] = useState<DiskStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [days, setDays] = useState(90);
  const [includePersonal, setIncludePersonal] = useState(false);
  const [includeDm, setIncludeDm] = useState(false);
  const [cleaningMessages, setCleaningMessages] = useState(false);
  const [cleaningAttachments, setCleaningAttachments] = useState(false);
  const updatingRef = useRef(false);
  const statsGen = useRef(0);

  const loadStats = async () => {
    const g = ++statsGen.current;
    setStatsLoading(true);
    let s: DiskStats | null = null;
    try {
      s = await adminApi.getStats();
    } catch {
      s = null; // `stats = try? …` — a failed reload wipes the shown stats
    }
    if (!alive.current || g !== statsGen.current) return;
    setStats(s);
    setStatsLoading(false);
  };

  useEffect(() => {
    (async () => {
      setSettingsLoading(true);
      try {
        const s = await adminApi.getSettings();
        if (alive.current) setRegistrationEnabled(s.registration_enabled);
      } catch {
        if (alive.current) show(t('admin.loadFailed'), true);
      } finally {
        if (alive.current) setSettingsLoading(false);
      }
      if (alive.current) await loadStats();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setRegistration = async (enabled: boolean) => {
    if (updatingRef.current) return;
    updatingRef.current = true;
    setRegistrationEnabled(enabled); // optimistic
    setUpdatingRegistration(true);
    try {
      const s = await adminApi.updateSettings({ registration_enabled: enabled });
      if (alive.current) setRegistrationEnabled(s.registration_enabled);
    } catch (e) {
      if (alive.current) {
        setRegistrationEnabled(!enabled); // rollback
        show(apiErrorText(e, t('admin.actionFailed')), true);
      }
    } finally {
      updatingRef.current = false;
      if (alive.current) setUpdatingRegistration(false);
    }
  };

  const runCleanup = async (kind: CleanupKind) => {
    if (kind === 'messages' && days < 1) return;
    const setBusy = kind === 'messages' ? setCleaningMessages : setCleaningAttachments;
    setBusy(true);
    try {
      const r =
        kind === 'messages'
          ? await adminApi.cleanupMessages(days, includePersonal, includeDm)
          : await adminApi.cleanupAttachments();
      if (!alive.current) return;
      show(t('admin.system.cleanupDone', r.deleted ?? 0), false);
      void loadStats();
    } catch (e) {
      if (alive.current) show(apiErrorText(e, t('admin.actionFailed')), true);
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const askCleanup = (kind: CleanupKind, e: MouseEvent<HTMLElement>) => {
    let title: string;
    if (kind === 'messages') {
      title = t('admin.system.cleanupMessagesConfirm', days);
      if (includePersonal || includeDm) title += '\n' + t('admin.system.cleanupScopeNote');
    } else {
      title = t('admin.system.cleanupAttachmentsConfirm');
    }
    present.confirm({
      title,
      anchor: (e.currentTarget as HTMLElement).closest('.ios-row') as HTMLElement | null,
      actions: [
        { label: t('common.delete'), role: 'destructive', onPress: () => void runCleanup(kind) },
        { label: t('common.cancel'), role: 'cancel' },
      ],
    });
  };

  const msgDisabled = cleaningMessages || days < 1;

  return (
    <AdminList>
      <ListSection
        header={t('admin.system.registrationSection')}
        footer={t(registrationEnabled ? 'admin.system.registrationOpen' : 'admin.system.registrationClosed')}
      >
        {settingsLoading ? (
          <Row title={t('admin.system.registration')} trailing={<Spinner />} />
        ) : (
          <ToggleRow
            title={t('admin.system.registration')}
            checked={registrationEnabled}
            disabled={updatingRegistration}
            onChange={(v) => void setRegistration(v)}
          />
        )}
      </ListSection>

      <ListSection
        header={t('admin.stats.section')}
        headerAccessory={<HeaderRefreshButton ariaLabel={t('admin.stats.section')} disabled={statsLoading} onPress={() => void loadStats()} />}
      >
        {statsLoading ? (
          <CenterSpinnerRow />
        ) : stats ? (
          <>
            <Row>
              <div className="m-adm-stats">
                <AdminStatCard value={String(stats.db.users)} label={t('admin.stats.users')} />
                <AdminStatCard value={String(stats.db.groups)} label={t('admin.stats.servers')} />
                <AdminStatCard value={String(stats.db.messages)} label={t('admin.stats.messages')} />
                <AdminStatCard value={String(stats.db.attachments)} label={t('admin.stats.attachments')} />
              </div>
            </Row>
            <DiskRow label={t('admin.stats.diskTotal')} value={bytesLikeIOS(stats.disk.total_bytes, locale)} bold />
            <DiskRow label={t('admin.stats.diskAvatars')} value={bytesLikeIOS(stats.disk.avatars_bytes, locale)} />
            <DiskRow label={t('admin.stats.diskGroupAvatars')} value={bytesLikeIOS(stats.disk.group_avatars_bytes, locale)} />
            <DiskRow label={t('admin.stats.diskMessages')} value={bytesLikeIOS(stats.disk.message_files_bytes, locale)} />
          </>
        ) : (
          <MutedTextRow text={t('admin.loadFailed')} />
        )}
      </ListSection>

      <ListSection header={t('admin.system.cleanupSection')} footer={t('admin.system.cleanupNote')}>
        <NumberFieldRow
          title={t('admin.system.olderThan')}
          value={days}
          onChange={setDays}
          width={70}
          placeholder="90"
          unit={t('admin.system.days')}
          locale={locale}
        />
        <ToggleRow title={t('admin.system.includePersonal')} checked={includePersonal} onChange={setIncludePersonal} />
        <ToggleRow title={t('admin.system.includeDm')} checked={includeDm} onChange={setIncludeDm} />
        <DestructiveRow
          title={t('admin.system.cleanupMessages')}
          disabled={msgDisabled}
          busy={cleaningMessages}
          onPress={(e) => askCleanup('messages', e)}
        />
        <DestructiveRow
          title={t('admin.system.cleanupAttachments')}
          disabled={cleaningAttachments}
          busy={cleaningAttachments}
          onPress={(e) => askCleanup('attachments', e)}
        />
      </ListSection>

      <AdminMessageSection message={message} />
    </AdminList>
  );
}

/** `HStack { label ; Spacer ; bytes }` — total: body semibold primary; parts: subheadline muted. */
function DiskRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  const style = bold
    ? { fontSize: 17, lineHeight: '22px', fontWeight: 600, color: 'var(--text-primary)' }
    : { fontSize: 15, lineHeight: '20px', fontWeight: 400, color: 'var(--text-muted)' };
  return (
    <Row
      className="m-adm-row"
      title={label}
      titleStyle={style}
      trailing={
        <span className="m-adm-disk-value" style={style}>
          {value}
        </span>
      }
    />
  );
}

/** `Button(role: .destructive)` row: systemRed text, whole row tappable; disabled → tertiary label; spinner trailing. */
function DestructiveRow({
  title,
  disabled,
  busy,
  onPress,
}: {
  title: string;
  disabled: boolean;
  busy: boolean;
  onPress: (e: MouseEvent<HTMLElement>) => void;
}) {
  return (
    <Row
      title={title}
      titleColor={disabled ? 'var(--ios-label-3)' : 'var(--ios-red)'}
      onPress={disabled ? undefined : onPress}
      trailing={busy ? <Spinner /> : undefined}
      ariaLabel={title}
    />
  );
}
