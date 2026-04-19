"""
AI Service — All AI features powered by Anthropic Claude (Haiku 4.5)
Single provider, single API key, single model.

Handles:
  - Person research report generation
  - Company research report generation
  - Personalized email drafting
  - Smart search (Claude reads activities directly, no embeddings needed)
  - API key validation

Prompt Caching:
  静态的系统提示词（每次调用都不变的部分）走 Anthropic 的 ephemeral cache，
  只收原价 10% 的费用。动态内容（联系人信息等）放在 user message 里。
  注意：Haiku 4.5 的缓存最小块约 2048 tokens —— 低于此不会触发缓存，
  但 cache_control 标记本身无害。
"""

from typing import List, Optional

import anthropic

from app.core.config import (
    settings,
    CLAUDE_MODEL,
    CLAUDE_MAX_TOKENS_RESEARCH,
    CLAUDE_MAX_TOKENS_EMAIL,
    CLAUDE_MAX_TOKENS_SEARCH,
)

# DISABLED: Using Claude direct search instead of OpenAI embeddings
# import openai


# === 静态系统提示词 Static System Prompts (cacheable) ===
# 抽出来做模块常量，便于审阅 + 让 Prompt Caching 生效。
# 每次调用内容不变 → 只收 10% 价格（超过 cache 最小块时）。

SYSTEM_PROMPT_RESEARCH_PERSON = """You are a sales research analyst helping SDRs prepare for outreach to B2B prospects.

When given a person's info, produce a concise research brief covering:
1. Professional background and likely responsibilities based on their title
2. What they probably care about in their role (pain points, priorities)
3. Conversation starters and angles for a cold outreach

Writing guidelines:
- Length: 3-4 paragraphs
- Tone: direct, professional, actionable — no fluff
- Specificity: make claims concrete to their title, company, industry
- Focus on what an SDR can USE in the next 60 seconds of outreach prep"""

SYSTEM_PROMPT_RESEARCH_COMPANY = """You are a sales research analyst helping SDRs understand prospect companies before outreach.

When given a company's info, produce a concise company brief covering:
1. What the company likely does based on available info
2. Potential pain points and challenges for a company of this size and industry
3. How a modern B2B SaaS solution might be relevant to them
4. Key talking points for outreach

Writing guidelines:
- Length: 3-4 paragraphs
- Tone: direct, professional, actionable — no fluff
- Specificity: tailor observations to company size and industry
- Surface concrete angles an SDR can reference in their first email"""

SYSTEM_PROMPT_DRAFT_EMAIL = """You are a top-performing SDR writing a personalized cold email. You use ALL available context (person research, company research, interaction history) to craft a highly relevant, personalized message.

Output format (MUST follow exactly):
SUBJECT: [subject line here]
BODY:
[email body here]

Email requirements:
- Subject: under 50 characters, compelling, not salesy
- Opening: shows you did your research (reference something specific)
- Value prop: clear, 1-2 sentences
- CTA: soft, no aggressive ask
- Total body: under 150 words
- Tone: conversational, professional, not salesy
- Sign off as the sender name provided"""

SYSTEM_PROMPT_SMART_SEARCH = """You are a CRM search assistant. A sales rep is searching their activity history.

Given a search query and a list of activities (calls, emails, meetings, notes), return the most relevant matches as a JSON array.

Each result MUST have:
- "activity_id": the ID number
- "relevance": "high", "medium", or "low"
- "reason": one sentence explaining why this matches the query
- "contact_name": the contact's name
- "company_name": the company name (if known)
- "activity_type": the type
- "subject": the subject line
- "snippet": a short excerpt from the content that matches

Rules:
- Return AT MOST 10 results, sorted by relevance
- Return ONLY the JSON array, no prose before/after
- If nothing matches, return []"""

