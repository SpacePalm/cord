// iOS MainView — the root "cord" screen.
// Sections in iOS order: profile → Saved → Servers (+ menu) → Direct messages → error. Large title
// "cord", glass magnifier → QuickSwitcher, "Соединение…" strip while the WebSocket is not open,
// centred spinner on the first load, pull-to-refresh, reload of groups + DMs every time the screen
// re-appears (iOS `.task` on MainView).
import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { groupsApi } from '../../../api/groups';
import { dmsApi } from '../../../api/dms';
import { useAuthStore } from '../../../store/authStore';
import { useUnreadCounts } from '../../../hooks/useUnreadCounts';
import { useWsStatus } from '../../../hooks/useWebSocket';
import { Screen } from '../../nav/Screen';
import { BarButton } from '../../nav/BarButton';
import { useScreenCtx } from '../../nav/NavStack';
import { MenuButton } from '../../present/MenuButton';
import { primeKeyboard } from '../../present/PresentationProvider';
import { Avatar, EmptyRow, ErrorRow, Icon, InsetGroupedList, ListSection, NavRow, Spinner } from '../../ui';
import { useMT } from '../../i18n';
import { openQuickSwitcher } from '../search/QuickSwitcherSheet';
import { openJoinInvite } from '../groups/JoinInviteSheet';
import { displayDetail, isApiLikeError } from '../auth/authErrors';
import { openCreateServerAlert } from './createServer';
import { reloadUnread, useCreateServerError } from './homeData';
import './home.css';

/** GroupsStore.load() failure text: displayDetail ?? groups.loadFailed (non-API → its message). */
function loadErrorText(err: unknown, fallback: string): string {
  if (isApiLikeError(err)) return displayDetail(err) ?? fallback;
  return err instanceof Error ? err.message : fallback;
}

export function HomeScreen() {
  const t = useMT();
  const qc = useQueryClient();
  const { isTop } = useScreenCtx();
  const user = useAuthStore((s) => s.user);
  const wsStatus = useWsStatus();
  const { unreadByChat, unreadByGroup } = useUnreadCounts();
  const createError = useCreateServerError();

  // iOS `.task { groups.load() }` — load on every appearance (mount here, re-appear below)
  const groupsQ = useQuery({ queryKey: ['groups'], queryFn: groupsApi.list, refetchOnMount: 'always' });
  const dmsQ = useQuery({ queryKey: ['dms'], queryFn: dmsApi.list, refetchOnMount: 'always' });
  const refetchGroups = groupsQ.refetch;
  const refetchDms = dmsQ.refetch;

  const wasTop = useRef<boolean | null>(null);
  useEffect(() => {
    if (isTop && wasTop.current === false) {
      void refetchGroups();
      void refetchDms();
    }
    wasTop.current = isTop;
  }, [isTop, refetchGroups, refetchDms]);

  const groups = groupsQ.data ?? [];
  const dms = dmsQ.data ?? [];
  const servers = groups.filter((g) => !g.is_dm && !g.is_personal);
  const saved = groups.find((g) => g.is_personal);
  // GroupsStore.isLoading: true while any load is in flight (empty-state rows hide meanwhile)
  const loading = groupsQ.isFetching || dmsQ.isFetching;
  const firstLoad = loading && groups.length === 0;

  const loadError = groupsQ.error ?? dmsQ.error;
  const errorText =
    createError && createError.at > groupsQ.dataUpdatedAt
      ? createError.text
      : loadError
        ? loadErrorText(loadError, t('groups.loadFailed'))
        : null;

  const onRefresh = () => Promise.allSettled([refetchGroups(), refetchDms(), reloadUnread(qc)]);

  const displayName = user ? user.display_name || user.username : '';
  const statusLine = user ? (user.status_text ? user.status_text : `@${user.username}`) : '';

  return (
    <Screen
      title="cord"
      titleMode="large"
      trailing={
        <BarButton
          icon="magnifyingglass"
          color="var(--text-secondary)"
          ariaLabel={t('palette.title')}
          onPress={() => {
            primeKeyboard();
            openQuickSwitcher();
          }}
        />
      }
      topInset={wsStatus !== 'open' ? <div className="m-home-connecting">{t('main.connecting')}</div> : undefined}
      onRefresh={onRefresh}
    >
      <InsetGroupedList top="large">
        {user && (
          <ListSection>
            <NavRow
              to={{ name: 'settings' }}
              leading={
                <Avatar
                  src={user.image_path || null}
                  name={displayName}
                  size={44}
                  statusDot={{
                    status: user.status,
                    isOnline: user.status !== 'invisible',
                    size: 13,
                    ring: 'var(--bg-secondary)',
                    offset: 2,
                  }}
                />
              }
              leadingGap={12}
              title={displayName}
              titleStyle={{ fontWeight: 600 }}
              subtitle={statusLine}
              subtitleLines={1}
              subtitleStyle={{ fontSize: 15, lineHeight: '18px', color: 'var(--text-secondary)' }}
            />
          </ListSection>
        )}

        {saved && (
          <ListSection>
            <NavRow icon="bookmark.fill" title={t('main.saved')} to={{ name: 'channels', groupId: saved.id }} />
          </ListSection>
        )}

        <ListSection
          header={t('main.servers')}
          headerAccessory={
            <MenuButton
              ariaLabel={t('server.create')}
              items={[
                { label: t('server.create'), icon: 'plus.square', onSelect: () => openCreateServerAlert() },
                { label: t('invite.join'), icon: 'person.badge.plus', onSelect: () => openJoinInvite() },
              ]}
            >
              <span className="m-home-plus">
                <Icon name="plus.circle.fill" size={19.5} />
              </span>
            </MenuButton>
          }
        >
          {servers.length === 0 && !loading && <EmptyRow text={t('main.noServers')} />}
          {servers.map((g) => (
            <NavRow
              key={g.id}
              to={{ name: 'channels', groupId: g.id }}
              leading={<Avatar src={g.image_path || null} name={g.name} size={28} />}
              leadingGap={10}
              title={g.name}
              badge={unreadByGroup[g.id]}
              badgePosition="after"
            />
          ))}
        </ListSection>

        <ListSection header={t('main.directMessages')}>
          {dms.length === 0 && !loading && <EmptyRow text={t('main.empty')} />}
          {dms.map((dm) => {
            const name = dm.peer.display_name || dm.peer.username;
            const unread = unreadByChat[dm.chat_id] ?? 0;
            const preview = dm.last_message;
            return (
              <NavRow
                key={dm.chat_id}
                to={{ name: 'chat', chatId: dm.chat_id, title: name, groupId: dm.group_id }}
                leading={
                  <Avatar
                    src={dm.peer.image_path || null}
                    name={name}
                    size={28}
                    statusDot={{
                      status: dm.peer.status,
                      isOnline: dm.peer.is_online,
                      size: 10,
                      ring: 'var(--bg-secondary)',
                      offset: 1,
                    }}
                  />
                }
                leadingGap={10}
                title={name}
                subtitle={preview ? preview : undefined}
                subtitleLines={1}
                subtitleStyle={{
                  fontSize: 12,
                  fontWeight: unread > 0 ? 600 : 400,
                  color: unread > 0 ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}
                badge={unread}
                badgePosition="before"
              />
            );
          })}
        </ListSection>

        {errorText && (
          <ListSection>
            <ErrorRow text={errorText} />
          </ListSection>
        )}
      </InsetGroupedList>

      {firstLoad && (
        <div className="m-home-loading" aria-hidden>
          <Spinner />
        </div>
      )}
    </Screen>
  );
}
