"""
AI Service — Claude for text generation, OpenAI for embeddings
Handles:
  - Person research report generation
  - Company research report generation
  - Personalized email drafting
  - Text → vector embedding (for semantic search)
"""

from typing import List, Optional

import anthropic
import openai

from app.core.config import settings


class AIService:
    """Unified AI service wrapping Claude and OpenAI APIs"""

    def __init__(self):
        self._anthropic_key = settings.ANTHROPIC_API_KEY
        self._openai_key = settings.OPENAI_API_KEY

    def update_keys(self, anthropic_key: str = "", openai_key: str = ""):
        if anthropic_key:
            self._anthropic_key = anthropic_key
            settings.ANTHROPIC_API_KEY = anthropic_key
        if openai_key:
            self._openai_key = openai_key
            settings.OPENAI_API_KEY = openai_key

    @property
    def claude_ready(self) -> bool:
        return bool(self._anthropic_key)

    @property
    def embeddings_ready(self) -> bool:
        return bool(self._openai_key)

    # === Claude: Text Generation ===

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

        return await self._call_claude(prompt)

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

        return await self._call_claude(prompt)

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

        result = await self._call_claude(prompt)
        # Parse the JSON array from the response
        import json
        try:
            # Strip any markdown code blocks
            cleaned = result.strip().strip("`").strip()
            if cleaned.startswith("json"):
                cleaned = cleaned[4:].strip()
            return json.loads(cleaned)
        except (json.JSONDecodeError, ValueError):
            return []

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

        result = await self._call_claude(prompt)

        # Parse subject and body
        subject = ""
        body = result
        if "SUBJECT:" in result and "BODY:" in result:
            parts = result.split("BODY:", 1)
            subject_part = parts[0].replace("SUBJECT:", "").strip()
            subject = subject_part.split("\n")[0].strip()
            body = parts[1].strip()

        return {"subject": subject, "body": body}

    async def _call_claude(self, prompt: str) -> str:
        """Call Claude API with prompt caching for efficiency"""
        client = anthropic.AsyncAnthropic(api_key=self._anthropic_key)
        message = await client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
        return message.content[0].text

    # === OpenAI: Embeddings ===

    async def create_embedding(self, text: str) -> List[float]:
        """Convert text to a 1536-dimensional vector using OpenAI"""
        client = openai.AsyncOpenAI(api_key=self._openai_key)
        response = await client.embeddings.create(
            model="text-embedding-3-small",
            input=text,
        )
        return response.data[0].embedding

    async def create_embeddings_batch(self, texts: List[str]) -> List[List[float]]:
        """Batch embed multiple texts at once"""
        client = openai.AsyncOpenAI(api_key=self._openai_key)
        response = await client.embeddings.create(
            model="text-embedding-3-small",
            input=texts,
        )
        return [item.embedding for item in response.data]


# Singleton instance
ai_service = AIService()
