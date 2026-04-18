import { useEffect, useState } from 'react';

// Кэш сессии: оригинальный URL → blob: URL
// Живёт до перезагрузки страницы, не ревокается — приемлемо для чата
const blobCache = new Map<string, string>();

/**
 * Загружает файл с авторизационным заголовком и возвращает blob: URL.
 * Используется для вложений сообщений, доступных только участникам группы.
 *
 * @param url  URL вложения (/api/media/messages/...)
 * @returns    blob: URL или '' пока загружается
 */
export function useProtectedUrl(url: string): string {
  const [src, setSrc] = useState<string>(() => blobCache.get(url) ?? '');

  useEffect(() => {
    if (blobCache.has(url)) {
      setSrc(blobCache.get(url)!);
      return;
    }

    let cancelled = false;
    const token = localStorage.getItem('access_token');

    fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        const blobUrl = URL.createObjectURL(blob);
        blobCache.set(url, blobUrl);
        setSrc(blobUrl);
      })
      .catch(() => {
        if (!cancelled) setSrc('');
      });

    return () => { cancelled = true; };
  }, [url]);

  return src;
}

/**
 * Трансформирует URL вложения в защищённый API URL.
 * /media/messages/… → /api/media/messages/…
 * Остальные пути (аватары) не меняются.
 */
export function toProtectedUrl(url: string): string {
  if (url.startsWith('/media/messages/')) {
    return '/api' + url;
  }
  return url;
}
