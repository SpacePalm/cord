// Attachments & links sheet (MediaLinksView.swift + ChatMediaStore).
// `.searchable(.navigationBarDrawer(.always))` capsule under the bar, segmented Images / Files / Links,
// one store per presentation: Images + Files share the /media pages (50, `before` cursor, dedupe), Links load
// lazily on the first visit. Manual "Загрузить ещё" paging in every tab; load-more stays reachable when the
// current type is empty but pages remain; failed-first-load state with Retry; "Пусто" otherwise.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Message } from '../../../types';
import { messagesApi } from '../../../api/messages';
import { toProtectedUrl } from '../../../hooks/useProtectedUrl';
import { present, type SheetCtx } from '../../present/PresentationProvider';
import { SheetScreen } from '../../nav/Screen';
import { BarTextButton } from '../../nav/BarButton';
import { SearchCapsule, SegmentedControl, Spinner } from '../../ui';
import { useMT, useMobileLocale } from '../../i18n';
import { FileAttachmentChip } from '../message/FileAttachmentChip';
import { openImageViewer } from '../message/ImageViewer';
import { useProtectedResource } from '../message/media';
import { containsCI, displayName, extractUrls, fmtDayMonthYear, isAudioPath, isImagePath } from './shared';
import './actions.css';

export interface MediaLinksSheetProps extends SheetCtx {
  chatId: string;
}

type Tab = 'images' | 'files' | 'links';
const PAGE = 50;

interface Feed {
  messages: Message[];
  loading: boolean;
  hasMore: boolean;
  failed: boolean;
  started: boolean;
}

const EMPTY_FEED: Feed = { messages: [], loading: false, hasMore: true, failed: false, started: false };

/** ChatMediaStore: one paged feed (`/media` or `/links`). */
function usePagedFeed(fetchPage: (before?: string) => Promise<Message[]>) {
  const [feed, setFeed] = useState<Feed>(EMPTY_FEED);
  const ref = useRef(feed);
  ref.current = feed;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const f = ref.current;
    if (f.loading || !f.hasMore) return;
    const before = f.messages[f.messages.length - 1]?.created_at;
    ref.current = { ...f, loading: true, failed: false, started: true };
    setFeed(ref.current);
    try {
      const page = await fetchPage(before);
      if (!alive.current) return;
      setFeed((x) => {
        const seen = new Set(x.messages.map((m) => m.id));
        const next = { ...x, messages: [...x.messages, ...page.filter((m) => !seen.has(m.id))], hasMore: page.length >= PAGE, loading: false };
        ref.current = next;
        return next;
      });
    } catch {
      if (!alive.current) return;
      setFeed((x) => {
        const next = { ...x, failed: true, loading: false };
        ref.current = next;
        return next;
      });
    }
  }, [fetchPage]);

  const start = useCallback(() => {
    if (ref.current.started) return;
    void load();
  }, [load]);

  return { feed, load, start };
}

