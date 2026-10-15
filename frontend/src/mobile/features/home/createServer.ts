// iOS MainView create-server alert.
// "Новый сервер" alert with a text field ("Название"), "Создать сервер" / "Отмена". Fire-and-forget:
// the alert closes at once, POST /groups runs in the background without a busy state, then groups and
// DMs reload (+ WS reconnect like desktop so the new server's chats are subscribed). No navigation to
// the new server. Failure → Main's error section.
import { groupsApi } from '../../../api/groups';
import { present } from '../../present/PresentationProvider';
import { mt } from '../../i18n';
import { displayDetail, isApiLikeError } from '../auth/authErrors';
import { trimWhitespaces } from '../auth/session';
import { getShellCtx, reloadLists, setCreateServerError } from './homeData';

async function createServer(name: string): Promise<void> {
  const trimmed = trimWhitespaces(name);
  if (!trimmed) return; // iOS silently ignores an empty name
  try {
    await groupsApi.create(trimmed);
  } catch (e) {
    // iOS: APIError → displayDetail ?? server.createFailed; anything else → localizedDescription
    setCreateServerError(
      isApiLikeError(e) ? displayDetail(e) ?? mt('server.createFailed') : e instanceof Error ? e.message : String(e),
    );
    return;
  }
  const ctx = getShellCtx();
  if (!ctx) return;
  ctx.reconnect();
  await reloadLists(ctx.qc);
}

/** "Новый сервер" alert with a text field (header "+" menu; also sessionStore.openCreateServer bridge). */
export function openCreateServerAlert(): void {
  present.alert({
    title: mt('server.createTitle'),
    textField: { placeholder: mt('channels.namePlaceholder'), initial: '', maxLength: 100 },
    actions: [
      { label: mt('server.create'), onPress: (value) => void createServer(value) },
      { label: mt('pollComposer.cancel'), role: 'cancel' },
    ],
  });
}
