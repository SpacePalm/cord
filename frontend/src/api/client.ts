// HTTP-клиент с автоматическим refresh access-токена при 401.
//
// Жизненный цикл запроса:
// 1. fetch с access_token
// 2. если 401 → попытаться обменять refresh_token на новую пару
// 3. если refresh успешен → retry оригинальный запрос с новым access
// 4. если refresh провалился → handleUnauthorized (logout + redirect /login)
//
// При 403 с blocked_by_security → handleBlocked (redirect /blocked).

import { useAuthStore } from '../store/authStore';
import { getDeviceId, getDeviceName } from '../utils/device';

const BASE_URL = '/api';

function handleUnauthorized(reason?: string) {
  // Помогает диагностировать «меня выкинуло»: в DevTools Console видна причина.
  console.warn('[auth] logout, reason:', reason ?? 'unknown');
  useAuthStore.getState().logout();
  if (window.location.pathname !== '/login') {
    window.location.replace('/login');
  }
}

function handleBlocked(detail: { kind?: string; expires_at?: string | null } | null) {
  useAuthStore.getState().logout();
  const sp = new URLSearchParams();
  if (detail?.kind) sp.set('kind', detail.kind);
  if (detail?.expires_at) sp.set('until', detail.expires_at);
  if (window.location.pathname !== '/blocked') {
    window.location.replace(`/blocked?${sp}`);
  }
}

// ─── Refresh-токен machinery ─────────────────────────────────────────────
//
// Несколько одновременных 401 не должны порождать N независимых /refresh.
// Используем одну общую промизу-инфлайт: первый 401 запускает refresh,
// остальные ждут его результат.

let refreshInflight: Promise<boolean> | null = null;

/**
 * Единственная точка ротации refresh-токена в приложении.
 *
 * Несколько параллельных вызовов СЛИВАЮТСЯ в одну сетевую попытку через
 * shared inflight — но это работает только внутри одной вкладки.
 * Между вкладками shared inflight нет, поэтому добавлен retry-on-stale:
 * если /refresh вернул 401, но в localStorage уже появился новый
 * refresh-token (значит соседняя вкладка успела отротировать), считаем
 * что нас всё ещё авторизованы и переиспользуем её результат.
 *
 * Экспортируется чтобы useWebSocket.tsx и другой код шёл через тот же
 * inflight, а не делал свой /refresh.
 */
export async function tryRefresh(): Promise<boolean> {
  if (refreshInflight) return refreshInflight;

  refreshInflight = (async () => {
    const sentToken = localStorage.getItem('refresh_token');
    if (!sentToken) return false;
    try {
      const r = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refresh_token: sentToken,
          // Передаём device-метку чтобы новая сессия после ротации сохранила
          // идентичность устройства (важно для UI /sessions: «текущее устройство»).
          device_id: getDeviceId(),
          device_name: getDeviceName(),
        }),
      });
      if (r.ok) {
        const data = await r.json();
        // Ротация: пишем оба новых токена и в localStorage, и в Zustand-store.
        useAuthStore.getState().setTokens(data.access_token, data.refresh_token);
        return true;
      }
      // 403 на /refresh = IP/аккаунт забанили fail2ban'ом за время простоя.
      // Юзера надо вести на /blocked со ссылкой на причину, а не на /login.
      if (r.status === 403) {
        try {
          const body = await r.json();
          if (body?.detail?.code === 'blocked_by_security') {
            handleBlocked(body.detail);
            return false;
          }
        } catch { /* не json — игнор */ }
      }
      // Не-ok ответ. Проверяем, не успела ли соседняя вкладка отротировать
      // тот же самый sentToken, пока мы ждали ответ от бэка. Если в
      // localStorage уже лежит ДРУГОЙ refresh-token — значит сосед прошёл
      // первым, у нас уже свежая пара, считаем успехом.
      const current = localStorage.getItem('refresh_token');
      if (current && current !== sentToken) return true;
      return false;
    } catch {
      return false;
    } finally {
      // Сброс через микротик — другие ожидающие 401 уже подхватят результат.
      setTimeout(() => { refreshInflight = null; }, 0);
    }
  })();

  return refreshInflight;
}

// ─── Cross-tab sync ──────────────────────────────────────────────────────
//
// localStorage event срабатывает в ДРУГИХ вкладках того же origin'а.
// Когда одна вкладка обновляет access_token / refresh_token (после /refresh),
// все остальные подхватывают свежие значения в свой Zustand-стор без сетевого
// запроса. Без этого Zustand state соседей продолжает держать старый access
// и в-памяти он расходится с localStorage до следующего перерендера.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (ev) => {
    if (ev.key !== 'access_token' && ev.key !== 'refresh_token') return;
    const access = localStorage.getItem('access_token');
    const refresh = localStorage.getItem('refresh_token');
    if (access && refresh) {
      // Сосед записал свежие токены — обновляем только in-memory Zustand,
      // в localStorage уже актуальные значения, повторно писать незачем.
      useAuthStore.setState({ token: access, refreshToken: refresh });
    } else if (!access && !refresh) {
      // Соседняя вкладка вышла из аккаунта — мы тоже.
      useAuthStore.setState({ user: null, token: null, refreshToken: null });
    }
  });
}

