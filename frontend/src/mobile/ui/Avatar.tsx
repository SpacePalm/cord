// RemoteAvatar (Media/MediaViews.swift): accent circle with WHITE bold initials
// (size*0.4) = first two grapheme clusters, uppercased. The initials stay visible while the image loads and
// when it fails; a loaded image replaces them without a fade (bg-input behind transparent pixels).
import './ui.css';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { prefixGraphemes } from './text';
import { StatusDot } from './StatusDot';

/** First two grapheme clusters, uppercased (Swift `String(name.prefix(2)).uppercased()`). */
export function initials(name: string): string {
  // iOS: an empty name gives an empty accent circle (no "?" placeholder); tolerate null/undefined from API data
  return prefixGraphemes(name ?? '', 2).toUpperCase();
}

export interface AvatarProps {
  /** Public image path (e.g. /media/avatars/…) or null → accent circle with white initials. */
  src?: string | null;
  name: string;
  size: number;
  className?: string;
  style?: CSSProperties;
  // additions
  /** Overlay content positioned by the caller (rendered outside the clipped circle). */
  children?: ReactNode;
  /**
   * StatusDot overlay at the bottom-trailing corner, like `.overlay(alignment: .bottomTrailing) { StatusDot(...)
   * .offset(x: o, y: o) }` — e.g. own profile {size:13, ring:'var(--bg-secondary)', offset:2}, DM rows
   * {size:10, offset:1}, members {size:11, offset:1}.
   */
  statusDot?: { status?: string | null; isOnline: boolean; size?: number; ring?: string; offset?: number };
}

export function Avatar({ src, name, size, className, style, children: extra, statusDot }: AvatarProps) {
  const children =
    extra || statusDot ? (
      <>
        {extra}
        {statusDot && (
          <StatusDot
            status={statusDot.status}
            isOnline={statusDot.isOnline}
            size={statusDot.size ?? 11}
            ring={statusDot.ring}
            style={{ position: 'absolute', right: -(statusDot.offset ?? 0), bottom: -(statusDot.offset ?? 0) }}
          />
        )}
      </>
    ) : null;
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const loaded = !!src && loadedSrc === src;
  const circle = (
    <span
      className={'ios-avatar' + (loaded ? ' is-loaded' : '') + (className && !children ? ` ${className}` : '')}
      style={{ width: size, height: size, fontSize: size * 0.4, ...(children ? undefined : style) }}
      aria-hidden
    >
      <span className="ios-avatar-initials">{initials(name)}</span>
      {src && (
        <img
          key={src}
          className="ios-avatar-img"
          src={src}
          alt=""
          draggable={false}
          decoding="async"
          loading="lazy"
          onLoad={() => setLoadedSrc(src)}
          onError={() => setLoadedSrc((cur) => (cur === src ? null : cur))}
        />
      )}
    </span>
  );
  if (!children) return circle;
  return (
    <span
      className={className}
      style={{ position: 'relative', display: 'inline-flex', flex: 'none', width: size, height: size, verticalAlign: 'middle', ...style }}
    >
      {circle}
      {children}
    </span>
  );
}
