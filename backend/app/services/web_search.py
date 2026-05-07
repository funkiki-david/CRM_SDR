"""Web Search service — wraps Anthropic Claude + web_search_20250305 tool.

Used as fallback for Tab 1 (Browse companies) when Apollo returns 0 results.
Returns structured candidates: list of {company_name, domain, summary}.

Cost note: Each web_search invocation costs ~$0.01 + Claude tokens.
max_uses=3 caps the search loops per query.
"""
from __future__ import annotations

import json
import logging
from typing import List, Optional

import anthropic
from pydantic import BaseModel

from app.core.config import settings

logger = logging.getLogger(__name__)


class WebSearchCandidate(BaseModel):
    company_name: str
    domain: Optional[str] = None
    summary: str  # one-line: industry, size, location hints


# Match the rest of the codebase (services/ai.py uses this constant).
CLAUDE_MODEL = "claude-haiku-4-5-20251001"


SYSTEM_PROMPT = """You help SDRs find companies by name when their CRM database (Apollo) returns no matches.

Given a company name search query, use the web_search tool to find matching companies.
Return up to 5 candidates that best match the query.

For each candidate, provide:
- company_name: official company name as it appears on their website
- domain: primary website domain (e.g., "burton.com" not "https://www.burton.com/")
- summary: ONE LINE describing what they do, their size if known, their location if known
  Example: "Snowboard manufacturer, ~1000 employees, Burlington VT"

Output a JSON array with this exact structure (no other text, no markdown):
[
  {"company_name": "...", "domain": "...", "summary": "..."},
  ...
]

If no matches found, return empty array: []
If candidate has no website, set domain to null.
Keep summaries concise — one sentence each.
"""


def _extract_json_array(raw: str) -> Optional[list]:
    """Defensively pull a JSON array out of Claude's text response.

    Claude is instructed to return raw JSON but occasionally wraps it in
    ```json fences or adds preamble. We try strict parse first, then
    locate the first '[' and last ']' as a fallback.
    """
    cleaned = raw.strip()
    # Strip ```json ... ``` fences if present
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        # drop first fence line and last fence line
        if len(lines) >= 2:
            cleaned = "\n".join(lines[1:])
        if cleaned.rstrip().endswith("```"):
            cleaned = cleaned.rsplit("```", 1)[0]
        cleaned = cleaned.strip()

    try:
        parsed = json.loads(cleaned)
        return parsed if isinstance(parsed, list) else None
    except json.JSONDecodeError:
        pass

    # Fallback: scan for first '[' / last ']' pair
    start = cleaned.find("[")
    end = cleaned.rfind("]")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        parsed = json.loads(cleaned[start : end + 1])
        return parsed if isinstance(parsed, list) else None
    except json.JSONDecodeError:
        return None


async def search_companies_via_web(query: str) -> List[WebSearchCandidate]:
    """Search the web for companies matching the query.

    Returns up to 5 structured candidates. Returns empty list on any failure
    (no API key, web_search tool error, JSON parse error). Failure is silent
    so the route can degrade gracefully — UI just shows "no web results".
    """
    if not query or not query.strip():
        return []

    if not settings.ANTHROPIC_API_KEY:
        logger.warning("ANTHROPIC_API_KEY not configured; web search unavailable")
        return []

    client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)

    try:
        response = await client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=2048,
            system=SYSTEM_PROMPT,
            tools=[
                {
                    "type": "web_search_20250305",
                    "name": "web_search",
                    "max_uses": 3,
                }
            ],
            messages=[
                {
                    "role": "user",
                    "content": f"Find companies matching this search: {query}",
                }
            ],
        )
    except Exception as e:
        logger.error("web_search messages.create failed for %r: %s", query, e, exc_info=True)
        return []

    # Final-turn text blocks (after any web_search tool-use loops).
    text_blocks = [
        getattr(block, "text", "")
        for block in response.content
        if getattr(block, "type", None) == "text"
    ]
    full_text = "\n".join(t for t in text_blocks if t).strip()

    if not full_text:
        logger.warning("Web search produced no text content for %r", query)
        return []

    parsed = _extract_json_array(full_text)
    if parsed is None:
        logger.error(
            "Web search response not parseable for %r. First 500 chars: %s",
            query,
            full_text[:500],
        )
        return []

    candidates: List[WebSearchCandidate] = []
    for item in parsed[:5]:
        if not isinstance(item, dict):
            continue
        try:
            candidates.append(WebSearchCandidate(**item))
        except Exception as e:
            logger.warning("Skipping invalid web_search candidate %r: %s", item, e)
            continue

    logger.info("Web search for %r returned %d candidates", query, len(candidates))
    return candidates
