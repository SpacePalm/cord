// iOS JoinInviteSheet: paste a link or code → «Найти» → preview card (name + members)
// → «Присоединиться» → reload groups → dismiss (no navigation into the server). The form is shared with
// the /invite/:code page (MobileInvitePage).
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { groupsApi } from '../../../api/groups';
import { SheetScreen } from '../../nav/Screen';
import { BarTextButton } from '../../nav/BarButton';
import { present, type SheetCtx } from '../../present/PresentationProvider';
import { CordButton, CordField } from '../../ui';
import { useMT } from '../../i18n';
import { userMessage } from './data';
import './groups.css';

export interface JoinInviteSheetProps extends SheetCtx {
  initialCode?: string;
}

/** iOS `code`: trimmed input; after "/invite/" up to the first "/", "?" or "#". */
export function extractInviteCode(input: string): string {
  const trimmed = input.trim();
  const i = trimmed.indexOf('/invite/');
  if (i >= 0) {
    const rest = trimmed.slice(i + '/invite/'.length);
    const m = /^[^/?#]*/.exec(rest);
    return m ? m[0] : '';
  }
  return trimmed;
}

interface Preview {
  group_name: string;
  member_count: number;
}

export interface JoinInviteFormProps {
  initialCode?: string;
  /** Run the lookup on mount when `initialCode` is set (deep-link page / prefilled sheet). */
  autoLookup?: boolean;
  /**
   * Join handler override (the deep-link page redirects logged-out users to /login). Return false to
   * stop (no success callback).
   */
  beforeJoin?: (code: string) => boolean;
  /** Called after a successful join (groups already invalidated). */
  onJoined: () => void | Promise<void>;
}

export function JoinInviteForm({ initialCode, autoLookup, beforeJoin, onJoined }: JoinInviteFormProps) {
  const t = useMT();
  const qc = useQueryClient();
  const [input, setInput] = useState(initialCode ?? '');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const code = extractInviteCode(input);
  const live = useRef({ code, busy });
  live.current = { code, busy };

  const lookup = async () => {
    const c = live.current.code;
    if (live.current.busy || !c) return;
    live.current.busy = true;
    setBusy(true);
    setErrorText(null);
    try {
      const p = await groupsApi.getInvite(encodeURIComponent(c));
      if (live.current.code === c) setPreview(p);
    } catch (e) {
      // non-API errors fall back to the localized default too (JoinInviteSheet.swift:76-78)
      setErrorText(userMessage(e, t('invite.lookupFailed')));
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    const c = live.current.code;
    if (live.current.busy || !c) return;
    if (beforeJoin && !beforeJoin(c)) return;
    live.current.busy = true;
    setBusy(true);
    setErrorText(null);
    try {
      await groupsApi.joinByInvite(encodeURIComponent(c));
      await qc.invalidateQueries({ queryKey: ['groups'] });
      setBusy(false);
      await onJoined();
    } catch (e) {
      setErrorText(userMessage(e, t('invite.joinFailed')));
      setBusy(false);
    }
  };

  useEffect(() => {
    if (autoLookup && initialCode) void lookup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="m-grp-form" style={{ gap: 16 }}>
      <CordField
        label={t('invite.linkLabel')}
        placeholder={t('invite.linkPlaceholder')}
        value={input}
        onChange={(v) => {
          setInput(v);
          setPreview(null);
          setErrorText(null);
        }}
        enterKeyHint="done"
        onSubmit={() => (document.activeElement as HTMLElement | null)?.blur?.()}
      />
      {preview ? (
        <>
          <div className="m-grp-invite-card">
            <div className="m-grp-invite-card-name">{preview.group_name}</div>
            <div className="m-grp-hint">{t('invite.members', preview.member_count)}</div>
          </div>
          <CordButton busy={busy} onPress={() => void join()}>
            {t('invite.joinAction')}
          </CordButton>
        </>
      ) : (
        <CordButton busy={busy} disabled={!code} onPress={() => void lookup()}>
          {t('invite.lookup')}
        </CordButton>
      )}
      {errorText && <div className="m-grp-error">{errorText}</div>}
    </div>
  );
}

export function JoinInviteSheet({ initialCode, dismiss }: JoinInviteSheetProps) {
  const t = useMT();
  return (
    <SheetScreen
      title={t('invite.title')}
      trailing={
        <BarTextButton prominent onPress={() => void dismiss()}>
          {t('common.close')}
        </BarTextButton>
      }
    >
      <JoinInviteForm initialCode={initialCode} autoLookup={!!initialCode} onJoined={() => dismiss()} />
    </SheetScreen>
  );
}

/** Convenience: present the sheet. */
export function openJoinInvite(initialCode?: string): void {
  present.presentSheet((ctx) => <JoinInviteSheet {...ctx} initialCode={initialCode} />);
}
