// iOS `AuthedAsyncImage` (Media/MediaViews.swift): token-gated image.
//  loading → default spinner centred on --bg-input (min-height 120)
//  failure → Label("Не удалось загрузить", photo) caption --text-muted on --bg-input (min-height 80)
//  loaded  → the image; tap → `onPress` (e.g. the full-screen viewer).
//  (shared with actions: Media grid — pass `placeholder="plain"` for a bare --bg-input tile).
import './message.css';
import { useEffect, useState, type CSSProperties } from 'react';
import { Icon, Spinner } from '../../ui';
import { useMT } from '../../i18n';
import { needsAuth, toAuthedUrl, useProtectedResource } from './media';

export interface AuthedImageProps {
  url: string;
  alt?: string;
  /** object-fit (default 'cover'). */
  fit?: 'cover' | 'contain';
  style?: CSSProperties;
  className?: string;
  /** Tap (e.g. open the full-screen viewer). Disabled while loading / on failure. */
  onPress?: () => void;
  // additions
  /**
   * 'default' = iOS AuthedAsyncImage placeholders (spinner box ≥120px / failure label ≥80px);
   * 'plain' = an empty --bg-input box with the caller's size in both states (Media grid tiles).
   */
  placeholder?: 'default' | 'plain';
  /** Notified when the load state changes. */
  onStatusChange?: (status: 'loading' | 'ok' | 'error') => void;
}

const HIDDEN: CSSProperties = { position: 'absolute', opacity: 0, pointerEvents: 'none', width: 1, height: 1 };

export function AuthedImage({ url, alt, fit = 'cover', style, className, onPress, placeholder = 'default', onStatusChange }: AuthedImageProps) {
  const t = useMT();
  const key = toAuthedUrl(url);
  // Public URLs (avatars, external og:images) need no token → plain <img>.
  const direct = !needsAuth(key) && !key.startsWith('blob:') && !key.startsWith('data:');
  const res = useProtectedResource(direct ? null : key);
  const src = direct ? key : res.src;
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);

  const failed = (!direct && res.status === 'error') || (!!src && brokenSrc === src);
  const loaded = !failed && !!src && loadedSrc === src;
  const status: 'loading' | 'ok' | 'error' = failed ? 'error' : loaded ? 'ok' : 'loading';

  useEffect(() => {
    onStatusChange?.(status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const plain = placeholder === 'plain';
  const cls = (base: string) => base + (plain ? ' is-plain' : '') + (className ? ` ${className}` : '');

  if (failed) {
    return (
      <div className={cls('m-msg-aimg-ph is-failed')} style={style} role="img" aria-label={t('media.loadFailed')}>
        {plain ? null : (
          <>
            <Icon name="photo" size={15} />
            <span>{t('media.loadFailed')}</span>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      {src && (
        <img
          key={src}
          src={src}
          alt={alt ?? ''}
          draggable={false}
          decoding="async"
          className={'m-msg-aimg' + (className ? ` ${className}` : '')}
          style={loaded ? { objectFit: fit, ...style } : HIDDEN}
          onLoad={() => setLoadedSrc(src)}
          onError={() => setBrokenSrc(src)}
          onClick={
            onPress && loaded
              ? (e) => {
                  e.stopPropagation();
                  onPress();
                }
              : undefined
          }
        />
      )}
      {!loaded && (
        <div className={cls('m-msg-aimg-ph')} style={style} aria-busy>
          {plain ? null : <Spinner />}
        </div>
      )}
    </>
  );
}
