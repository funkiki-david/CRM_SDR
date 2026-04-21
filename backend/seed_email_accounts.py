"""
Seed SMTP email accounts from .env values.

Reads EMAIL_1_* and EMAIL_2_* blocks from the environment, encrypts the
password with Fernet, and upserts into the email_accounts table. The
OWNER_EMAIL env var picks which user the account belongs to; falls back
to the first admin user if not set.

Run:  ./.venv/bin/python seed_email_accounts.py
"""

from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, ".")

from dotenv import load_dotenv
from sqlalchemy import select

from app.core.crypto import encrypt_password
from app.core.database import async_session
from app.models.email_account import EmailAccount
from app.models.user import User, UserRole


def _load_account_from_env(prefix: str) -> dict | None:
    """Read EMAIL_{prefix}_* env vars into a dict. Returns None if EMAIL_{prefix}_ADDRESS is missing."""
    address = os.getenv(f"EMAIL_{prefix}_ADDRESS")
    if not address:
        return None
    return {
        "address": address.strip(),
        "display_name": (os.getenv(f"EMAIL_{prefix}_DISPLAY_NAME") or "").strip() or None,
        "smtp_host": (os.getenv(f"EMAIL_{prefix}_SMTP_HOST") or "").strip(),
        "smtp_port": int(os.getenv(f"EMAIL_{prefix}_SMTP_PORT") or "587"),
        "smtp_username": (os.getenv(f"EMAIL_{prefix}_SMTP_USERNAME") or address).strip(),
        "smtp_password": os.getenv(f"EMAIL_{prefix}_SMTP_PASSWORD") or "",
        "smtp_encryption": (os.getenv(f"EMAIL_{prefix}_SMTP_ENCRYPTION") or "starttls").strip(),
        "owner_email": (os.getenv(f"EMAIL_{prefix}_OWNER_EMAIL") or "").strip() or None,
    }


async def _find_owner(session, owner_email: str | None) -> User | None:
    if owner_email:
        res = await session.execute(select(User).where(User.email == owner_email))
        u = res.scalar_one_or_none()
        if u is not None:
            return u
    # fallback: first admin
    res = await session.execute(select(User).where(User.role == UserRole.ADMIN).limit(1))
    return res.scalar_one_or_none()


async def seed() -> None:
    load_dotenv()

    async with async_session() as session:
        for prefix in ("1", "2"):
            data = _load_account_from_env(prefix)
            if data is None:
                print(f"EMAIL_{prefix}_*: not configured, skipping")
                continue
            if not data["smtp_host"] or not data["smtp_password"]:
                print(
                    f"EMAIL_{prefix} ({data['address']}): missing smtp_host or smtp_password "
                    f"— skipping (fill it in via Settings UI)"
                )
                continue

            owner = await _find_owner(session, data["owner_email"])
            if owner is None:
                print(f"EMAIL_{prefix} ({data['address']}): no owner user found, skipping")
                continue

            # Upsert by (user_id, email_address)
            existing_q = await session.execute(
                select(EmailAccount).where(
                    EmailAccount.user_id == owner.id,
                    EmailAccount.email_address == data["address"],
                )
            )
            existing = existing_q.scalar_one_or_none()

            encrypted_pw = encrypt_password(data["smtp_password"])

            if existing is None:
                acc = EmailAccount(
                    user_id=owner.id,
                    email_address=data["address"],
                    display_name=data["display_name"] or owner.full_name,
                    provider_type="smtp",
                    is_active=True,
                    smtp_host=data["smtp_host"],
                    smtp_port=data["smtp_port"],
                    smtp_username=data["smtp_username"],
                    smtp_password_encrypted=encrypted_pw,
                    smtp_encryption=data["smtp_encryption"],
                )
                session.add(acc)
                print(
                    f"  created account: {data['address']} → {data['smtp_host']}:{data['smtp_port']} "
                    f"(owner={owner.email})"
                )
            else:
                existing.display_name = data["display_name"] or existing.display_name
                existing.provider_type = "smtp"
                existing.is_active = True
                existing.smtp_host = data["smtp_host"]
                existing.smtp_port = data["smtp_port"]
                existing.smtp_username = data["smtp_username"]
                existing.smtp_password_encrypted = encrypted_pw
                existing.smtp_encryption = data["smtp_encryption"]
                print(
                    f"  updated account: {data['address']} → {data['smtp_host']}:{data['smtp_port']} "
                    f"(owner={owner.email})"
                )

        await session.commit()
        print("done.")


if __name__ == "__main__":
    asyncio.run(seed())
