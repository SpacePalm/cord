// MediaPanel — side panel for attachments and links

import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Paperclip, Link, Image, FileText } from 'lucide-react';
import { messagesApi } from '../../api/messages';
import { useProtectedUrl, toProtectedUrl } from '../../hooks/useProtectedUrl';
import { useT } from '../../i18n';

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;
const AUDIO_RE = /\.(webm|ogg|mp3|wav|m4a|aac|flac)$/i;

function stripUuid(url: string): string {
  const raw = decodeURIComponent(url.split('/').pop() ?? 'file');
  // Remove UUID prefix: "xxxxxxxx_" or "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx_"
  return raw.replace(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}_/i, '')
            .replace(/^[0-9a-f]{8}_/, '');
}

function ProtectedThumb({ url }: { url: string }) {
  const src = useProtectedUrl(toProtectedUrl(url));
  if (!src) return <div className="w-full aspect-square rounded bg-white/5 animate-pulse" />;
  return (
    <img
      src={src}
      alt={stripUuid(url)}
      className="w-full aspect-square object-cover rounded hover:brightness-90 transition-[filter]"
    />
  );
}

interface MediaPanelProps {
  chatId: string;
  onClose: () => void;
}

const URL_RE = /https?:\/\/[^\s<>"']+/g;

function extractUrls(text: string): string[] {
  return Array.from(text.matchAll(URL_RE), (m) => m[0]);
}

function FileDownloadItem({ url, date }: { url: string; date: string }) {
  const name = stripUuid(url);
  const [progress, setProgress] = useState<number | null>(null);

  const handleDownload = (e: React.MouseEvent) => {
    e.preventDefault();
    if (progress !== null) return;

    const token = localStorage.getItem('access_token');
    const xhr = new XMLHttpRequest();
    xhr.open('GET', toProtectedUrl(url));
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.responseType = 'blob';

    xhr.addEventListener('progress', (ev) => {
      if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
      else setProgress(-1);
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(xhr.response);
        a.download = name;
        a.click();
        URL.revokeObjectURL(a.href);
      }
      setProgress(null);
    });

    xhr.addEventListener('error', () => setProgress(null));
    xhr.addEventListener('abort', () => setProgress(null));

    setProgress(0);
    xhr.send();
  };

  return (
    <div className="flex flex-col gap-0.5">
      <a
        href={toProtectedUrl(url)}
        onClick={handleDownload}
        className="flex items-center gap-2 px-3 py-2 rounded bg-[var(--bg-input)] text-sm text-[var(--accent)] hover:underline cursor-pointer"
      >
        <Paperclip size={14} className="shrink-0" />
        <span className="truncate">{name}</span>
        {progress !== null && progress >= 0 ? (
          <span className="ml-auto text-xs text-[var(--text-muted)] shrink-0">{progress}%</span>
        ) : (
          <span className="ml-auto text-xs text-[var(--text-muted)] shrink-0 whitespace-nowrap">
            {new Date(date).toLocaleDateString()}
          </span>
        )}
      </a>
      {progress !== null && (
        <div className="h-1 rounded-full bg-white/10 overflow-hidden mx-1">
          {progress >= 0 ? (
            <div
              className="h-full bg-[var(--accent)] rounded-full transition-[width] duration-200"
              style={{ width: `${progress}%` }}
            />
          ) : (
            <div className="h-full w-1/3 bg-[var(--accent)] rounded-full animate-[indeterminate_1.2s_ease-in-out_infinite]" />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Images tab ─────────────────────────────────────────────────────

function ImagesTab({ chatId }: { chatId: string }) {
  const t = useT();
  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['media', chatId],
    queryFn: () => messagesApi.media(chatId),
    staleTime: 30_000,
  });

  const images = messages
    .flatMap((m) => m.attachments.map((url) => ({ url, msg: m })))
    .filter(({ url }) => IMAGE_RE.test(url));

  if (isLoading) return <p className="text-center text-sm text-[var(--text-muted)] mt-12">{t('media.loading')}</p>;
  if (!images.length) return <p className="text-center text-sm text-[var(--text-muted)] mt-12">{t('media.empty')}</p>;

  return (
    <div className="p-3">
      <div className="grid grid-cols-3 gap-1">
        {images.map(({ url }) => (
          <button
            key={url}
            onClick={() => {
              const token = localStorage.getItem('access_token');
              fetch(toProtectedUrl(url), { headers: token ? { Authorization: `Bearer ${token}` } : {} })
                .then(r => r.blob()).then(blob => window.open(URL.createObjectURL(blob), '_blank'));
            }}
            className="block focus:outline-none"
          >
            <ProtectedThumb url={url} />
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Files tab ──────────────────────────────────────────────────────

function FilesTab({ chatId }: { chatId: string }) {
  const t = useT();
  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['media', chatId],
    queryFn: () => messagesApi.media(chatId),
    staleTime: 30_000,
  });

  const files = messages
    .flatMap((m) => m.attachments.map((url) => ({ url, msg: m })))
    .filter(({ url }) => !IMAGE_RE.test(url));

  if (isLoading) return <p className="text-center text-sm text-[var(--text-muted)] mt-12">{t('media.loading')}</p>;
  if (!files.length) return <p className="text-center text-sm text-[var(--text-muted)] mt-12">{t('media.empty')}</p>;

  return (
    <div className="p-3 flex flex-col gap-1">
      {files.map(({ url, msg }) => (
        <FileDownloadItem key={url} url={url} date={msg.created_at} />
      ))}
    </div>
  );
}

// ─── Links tab ──────────────────────────────────────────────────────

function LinksTab({ chatId }: { chatId: string }) {
  const t = useT();
  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['links', chatId],
    queryFn: () => messagesApi.links(chatId),
    staleTime: 30_000,
  });

  const links = messages.flatMap((m) =>
    extractUrls(m.content ?? '').map((url) => ({ url, msg: m }))
  );

  if (isLoading) return <p className="text-center text-sm text-[var(--text-muted)] mt-12">{t('media.loading')}</p>;
  if (!links.length) return <p className="text-center text-sm text-[var(--text-muted)] mt-12">{t('media.empty')}</p>;

  return (
    <div className="p-3 flex flex-col gap-1">
      {links.map(({ url, msg }, i) => (
        <a
          key={`${url}-${i}`}
          href={url}
          target="_blank"
          rel="noreferrer"
          className="flex flex-col gap-0.5 px-3 py-2 rounded bg-[var(--bg-input)] hover:bg-[var(--bg-primary)] transition-colors"
        >
          <span className="text-sm text-[var(--accent)] truncate">{url}</span>
          <span className="text-xs text-[var(--text-muted)]">
            {msg.author_display_name} · {new Date(msg.created_at).toLocaleDateString()}
          </span>
        </a>
      ))}
    </div>
  );
}

// ─── Main panel ─────────────────────────────────────────────────────

type Tab = 'images' | 'files' | 'links';

export function MediaPanel({ chatId, onClose }: MediaPanelProps) {
  const t = useT();
  const [tab, setTab] = useState<Tab>('images');

  const tabs: { id: Tab; icon: ReactNode; label: string }[] = [
    { id: 'images', icon: <Image size={14} />, label: t('media.images') },
    { id: 'files',  icon: <FileText size={14} />, label: t('media.files') },
    { id: 'links',  icon: <Link size={14} />, label: t('media.links') },
  ];

  return (
    <div className="w-72 flex flex-col bg-[var(--bg-secondary)] border-l border-[var(--border-color)] h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)] shrink-0">
        <span className="font-semibold text-[var(--text-primary)] text-sm">{t('group.attachments')}</span>
        <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
          <X size={16} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--border-color)] shrink-0">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 py-2 text-[11px] font-medium transition-colors truncate ${
              tab === id
                ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'images' && <ImagesTab chatId={chatId} />}
        {tab === 'files' && <FilesTab chatId={chatId} />}
        {tab === 'links' && <LinksTab chatId={chatId} />}
      </div>
    </div>
  );
}