// ─── Error type ──────────────────────────────────────────────────────────

export class ApiError extends Error {
  /** Иногда detail приходит объектом (например fail2ban: {code, kind, expires_at}). */
  public detail: unknown;
  constructor(public status: number, message: string, detail?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.detail = detail;
  }
}

// ─── Core request ────────────────────────────────────────────────────────

async function fetchWithAuth(path: string, options: RequestInit, retried = false): Promise<Response> {
  const token = localStorage.getItem('access_token');

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const response = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  // 401 → пробуем обновить access и сделать ровно один retry.
  // Не trigger'им refresh для самого /auth/refresh (рекурсия) и /auth/login.
  if (response.status === 401 && !retried &&
      !path.startsWith('/auth/refresh') &&
      !path.startsWith('/auth/login')) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      return fetchWithAuth(path, options, true);
    }
  }

  return response;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetchWithAuth(path, options);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    const message = typeof error.detail === 'string'
      ? error.detail
      : (error.detail?.code ?? 'Request failed');
    if (response.status === 401) {
      handleUnauthorized(`${path} → 401 ${typeof error.detail === 'string' ? error.detail : ''}`);
    }
    if (response.status === 403 && typeof error.detail === 'object' && error.detail?.code === 'blocked_by_security') {
      handleBlocked(error.detail);
    }
    throw new ApiError(response.status, message, error.detail);
  }

  if (response.status === 204) return {} as T;
  return response.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// ─── multipart/form-data (file uploads) ──────────────────────────────────

async function fetchFormWithAuth(path: string, form: FormData, retried = false): Promise<Response> {
  const token = localStorage.getItem('access_token');
  const r = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (r.status === 401 && !retried) {
    if (await tryRefresh()) return fetchFormWithAuth(path, form, true);
  }
  return r;
}

export async function postForm<T>(path: string, form: FormData): Promise<T> {
  const response = await fetchFormWithAuth(path, form);

  if (!response.ok) {
    if (response.status === 401) handleUnauthorized();
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    const message = typeof error.detail === 'string'
      ? error.detail
      : (error.detail?.code ?? 'Request failed');
    if (response.status === 403 && typeof error.detail === 'object' && error.detail?.code === 'blocked_by_security') {
      handleBlocked(error.detail);
    }
    throw new ApiError(response.status, message, error.detail);
  }

  if (response.status === 204) return {} as T;
  return response.json() as Promise<T>;
}

// XHR-вариант для прогресса upload'а. Refresh не делается до отправки —
// если access протухнет посреди upload'а, файл просто залит впустую и юзер
// видит ошибку (редкий случай при коротком access TTL и быстром refresh-цикле).
export function postFormWithProgress<T>(
  path: string,
  form: FormData,
  onProgress: (pct: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const sendOnce = (retry: boolean): void => {
      const token = localStorage.getItem('access_token');
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE_URL}${path}`);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      });

      xhr.addEventListener('load', () => {
        if (xhr.status === 401 && !retry) {
          tryRefresh().then((ok) => {
            if (ok) sendOnce(true);
            else { handleUnauthorized(); reject(new ApiError(401, 'Unauthorized')); }
          });
          return;
        }
        if (xhr.status === 401) { handleUnauthorized(); return; }
        if (xhr.status >= 400) {
          const detail = (() => {
            try { return JSON.parse(xhr.responseText)?.detail ?? 'Request failed'; }
            catch { return 'Request failed'; }
          })();
          if (xhr.status === 403 && typeof detail === 'object' && detail?.code === 'blocked_by_security') {
            handleBlocked(detail);
          }
          reject(new ApiError(xhr.status, typeof detail === 'string' ? detail : (detail?.code ?? 'Request failed'), detail));
          return;
        }
        if (xhr.status === 204) { resolve({} as T); return; }
        try { resolve(JSON.parse(xhr.responseText) as T); }
        catch { reject(new ApiError(0, 'Invalid JSON response')); }
      });

      xhr.addEventListener('error', () => reject(new ApiError(0, 'Network error')));
      xhr.addEventListener('abort', () => reject(new ApiError(0, 'Upload aborted')));

      xhr.send(form);
    };
    sendOnce(false);
  });
}
