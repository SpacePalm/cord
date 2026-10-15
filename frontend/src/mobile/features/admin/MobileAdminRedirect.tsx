import { Navigate, useSearchParams } from 'react-router-dom';
import { queueMobileRoutes } from '../../nav/NavStack';
import type { AdminTab } from '../../nav/routes';

// iOS has no admin "page": Admin is pushed from Settings. A phone opening /admin lands on
// /app with Settings → Admin already pushed. Desktop deep links use ?tab=users|groups|security|system.
const TABS: Record<string, AdminTab> = { users: 'users', groups: 'servers', servers: 'servers', security: 'security', system: 'system' };

let queued = false;

export function MobileAdminRedirect() {
  const [params] = useSearchParams();
  if (!queued) {
    queued = true;
    const tab = TABS[params.get('tab') ?? ''];
    queueMobileRoutes([{ name: 'settings' }, tab ? { name: 'admin', tab } : { name: 'admin' }]);
    setTimeout(() => { queued = false; }, 0);
  }
  return <Navigate to="/app" replace />;
}
