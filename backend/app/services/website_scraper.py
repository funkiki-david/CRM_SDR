"""
Website scraper — fetch homepage + about page text to ground AI Company Reports
in real data instead of letting Claude hallucinate from the company name alone.

Async via httpx. HTML parsed with the stdlib `html.parser` to avoid pulling in
BeautifulSoup just for this.
"""

from __future__ import annotations

import asyncio
import re
from html.parser import HTMLParser
from typing import Optional, Tuple

import httpx


class _TextExtractor(HTMLParser):
    """Collect visible text, skipping <script>/<style>/<nav>/<footer>."""

    SKIP = {"script", "style", "noscript", "nav", "footer", "head"}

    def __init__(self) -> None:
        super().__init__()
        self._stack: list[str] = []
        self._chunks: list[str] = []

    def handle_starttag(self, tag: str, attrs):  # type: ignore[override]
        self._stack.append(tag.lower())

    def handle_endtag(self, tag: str):  # type: ignore[override]
        if self._stack and self._stack[-1] == tag.lower():
            self._stack.pop()

    def handle_data(self, data: str):  # type: ignore[override]
        if any(t in self.SKIP for t in self._stack):
            return
        text = data.strip()
        if text:
            self._chunks.append(text)

    @property
    def text(self) -> str:
        # Collapse whitespace runs
        return re.sub(r"\s+", " ", " ".join(self._chunks)).strip()


def _normalize_domain(value: str) -> Optional[str]:
    """Coerce 'Calitho', 'http://calitho.com/foo', 'CALITHO.COM' → 'calitho.com'."""
    if not value:
        return None
    v = value.strip().lower()
    v = re.sub(r"^https?://", "", v)
    v = re.sub(r"^www\.", "", v)
    v = v.split("/")[0]
    if "." not in v:
        # Bare company name → guess .com
        if re.match(r"^[a-z0-9-]+$", v):
            return f"{v}.com"
        return None
    return v


async def _fetch_text(client: httpx.AsyncClient, url: str, max_chars: int = 3000) -> Optional[str]:
    """GET a single URL, parse to text, cap length. Returns None on error/404."""
    try:
        r = await client.get(url, follow_redirects=True, timeout=5.0)
    except (httpx.RequestError, httpx.TimeoutException):
        return None
    if r.status_code != 200 or not r.headers.get("content-type", "").startswith(("text/html", "application/xhtml")):
        return None
    parser = _TextExtractor()
    try:
        parser.feed(r.text[:200_000])  # parse at most 200KB of HTML
    except Exception:
        return None
    text = parser.text
    return text[:max_chars] if text else None


async def fetch_company_pages(
    company_name: str,
    website_or_domain: Optional[str],
) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """
    Returns (resolved_domain, homepage_text, about_text).

    All three may be None if scraping fails — callers should fall back to
    the AI-only prompt with a warning banner.
    """
    domain = _normalize_domain(website_or_domain or "") or _normalize_domain(company_name or "")
    if not domain:
        return None, None, None

    homepage_url = f"https://{domain}"
    about_paths = ["/about", "/about-us", "/company", "/who-we-are"]

    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; SDR-CRM/1.0)",
        "Accept": "text/html,application/xhtml+xml",
    }

    async with httpx.AsyncClient(headers=headers, timeout=5.0) as client:
        homepage_task = _fetch_text(client, homepage_url)
        # Try /about first; fall back through the rest sequentially below
        homepage_text = await homepage_task
        about_text: Optional[str] = None
        if homepage_text is not None:
            for path in about_paths:
                about_text = await _fetch_text(client, f"https://{domain}{path}")
                if about_text:
                    break

    # If homepage failed, try http:// once before giving up
    if homepage_text is None:
        try:
            async with httpx.AsyncClient(headers=headers, timeout=5.0) as client:
                homepage_text = await _fetch_text(client, f"http://{domain}")
        except Exception:
            homepage_text = None

    return (domain if (homepage_text or about_text) else None, homepage_text, about_text)
