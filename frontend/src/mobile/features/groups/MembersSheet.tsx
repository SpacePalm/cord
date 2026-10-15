// iOS MembersPanelView: large sheet "Участники" with trailing "Закрыть" (regular weight),
// sections «В сети · N» / «Не в сети · N» (default secondaryLabel header colour), sorted by name; 32px
// avatars with 11px status dots; tapping a row opens the UserActionsMenu (Open chat / Call). Fresh fetch
// on open + 30s polling, failed polls ignored.
import type { MouseEvent } from 'react';
import type { Member } from '../../../types';
import { SheetScreen } from '../../nav/Screen';
import { BarTextButton } from '../../nav/BarButton';
import { present, type SheetCtx } from '../../present/PresentationProvider';
import { useAuthStore } from '../../../store/authStore';
import { Avatar, EmptyRow, InsetGroupedList, ListSection, Row } from '../../ui';
import { useMT } from '../../i18n';
import { useGroupMembers } from './data';
import { openUserActions } from './UserActionsMenu';
import { useRegisterQueryClient } from './queryClientRef';
import './groups.css';

export interface MembersSheetProps extends SheetCtx {
  groupId: string;
}

const byName = (a: Member, b: Member) =>
  (a.display_name || '').localeCompare(b.display_name || '', undefined, { sensitivity: 'base' });

export function MembersSheet({ groupId, dismiss }: MembersSheetProps) {
  const t = useMT();
  useRegisterQueryClient();
  const meId = useAuthStore((s) => s.user?.id);
  const q = useGroupMembers(groupId, { refetchOnMount: 'always', refetchInterval: 30_000 });
  const members = q.data;
  const online = (members ?? []).filter((m) => m.is_online).sort(byName);
  const offline = (members ?? []).filter((m) => !m.is_online).sort(byName);

  const row = (m: Member) => {
    const isSelf = m.user_id === meId;
    return (
      <Row
        key={m.user_id}
        leading={
          <Avatar
            src={m.image_path || null}
            name={m.display_name}
            size={32}
            statusDot={{ status: m.status, isOnline: m.is_online, size: 11, ring: 'var(--bg-secondary)', offset: 1 }}
          />
        }
        leadingGap={10}
        onPress={
          isSelf
            ? undefined
            : (e: MouseEvent<HTMLElement>) =>
                openUserActions(
                  e.currentTarget as HTMLElement,
                  { id: m.user_id, username: m.username, display_name: m.display_name, image_path: m.image_path },
                  { beforeNavigate: () => dismiss() },
                )
        }
        ariaLabel={m.display_name}
      >
        <div className="m-grp-member-line">
          <span className="m-grp-member-name">{m.display_name}</span>
        </div>
        <div className="m-grp-member-sub">{m.status_text ? m.status_text : `@${m.username}`}</div>
      </Row>
    );
  };

  const header = (label: string, n: number) => <span style={{ color: 'var(--ios-label-2)' }}>{`${label} · ${n}`}</span>;

  return (
    <SheetScreen
      title={t('members.title')}
      trailing={<BarTextButton onPress={() => void dismiss()}>{t('common.close')}</BarTextButton>}
    >
      <InsetGroupedList>
        {online.length > 0 && <ListSection header={header(t('members.online'), online.length)}>{online.map(row)}</ListSection>}
        {offline.length > 0 && <ListSection header={header(t('members.offline'), offline.length)}>{offline.map(row)}</ListSection>}
        {members && members.length === 0 && (
          <ListSection>
            <EmptyRow text={t('members.empty')} />
          </ListSection>
        )}
      </InsetGroupedList>
    </SheetScreen>
  );
}

export function openMembersSheet(groupId: string): void {
  present.presentSheet((ctx) => <MembersSheet {...ctx} groupId={groupId} />);
}