/** Square tile (MediaGridThumb): bgInput placeholder while loading / on failure; tappable only once loaded. */
function MediaThumb({ path }: { path: string }) {
  const url = toProtectedUrl(path);
  // shared attachment cache (same blob as the feed / viewer; images persist in the Storage-measured cache)
  const src = useProtectedResource(url).src;
  const [loadedSrc, setLoadedSrc] = useState('');
  const loaded = !!src && loadedSrc === src;
  return (
    <button
      type="button"
      className={'m-act-thumb' + (loaded ? ' is-loaded' : '')}
      aria-label={displayName(path)}
      tabIndex={loaded ? 0 : -1}
      onClick={() => {
        if (loaded) openImageViewer(url);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {src && (
        <img
          key={src}
          src={src}
          alt=""
          draggable={false}
          style={{ visibility: loaded ? 'visible' : 'hidden' }}
          onLoad={() => setLoadedSrc(src)}
          onError={() => setLoadedSrc('')}
        />
      )}
    </button>
  );
}

function LoadMore({ hasMore, loading, onPress, row }: { hasMore: boolean; loading: boolean; onPress: () => void; row?: boolean }) {
  const t = useMT();
  if (!hasMore) return null;
  const btn = (
    <button type="button" className={'m-act-loadmore' + (row ? ' is-row' : '')} disabled={loading} onClick={onPress}>
      {loading ? <Spinner /> : t('chat.loadMore')}
    </button>
  );
  return row ? <div className="m-act-plain-row is-loadmore">{btn}</div> : btn;
}

export function MediaLinksSheet({ chatId, dismiss }: MediaLinksSheetProps) {
  const t = useMT();
  const locale = useMobileLocale();
  const [tab, setTab] = useState<Tab>('images');
  const [search, setSearch] = useState('');

  const fetchMedia = useCallback((before?: string) => messagesApi.media(chatId, before), [chatId]);
  const fetchLinks = useCallback((before?: string) => messagesApi.links(chatId, before), [chatId]);
  const media = usePagedFeed(fetchMedia);
  const links = usePagedFeed(fetchLinks);

  // media on appear, links on the first visit of the Links tab
  const startMedia = media.start;
  const startLinks = links.start;
  useEffect(() => {
    startMedia();
  }, [startMedia]);
  useEffect(() => {
    if (tab === 'links') startLinks();
  }, [tab, startLinks]);

  const matches = (path: string) => !search || containsCI(displayName(path), search);
  const all = media.feed.messages.flatMap((m) => m.attachments);
  const images = all.filter(isImagePath).filter(matches);
  const files = all.filter((p) => !isImagePath(p) && !isAudioPath(p)).filter(matches);
  const linkItems = links.feed.messages
    .flatMap((m) => {
      const author = m.author_display_name || m.author_username;
      return extractUrls(m.content).map((url, i) => ({ id: `${m.id}-${i}`, url, author, date: m.created_at }));
    })
    .filter((it) => !search || containsCI(it.url, search) || containsCI(it.author, search));

  const wrap = (f: Feed, itemsEmpty: boolean, retry: () => void, content: () => ReactNode) => {
    const sourceEmpty = f.messages.length === 0;
    // before the first request starts (first frame) behave as loading
    if ((f.loading || !f.started) && sourceEmpty)
      return (
        <div className="m-act-center no-top">
          <Spinner />
        </div>
      );
    if (f.failed && sourceEmpty)
      return (
        <div className="m-act-center no-top">
          <div className="m-act-muted">{t('media.loadFailed')}</div>
          <button type="button" className="m-act-textbtn" onClick={retry}>
            {t('common.retry')}
          </button>
        </div>
      );
    if (itemsEmpty && !f.hasMore)
      return (
        <div className="m-act-center no-top">
          <div className="m-act-muted">{t('media.empty')}</div>
        </div>
      );
    return content();
  };

  const loadMedia = () => void media.load();
  const loadLinks = () => void links.load();

  let body: ReactNode;
  if (tab === 'images') {
    body = wrap(media.feed, images.length === 0, loadMedia, () => (
      <div className="m-act-scroll no-top" key="images">
        <div className="m-act-grid">
          {images.map((p, i) => (
            <MediaThumb key={`${p}-${i}`} path={p} />
          ))}
        </div>
        <LoadMore hasMore={media.feed.hasMore} loading={media.feed.loading} onPress={loadMedia} />
      </div>
    ));
  } else if (tab === 'files') {
    body = wrap(media.feed, files.length === 0, loadMedia, () => (
      <div className="m-act-scroll no-top" key="files">
        {files.map((p, i) => (
          <div className="m-act-plain-row" key={`${p}-${i}`}>
            <FileAttachmentChip url={toProtectedUrl(p)} filename={displayName(p)} />
          </div>
        ))}
        <LoadMore row hasMore={media.feed.hasMore} loading={media.feed.loading} onPress={loadMedia} />
      </div>
    ));
  } else {
    body = wrap(links.feed, linkItems.length === 0, loadLinks, () => (
      <div className="m-act-scroll no-top" key="links">
        {linkItems.map((it) => (
          <div className="m-act-plain-row" key={it.id}>
            <button type="button" className="m-act-link" onClick={() => window.open(it.url, '_blank', 'noopener')}>
              <span className="m-act-link-url">{it.url}</span>
              <span className="m-act-link-meta">
                {it.author} · {fmtDayMonthYear(it.date, locale)}
              </span>
            </button>
          </div>
        ))}
        <LoadMore row hasMore={links.feed.hasMore} loading={links.feed.loading} onPress={loadLinks} />
      </div>
    ));
  }

  return (
    <SheetScreen
      title={t('media.title')}
      trailing={
        <BarTextButton prominent onPress={() => void dismiss()}>
          {t('common.close')}
        </BarTextButton>
      }
      scroll={false}
    >
      <div className="m-act-fill">
        <div className="m-act-head m-act-media-head">
          <SearchCapsule value={search} onChange={setSearch} placeholder={t('media.searchPlaceholder')} placement="drawer" />
          <div className="m-act-media-seg">
            <SegmentedControl<Tab>
              value={tab}
              onChange={setTab}
              options={[
                { value: 'images', label: t('media.images') },
                { value: 'files', label: t('media.files') },
                { value: 'links', label: t('media.links') },
              ]}
            />
          </div>
        </div>
        <div className="m-act-body">{body}</div>
      </div>
    </SheetScreen>
  );
}

/** Presents the attachments & links sheet ("•••" → "Вложения и ссылки"). */
export function openMediaLinks(chatId: string): SheetCtx {
  return present.presentSheet((ctx) => <MediaLinksSheet {...ctx} chatId={chatId} />);
}
