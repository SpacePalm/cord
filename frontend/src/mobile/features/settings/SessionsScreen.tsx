// iOS SessionsView: "Устройства" list (device icon, title + #tail + "текущая" pill,
// "browser · os · ip · активна: d MMM, HH:mm"), inline rename (pencil → field + ✓/✕, Return = Done), revoke
// capsule → confirmation popover anchored to the ROW, trailing swipe revoke (no confirmation), "Завершить все
// остальные" (alert), pull to refresh, error section. Server is the source of truth: reload after actions.
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Screen } from '../../nav/Screen';
import {
  InsetGroupedList,
  ListSection,
  Row,
  ButtonRow,
  EmptyRow,
  ErrorRow,
  SwipeRow,
  Spinner,
  Icon,
  closeOpenSwipeRow,
} from '../../ui';
import { prefixGraphemes } from '../../ui/text';
import { useMT, useMobileLocale } from '../../i18n';
import { usePresent, primeKeyboard } from '../../present/PresentationProvider';
import { authApi, type SessionInfo } from '../../../api/auth';
import { ApiError } from '../../../api/client';
import { setDeviceName } from '../../../utils/device';
import { apiMessage } from './common';
import './settings.css';

type T = ReturnType<typeof useMT>;

/** Mirrors web/iOS `parseUserAgent` (order matters: Edge before Chrome, iOS before macOS, Android before Linux). */
function parseUA(ua: string, t: T): { browser: string; os: string } {
  const m = (re: RegExp) => re.test(ua);
  const browser = m(/edg\//i)
    ? 'Edge'
    : m(/chrome\//i)
      ? 'Chrome'
      : m(/firefox\//i)
        ? 'Firefox'
        : m(/safari\//i) && !m(/chrome\//i)
          ? 'Safari'
          : t('sessions.unknownBrowser');
  const os = m(/android/i)
    ? 'Android'
    : m(/iphone|ipad|ipod/i)
      ? 'iOS'
      : m(/windows/i)
        ? 'Windows'
        : m(/mac os/i)
          ? 'macOS'
          : m(/linux/i)
            ? 'Linux'
            : t('sessions.unknownOS');
  return { browser, os };
}

const isMobileUA = (ua: string) => /mobile|android|iphone|ipad/i.test(ua);

function sessionTitle(s: SessionInfo, t: T): string {
  const dn = s.device_name?.trim();
  if (dn) return dn;
  const ua = parseUA(s.user_agent ?? '', t);
  return `${ua.browser} · ${ua.os}`;
}

/** DateFormatter "d MMM, HH:mm" in the UI locale (ru "5 окт., 14:03", en "5 Oct, 14:03"). */
function formatActive(iso: string, locale: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).formatToParts(d);
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${month}, ${hh}:${mm}`;
}

function sessionSubtitle(s: SessionInfo, t: T, locale: string): string {
  const ua = parseUA(s.user_agent ?? '', t);
  const parts = [`${ua.browser} · ${ua.os}`, s.ip ? s.ip : '—'];
  const when = formatActive(s.last_used_at, locale);
  if (when) parts.push(t('sessions.active', when));
  return parts.join(' · ');
}

function deviceTail(s: SessionInfo): string | null {
  const id = s.device_id;
  if (!id || id.length < 4) return null;
  return '#' + id.slice(-4);
}

/** Sessions: API error → server text or the specific fallback; anything else → raw message (no prefix). */
function sessionError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return apiMessage(err, fallback);
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** Active sessions (rename, revoke, revoke others). */
export function SessionsScreen() {
  const t = useMT();
  const locale = useMobileLocale();
  const present = usePresent();
  const q = useQuery({ queryKey: ['auth-sessions'], queryFn: authApi.listSessions, refetchOnMount: 'always' });
  const sessions = q.data ?? [];
  const [errorText, setErrorText] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [revokingOthers, setRevokingOthers] = useState(false);
  const tRef = useRef(t);
  tRef.current = t;

  // a successful load clears the error; a failed one shows sessions.loadFailed / the server text
  useEffect(() => {
    if (q.dataUpdatedAt) setErrorText(null);
  }, [q.dataUpdatedAt]);
  useEffect(() => {
    if (q.errorUpdatedAt && q.error) setErrorText(sessionError(q.error, tRef.current('sessions.loadFailed')));
  }, [q.errorUpdatedAt, q.error]);

  const reload = async () => {
    await q.refetch();
  };

  const otherCount = sessions.filter((s) => !s.is_current).length;

  const startEdit = (s: SessionInfo) => {
    primeKeyboard(); // iOS Safari opens the keyboard only for a focus inside the tap
    setEditName(sessionTitle(s, t));
    setEditingId(s.id);
  };

  const saveRename = async (s: SessionInfo) => {
    const name = prefixGraphemes(editName.trim(), 100);
    setEditingId(null);
    // iOS compares with the stored device_name (not the displayed title)
    if (!name || name === (s.device_name ?? '')) return;
    try {
      const updated = await authApi.renameSession(s.id, name);
      // the current device must remember its name, otherwise the next /refresh reverts it
      if (s.is_current || updated.is_current) setDeviceName(updated.device_name || name);
      await reload();
    } catch (err) {
      setErrorText(sessionError(err, t('sessions.renameFailed')));
    }
  };

  const revoke = async (s: SessionInfo) => {
    try {
      await authApi.revokeSession(s.id);
      await reload();
    } catch (err) {
      setErrorText(sessionError(err, t('sessions.revokeFailed')));
    }
  };

  const askRevoke = (s: SessionInfo, e: MouseEvent<HTMLElement>) => {
    closeOpenSwipeRow();
    const row = (e.currentTarget as HTMLElement).closest('.ios-row') as HTMLElement | null;
    present.confirm({
      message: t('sessions.revokeConfirm', sessionTitle(s, t)),
      anchor: row,
      actions: [
        { label: t('sessions.revoke'), role: 'destructive', onPress: () => void revoke(s) },
        { label: t('pollComposer.cancel'), role: 'cancel' },
      ],
    });
  };

  const askRevokeOthers = () => {
    present.alert({
      title: t('sessions.revokeOthersConfirmTitle'),
      message: t('sessions.revokeOthersConfirm'),
      actions: [
        {
          label: t('sessions.revokeOthers'),
          role: 'destructive',
          onPress: async () => {
            if (revokingOthers) return;
            setRevokingOthers(true);
            try {
              await authApi.revokeOtherSessions();
              await reload();
            } catch (err) {
              setErrorText(sessionError(err, t('sessions.revokeOthersFailed')));
            } finally {
              setRevokingOthers(false);
            }
          },
        },
        { label: t('pollComposer.cancel'), role: 'cancel' },
      ],
    });
  };

  const renderRow = (s: SessionInfo) => {
    const editing = editingId === s.id;
    const icon = (
      <span className="m-set-sess-icon">
        <Icon name={isMobileUA(s.user_agent ?? '') ? 'iphone' : 'desktopcomputer'} size={24} />
      </span>
    );
    const row = editing ? (
      <Row
        leading={icon}
        leadingGap={12}
        trailing={
          <span className="m-set-sess-actions">
            <button type="button" className="m-set-icon-btn" aria-label={t('common.save')} style={{ color: 'var(--accent)' }} onClick={() => void saveRename(s)}>
              <Icon name="checkmark" size={22} />
            </button>
            <button type="button" className="m-set-icon-btn" aria-label={t('pollComposer.cancel')} style={{ color: 'var(--text-muted)' }} onClick={() => setEditingId(null)}>
              <Icon name="xmark" size={22} />
            </button>
          </span>
        }
      >
        <input
          className="m-set-sess-input"
          value={editName}
          placeholder={t('sessions.namePlaceholder')}
          aria-label={t('sessions.namePlaceholder')}
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void saveRename(s);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setEditingId(null);
            }
          }}
        />
      </Row>
    ) : (
      <Row
        leading={icon}
        leadingGap={12}
        trailing={
          <span className="m-set-sess-actions">
            <button
              type="button"
              className="m-set-icon-btn"
              aria-label={t('sessions.namePlaceholder')}
              style={{ color: 'var(--text-muted)' }}
              onClick={() => startEdit(s)}
            >
              <Icon name="pencil" size={17} />
            </button>
            {!s.is_current && (
              <button type="button" className="m-set-revoke" onClick={(e) => askRevoke(s, e)}>
                {t('sessions.revoke')}
              </button>
            )}
          </span>
        }
      >
        <div className="m-set-sess-body">
          <div className="m-set-sess-line">
            <span className="m-set-sess-title">{sessionTitle(s, t)}</span>
            {deviceTail(s) && <span className="m-set-sess-tail">{deviceTail(s)}</span>}
            {s.is_current && <span className="m-set-sess-pill">{t('sessions.current')}</span>}
          </div>
          <div className="m-set-sess-sub">{sessionSubtitle(s, t, locale)}</div>
        </div>
      </Row>
    );
    if (s.is_current) return <div key={s.id} className="ios-cell">{row}</div>;
    return (
      <SwipeRow key={s.id} actions={[{ icon: 'trash', label: t('sessions.revoke'), onPress: () => void revoke(s) }]}>
        {row}
      </SwipeRow>
    );
  };

  return (
    <Screen title={t('sessions.title')} onRefresh={reload}>
      <InsetGroupedList>
        <ListSection header={t('sessions.devices')}>
          {sessions.length === 0 && q.isFetching ? (
            <Row>
              <Spinner />
            </Row>
          ) : sessions.length === 0 ? (
            <EmptyRow text={t('sessions.empty')} />
          ) : null}
          {sessions.map(renderRow)}
        </ListSection>

        {otherCount > 0 && (
          <ListSection>
            <ButtonRow
              title={t('sessions.revokeOthers')}
              role="destructive"
              busy={revokingOthers}
              disabled={revokingOthers}
              color={revokingOthers ? 'var(--ios-label-2)' : undefined}
              onPress={askRevokeOthers}
            />
          </ListSection>
        )}

        {errorText && (
          <ListSection>
            <ErrorRow text={errorText} />
          </ListSection>
        )}
      </InsetGroupedList>
    </Screen>
  );
}
