// Persistent device-идентификатор. Хранится в localStorage, генерится один раз
// при первом запуске на этом устройстве/браузере. Передаётся в /auth/login,
// /auth/register и /auth/refresh — сервер сохраняет его в Session, чтобы
// различать сессии за одним публичным IP с одинаковым User-Agent (например,
// два MacBook'а с Chrome из одной квартиры).
//
// Это НЕ механизм fingerprinting'а — мы сами кладём UUID, ничего не
// «снимаем» с устройства. Юзер может очистить localStorage и получить новый ID.

const DEVICE_ID_KEY = 'cord_device_id';
const DEVICE_NAME_KEY = 'cord_device_name';

function uuid(): string {
  // crypto.randomUUID — есть везде в современных браузерах (Chrome 92+, Safari 15.4+).
  // Fallback на случай старых браузеров — не криптостойкий, но достаточно
  // уникальный для нашей задачи (различение устройств одного юзера).
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Стабильный UUID этого устройства. Создаётся при первом вызове. */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = uuid();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    // localStorage недоступен (приватный режим Safari со старыми настройками)
    // — отдаём одноразовый UUID, без persistence.
    return uuid();
  }
}

/** Имя устройства по умолчанию: «Chrome · macOS». Юзер может переименовать. */
export function getDefaultDeviceName(): string {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const browser =
    /edg\//i.test(ua) ? 'Edge' :
    /chrome\//i.test(ua) && !/edg\//i.test(ua) ? 'Chrome' :
    /firefox\//i.test(ua) ? 'Firefox' :
    /safari\//i.test(ua) && !/chrome\//i.test(ua) ? 'Safari' :
    'Browser';
  const os =
    /android/i.test(ua) ? 'Android' :
    /iphone|ipad|ipod/i.test(ua) ? 'iOS' :
    /windows/i.test(ua) ? 'Windows' :
    /mac os/i.test(ua) ? 'macOS' :
    /linux/i.test(ua) ? 'Linux' :
    'OS';
  return `${browser} · ${os}`;
}

/** Локально-выбранное имя устройства (если юзер его переименовал в UI). */
export function getDeviceName(): string {
  try {
    return localStorage.getItem(DEVICE_NAME_KEY) || getDefaultDeviceName();
  } catch {
    return getDefaultDeviceName();
  }
}

export function setDeviceName(name: string): void {
  try {
    localStorage.setItem(DEVICE_NAME_KEY, name.slice(0, 100));
  } catch { /* noop */ }
}