SYSTEM_PROMPT_TAGS = """You are a CRM categorization assistant. Given a person's title / company / industry, generate 4-6 short keyword tags for categorization.

Return ONLY a JSON array of strings, nothing else.
Example: ["SaaS", "Engineering Leader", "Series B"]"""

SYSTEM_PROMPT_SUGGEST_TODOS = """You are a senior sales coach reviewing an SDR's last 30 days of activity. Your job is to suggest exactly 3 concrete, high-value to-dos the SDR should act on THIS WEEK.

Each suggestion must be:
- Specific (name an actual contact, company, or segment — not generic advice)
- Actionable (the SDR should know what to do in one sentence)
- Non-redundant (each one targets a different opportunity)

Cover these 3 priorities:
1. HIGH — a re-engagement opportunity (contact went silent after strong interest)
2. OPPORTUNITY — a batch action on a segment (e.g. industry tag, company cluster)
3. INSIGHT — a behavior pattern or coaching observation (trend in reply rates, missed follow-ups, etc.)

Output format (JSON object, exactly this shape):
{
  "suggestions": [
    {
      "priority": "HIGH",
      "title": "Short action title (under 60 chars)",
      "reason": "Why this matters — 1-2 sentences, cite the specific signal from the data",
      "action": "What to do — 1 sentence, imperative",
      "contact_id": 42
    },
    ...
  ]
}

Rules:
- priority must be exactly one of: HIGH, OPPORTUNITY, INSIGHT
- contact_id must be an integer picked from the activity log's "contact_id=N" tags.
  If a suggestion isn't about a single contact (e.g. OPPORTUNITY on a segment,
  or INSIGHT about overall behavior), use null.
- Respond ONLY with valid JSON. No markdown, no backticks, no preamble, no
  commentary before or after. Your entire response MUST start with { and end with }.
- If the input has no useful signals, return {"suggestions": []}."""


