// Базовый API клиент. Автоматически добавляет токен к каждому запросу.
// При 401 — автоматически разлогиниваем и редиректим на /login.

import { useAuthStore } from '../store/authStore';

const BASE_URL = '/api';

function handleUnauthorized() {
  useAuthStore.getState().logout();
  // Используем location.replace чтобы убрать текущий URL из истории
  if (window.location.pathname !== '/login') {
    window.location.replace('/login');
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = localStorage.getItem('access_token');

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    if (response.status === 401) handleUnauthorized();
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new ApiError(response.status, error.detail ?? 'Request failed');
  }

  // 204 No Content — возвращаем пустой объект
  if (response.status === 204) return {} as T;

  return response.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// Для multipart/form-data (загрузка файлов).
// Content-Type НЕ устанавливаем — браузер сам добавит boundary.
export async function postForm<T>(path: string, form: FormData): Promise<T> {
  const token = localStorage.getItem('access_token');
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });

  if (!response.ok) {
    if (response.status === 401) handleUnauthorized();
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new ApiError(response.status, error.detail ?? 'Request failed');
  }

  if (response.status === 204) return {} as T;
  return response.json() as Promise<T>;
}

// То же, но с колбэком прогресса загрузки (0–100).
// Использует XMLHttpRequest — единственный способ отслеживать upload progress.
export function postFormWithProgress<T>(
  path: string,
  form: FormData,
  onProgress: (pct: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const token = localStorage.getItem('access_token');
    const xhr = new XMLHttpRequest();

    xhr.open('POST', `${BASE_URL}${path}`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    });

    xhr.addEventListener('load', () => {
      if (xhr.status === 401) { handleUnauthorized(); return; }
      if (xhr.status >= 400) {
        const detail = (() => {
          try { return JSON.parse(xhr.responseText)?.detail ?? 'Request failed'; }
          catch { return 'Request failed'; }
        })();
        reject(new ApiError(xhr.status, detail));
        return;
      }
      if (xhr.status === 204) { resolve({} as T); return; }
      try { resolve(JSON.parse(xhr.responseText) as T); }
      catch { reject(new ApiError(0, 'Invalid JSON response')); }
    });

    xhr.addEventListener('error', () => reject(new ApiError(0, 'Network error')));
    xhr.addEventListener('abort', () => reject(new ApiError(0, 'Upload aborted')));

    xhr.send(form);
  });
}
