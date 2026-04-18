"""Fetch OpenGraph metadata from URLs."""

import re
import logging
from html.parser import HTMLParser
import httpx

logger = logging.getLogger(__name__)

URL_RE = re.compile(r'https?://[^\s<>"\']+')


class OGParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.og: dict[str, str] = {}
        self.title: str | None = None
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        if tag == 'title':
            self._in_title = True
        if tag == 'meta':
            d = dict(attrs)
            prop = d.get('property', '') or d.get('name', '')
            content = d.get('content', '')
            if prop.startswith('og:') and content:
                self.og[prop[3:]] = content
            elif prop == 'description' and content and 'description' not in self.og:
                self.og['description'] = content

    def handle_data(self, data):
        if self._in_title:
            self.title = data.strip()
            self._in_title = False

    def handle_endtag(self, tag):
        if tag == 'title':
            self._in_title = False


async def fetch_og(url: str) -> dict | None:
    """Fetch OpenGraph data for a URL. Returns dict with title, description, image, url or None."""
    try:
        async with httpx.AsyncClient(timeout=5, follow_redirects=True) as client:
            resp = await client.get(url, headers={'User-Agent': 'Cord/1.0 bot'})
            if resp.status_code != 200:
                return None
            ct = resp.headers.get('content-type', '')
            if 'html' not in ct:
                return None
            # Only parse first 50KB
            text = resp.text[:50_000]
    except Exception as e:
        logger.debug("OG fetch failed for %s: %s", url, e)
        return None

    parser = OGParser()
    try:
        parser.feed(text)
    except Exception:
        return None

    og = parser.og
    title = og.get('title') or parser.title
    if not title:
        return None

    return {
        'url': og.get('url') or url,
        'title': title[:256],
        'description': (og.get('description') or '')[:512],
        'image': og.get('image') or None,
        'site_name': og.get('site_name') or None,
    }


async def extract_embeds(text: str) -> list[dict]:
    """Extract URLs from text and fetch OG data for each (max 3)."""
    urls = URL_RE.findall(text)[:3]
    embeds = []
    for url in urls:
        og = await fetch_og(url)
        if og:
            embeds.append(og)
    return embeds
