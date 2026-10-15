// iOS `EmbedCard` (MessageListView.swift): OG link preview. Card min(260, column) wide, --bg-input, radius
// --radius, 3px square accent bar on the leading edge, padding 8 (+3), VStack(3): site 11 muted 1 line ·
// title 12/600 accent ≤2 lines · description 11 secondary ≤3 lines · og:image ≤232×120 cover radius 6
// (shown only once loaded; its 2px top padding stays). Tap → open the URL.
import './message.css';
import { useState } from 'react';
import type { Message } from '../../../types';

type Embed = Message['embeds'][number];

function validUrl(s: string | null | undefined): string | null {
  if (!s) return null;
  try {
    const u = new URL(s, window.location.href);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

export function EmbedCard({ embed }: { embed: Embed }) {
  const [imgOk, setImgOk] = useState(false);
  const image = validUrl(embed.image);
  const href = validUrl(embed.url);
  return (
    <button
      type="button"
      className="m-msg-embed"
      onClick={(e) => {
        e.stopPropagation();
        if (href) window.open(href, '_blank', 'noopener,noreferrer');
      }}
    >
      <span className="m-msg-embed-bar" aria-hidden />
      <span className="m-msg-embed-stack">
        {embed.site_name ? <span className="m-msg-embed-site">{embed.site_name}</span> : null}
        {embed.title ? <span className="m-msg-embed-title">{embed.title}</span> : null}
        {embed.description ? <span className="m-msg-embed-desc">{embed.description}</span> : null}
        {image ? (
          <span className="m-msg-embed-imgslot">
            <img
              src={image}
              alt=""
              draggable={false}
              referrerPolicy="no-referrer"
              className="m-msg-embed-img"
              style={imgOk ? undefined : { display: 'none' }}
              onLoad={() => setImgOk(true)}
              onError={() => setImgOk(false)}
            />
          </span>
        ) : null}
      </span>
    </button>
  );
}
