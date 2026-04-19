// Синхронизация кросс-девайсных настроек (язык, уведомления, mute чатов)
// через сервер. Базовая логика:
//   - applyServerPreferences(json) — на логине/me, применяем к stores
//   - startPreferencesAutoSync() — подписываемся на изменения stores,
//     debounced отправляем PUT /api/auth/preferences
//
// НЕ синхронизируется: session UI state (выбранная группа/канал, dmMode —
// это per-tab состояние), тема (у неё свой endpoint /auth/theme), per-call
// volumes (voiceSettings localStorage — зависит от конкретных голосовых чатов).

import { useLangStore } from '../i18n';
import { useNotificationStore } from '../store/notificationStore';
import { authApi } from '../api/auth';

// Громкости (soundVolume, ringtoneVolume) намеренно НЕ синкаются —
// они device-specific: телефон/колонки/наушники требуют разных уровней.
interface Preferences {
  lang?: string;
  notifications?: {
    level?: 'all' | 'mentions_dm' | 'dm_only' | 'off';
    sound?: boolean;
    browserEnabled?: boolean;
  };
  mutedChats?: Record<string, boolean>;
}

function collectCurrentPreferences(): Preferences {
  const notif = useNotificationStore.getState();
  return {
    lang: useLangStore.getState().lang,
    notifications: {
      level: notif.level,
      sound: notif.sound,
      browserEnabled: notif.browserEnabled,
    },
    mutedChats: notif.mutedChats,
  };
}

/** Применить preferences с сервера к stores. Вызывается после login/me. */
export function applyServerPreferences(preferencesJson: string | null | undefined): void {
  if (!preferencesJson) return;
  let prefs: Preferences;
  try {
    prefs = JSON.parse(preferencesJson);
  } catch {
    return;
  }

  // На случай если в будущем поменяем структуру — все применения защищены.
  if (prefs.lang && typeof prefs.lang === 'string') {
    const { setLang } = useLangStore.getState();
    setLang(prefs.lang);
  }

  const notif = useNotificationStore.getState();
  const n = prefs.notifications;
  if (n) {
    if (n.level) notif.setLevel(n.level);
    if (typeof n.sound === 'boolean') notif.setSound(n.sound);
    if (typeof n.browserEnabled === 'boolean') notif.setBrowserEnabled(n.browserEnabled);
  }

  // mutedChats — перезаписываем целиком
  if (prefs.mutedChats && typeof prefs.mutedChats === 'object') {
    useNotificationStore.setState({ mutedChats: prefs.mutedChats });
  }
}

// ─── Auto-sync: любое изменение в stores → PUT на сервер (debounced) ──

let _saveTimer: ReturnType<typeof setTimeout> | null = null;
let _lastSent: string | null = null;
let _subscribed = false;

function scheduleSave(): void {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    _saveTimer = null;
    const prefs = collectCurrentPreferences();
    const json = JSON.stringify(prefs);
    // Не шлём если ничего не изменилось с прошлого PUT
    if (json === _lastSent) return;
    try {
      await authApi.savePreferences(prefs);
      _lastSent = json;
    } catch {
      // Сетевой сбой — попытаемся позже при следующем изменении
    }
  }, 800);  // короткое окно чтобы быстро подтянуть в других вкладках/девайсах
}

/** Запустить автосинхронизацию. Идемпотентно — подписки не дублируются. */
export function startPreferencesAutoSync(): void {
  if (_subscribed) return;
  _subscribed = true;

  // Baseline: зафиксировать текущее состояние как «уже отправленное»,
  // чтобы не было пустого PUT сразу после логина.
  _lastSent = JSON.stringify(collectCurrentPreferences());

  useLangStore.subscribe(scheduleSave);
  useNotificationStore.subscribe(scheduleSave);
}
