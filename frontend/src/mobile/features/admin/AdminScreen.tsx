// iOS AdminPanelView: inline "Администрирование", custom top tab bar (icon + caption2 label,
// accent selected + 2px bar, --bg-tertiary hairline), only the active tab mounted — every entry recreates the
// tab and reloads its data (iOS `switch` + `.task`).
import { useEffect, useState } from 'react';
import type { AdminTab } from '../../nav/routes';
import { Screen } from '../../nav/Screen';
import { Icon, type SFSymbol } from '../../ui';
import { useMT } from '../../i18n';
import { AdminUsersTab } from './AdminUsersTab';
import { AdminServersTab } from './AdminServersTab';
import { AdminSecurityTab } from './AdminSecurityTab';
import { AdminSystemTab } from './AdminSystemTab';
import './admin.css';

export interface AdminScreenProps {
  tab?: AdminTab;
}

const TABS: { id: AdminTab; key: string; icon: SFSymbol }[] = [
  { id: 'users', key: 'admin.tab.users', icon: 'person.2' },
  { id: 'servers', key: 'admin.tab.servers', icon: 'server.rack' },
  { id: 'security', key: 'admin.tab.security', icon: 'lock.shield' },
  { id: 'system', key: 'admin.tab.system', icon: 'gearshape' },
];

/** Admin panel (inline title "Администрирование", custom top tab bar). */
export function AdminScreen(props: AdminScreenProps) {
  const t = useMT();
  const [tab, setTab] = useState<AdminTab>(props.tab ?? 'users');

  // a deep link (/admin?tab=…) re-targeting an already open admin screen
  useEffect(() => {
    if (props.tab) setTab(props.tab);
  }, [props.tab]);

  return (
    <Screen title={t('admin.title')} scroll={false}>
      <div className="m-adm-root">
        <div className="m-adm-tabs" role="tablist" aria-label={t('admin.title')}>
          {TABS.map((it) => {
            const sel = it.id === tab;
            return (
              <button
                key={it.id}
                type="button"
                role="tab"
                aria-selected={sel}
                className={'m-adm-tab' + (sel ? ' is-selected' : '')}
                onClick={() => setTab(it.id)}
              >
                <span className="m-adm-tab-icon">
                  <Icon name={it.icon} size={19} strokeWidth={2.25} />
                </span>
                <span className="m-adm-tab-label">{t(it.key)}</span>
              </button>
            );
          })}
        </div>
        <div className="m-adm-body" role="tabpanel">
          {tab === 'users' && <AdminUsersTab key="users" />}
          {tab === 'servers' && <AdminServersTab key="servers" />}
          {tab === 'security' && <AdminSecurityTab key="security" />}
          {tab === 'system' && <AdminSystemTab key="system" />}
        </div>
      </div>
    </Screen>
  );
}