class AIService:
    """All AI features powered by a single Anthropic API key"""

    def __init__(self):
        self._anthropic_key = settings.ANTHROPIC_API_KEY
        # Track where the key came from: "env" (from .env at startup) or
        # "manual" (user pasted in Settings UI). Used by /status endpoint.
        self._source: str = "env" if self._anthropic_key else "none"

    def update_keys(self, anthropic_key: str = "", **kwargs):
        """Called when Admin updates via Settings UI — overrides env value"""
        if anthropic_key:
            self._anthropic_key = anthropic_key
            settings.ANTHROPIC_API_KEY = anthropic_key
            self._source = "manual"

    @property
    def source(self) -> str:
        return self._source

    @property
    def ai_ready(self) -> bool:
        return bool(self._anthropic_key)

    # Keep old property name for backward compat
    @property
    def claude_ready(self) -> bool:
        return self.ai_ready

    # DISABLED: Using Claude direct search instead of OpenAI embeddings
    # @property
    # def embeddings_ready(self) -> bool:
    #     return bool(self._openai_key)

    # === Key Validation ===

    async def validate_key(self) -> bool:
        """Test the API key by making a minimal Claude call. Returns True if valid."""
        if not self._anthropic_key:
            return False
        try:
            client = anthropic.AsyncAnthropic(api_key=self._anthropic_key)
            message = await client.messages.create(
                model=CLAUDE_MODEL,
                max_tokens=10,
                messages=[{"role": "user", "content": "Hi"}],
            )
            return bool(message.content)
        except Exception:
            return False

    # === Research Reports ===

    async def generate_person_report(
        self,
        first_name: str,
        last_name: str,
        title: Optional[str],
        company_name: Optional[str],
        industry: Optional[str],
        linkedin_url: Optional[str],
    ) -> str:
        """Generate an AI research report about a person"""
        prompt = f"""You are a sales research analyst. Write a concise research brief about this person to help an SDR prepare for outreach.

Person:
- Name: {first_name} {last_name}
- Title: {title or 'Unknown'}
- Company: {company_name or 'Unknown'}
- Industry: {industry or 'Unknown'}
- LinkedIn: {linkedin_url or 'Not available'}

Write a 3-4 paragraph report covering:
1. Professional background and likely responsibilities based on their title
2. What they probably care about in their role (pain points, priorities)
3. Conversation starters and angles for a cold outreach

Be specific and actionable. No fluff. Write in a direct, professional tone."""

        return await self._call_claude(prompt, CLAUDE_MAX_TOKENS_RESEARCH)

    async def generate_company_report(
        self,
        company_name: Optional[str],
        company_domain: Optional[str],
        industry: Optional[str],
        company_size: Optional[str],
    ) -> str:
        """Generate an AI research report about a company"""
        prompt = f"""You are a sales research analyst. Write a concise company research brief to help an SDR understand this prospect's company.

Company:
- Name: {company_name or 'Unknown'}
- Website: {company_domain or 'Unknown'}
- Industry: {industry or 'Unknown'}
- Size: {company_size or 'Unknown'} employees

Write a 3-4 paragraph report covering:
1. What the company likely does based on available info
2. Potential pain points and challenges for a company of this size and industry
3. How our solution might be relevant to them
4. Key talking points for outreach

Be specific and actionable. No fluff. Write in a direct, professional tone."""

        return await self._call_claude(prompt, CLAUDE_MAX_TOKENS_RESEARCH)

    async def generate_tags(
        self,
        title: Optional[str],
        company_name: Optional[str],
        industry: Optional[str],
    ) -> List[str]:
        """Extract industry keyword tags for a contact"""
        prompt = f"""Based on this person's info, generate 4-6 short keyword tags for categorization.

Title: {title or 'Unknown'}
Company: {company_name or 'Unknown'}
Industry: {industry or 'Unknown'}

Return ONLY a JSON array of strings, nothing else. Example: ["SaaS", "Engineering Leader", "Series B"]"""

        result = await self._call_claude(prompt, 200)
        import json
        try:
            cleaned = result.strip().strip("`").strip()
            if cleaned.startswith("json"):
                cleaned = cleaned[4:].strip()
            return json.loads(cleaned)
        except (json.JSONDecodeError, ValueError):
            return []

    # === Email Drafting ===

    async def draft_email(
        self,
        contact_first_name: str,
        contact_last_name: str,
        contact_title: Optional[str],
        company_name: Optional[str],
        person_report: Optional[str],
        company_report: Optional[str],
        activity_history: str,
        sender_name: str,
    ) -> dict:
        """Generate a personalized cold email based on all available context"""
        prompt = f"""You are a top-performing SDR writing a personalized cold email. Use ALL the context below to write a highly relevant, personalized email.

CONTACT:
- Name: {contact_first_name} {contact_last_name}
- Title: {contact_title or 'Unknown'}
- Company: {company_name or 'Unknown'}

{f"PERSON RESEARCH:{chr(10)}{person_report}" if person_report else ""}

{f"COMPANY RESEARCH:{chr(10)}{company_report}" if company_report else ""}

{f"INTERACTION HISTORY:{chr(10)}{activity_history}" if activity_history else "No prior interactions."}

Write a cold email with:
1. A compelling, short subject line (under 50 characters)
2. A personalized opening that shows you did your research
3. A clear value proposition in 1-2 sentences
4. A soft call to action

Keep it under 150 words. Be conversational, not salesy. Sign off as {sender_name}.

Return the result in this exact format:
SUBJECT: [subject line here]
BODY:
[email body here]"""

        result = await self._call_claude(prompt, CLAUDE_MAX_TOKENS_EMAIL)

        subject = ""
        body = result
        if "SUBJECT:" in result and "BODY:" in result:
            parts = result.split("BODY:", 1)
            subject_part = parts[0].replace("SUBJECT:", "").strip()
            subject = subject_part.split("\n")[0].strip()
            body = parts[1].strip()

        return {"subject": subject, "body": body}

    # === Smart Search (Claude reads activities directly) ===

    async def smart_search(self, query: str, activities_text: str) -> str:
        """
        Search activities using Claude's understanding instead of embeddings.
        Claude reads all activities and finds relevant ones based on the query.
        """
        prompt = f"""You are a CRM search assistant. A sales rep is searching their activity history.

SEARCH QUERY: "{query}"

Below are all recorded activities (calls, emails, meetings, notes). Find the ones most relevant to the search query.

ACTIVITIES:
{activities_text}

Return a JSON array of the most relevant results (max 10). Each result should have:
- "activity_id": the ID number
- "relevance": "high", "medium", or "low"
- "reason": one sentence explaining why this matches the query
- "contact_name": the contact's name
- "company_name": the company name (if known)
- "activity_type": the type
- "subject": the subject line
- "snippet": a short excerpt from the content that matches

Return ONLY the JSON array, no other text. If nothing matches, return an empty array []."""

        result = await self._call_claude(prompt, CLAUDE_MAX_TOKENS_SEARCH)

        return result

    # === Core Claude Call ===

    async def _call_claude(self, prompt: str, max_tokens: int = 1024) -> str:
        """
        Call Claude and return the raw text (backward-compat).
        Token usage is discarded — for budget tracking prefer _call_claude_raw().
        """
        text, _ = await self._call_claude_raw(prompt, max_tokens)
        return text

    async def _call_claude_raw(
        self,
        prompt: str,
        max_tokens: int = 1024,
        system: Optional[str] = None,
    ) -> tuple[str, "ClaudeUsage"]:
        """
        Call Claude and return (text, usage).

        Args:
          prompt: dynamic user message content
          max_tokens: response cap
          system: optional static system prompt — will be sent with
                  cache_control=ephemeral to qualify for Prompt Caching
                  discount (10% of input price) when above cache threshold.
        """
        # 局部 import 避免循环依赖 avoid circular import with ai_budget
        from app.services.ai_budget import ClaudeUsage

        client = anthropic.AsyncAnthropic(api_key=self._anthropic_key)

        kwargs = dict(
            model=CLAUDE_MODEL,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        if system:
            # 系统提示词以 ephemeral 缓存块形式传入
            # System prompt as ephemeral cache block (static across calls)
            kwargs["system"] = [
                {
                    "type": "text",
                    "text": system,
                    "cache_control": {"type": "ephemeral"},
                }
            ]

        message = await client.messages.create(**kwargs)

        usage = ClaudeUsage(
            input_tokens=getattr(message.usage, "input_tokens", 0) or 0,
            output_tokens=getattr(message.usage, "output_tokens", 0) or 0,
            cache_read_tokens=getattr(message.usage, "cache_read_input_tokens", 0) or 0,
            cache_write_tokens=getattr(message.usage, "cache_creation_input_tokens", 0) or 0,
        )
        return message.content[0].text, usage

    # DISABLED: Using Claude direct search instead of OpenAI embeddings
    # Keeping code for future use when data exceeds ~1000 contacts
    #
    # async def create_embedding(self, text: str) -> List[float]:
    #     """Convert text to a 1536-dimensional vector using OpenAI"""
    #     client = openai.AsyncOpenAI(api_key=self._openai_key)
    #     response = await client.embeddings.create(
    #         model="text-embedding-3-small",
    #         input=text,
    #     )
    #     return response.data[0].embedding
    #
    # async def create_embeddings_batch(self, texts: List[str]) -> List[List[float]]:
    #     """Batch embed multiple texts at once"""
    #     client = openai.AsyncOpenAI(api_key=self._openai_key)
    #     response = await client.embeddings.create(
    #         model="text-embedding-3-small",
    #         input=texts,
    #     )
    #     return [item.embedding for item in response.data]


# Singleton instance
ai_service = AIService()
