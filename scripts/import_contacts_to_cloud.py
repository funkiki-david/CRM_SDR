"""
Import local contacts to cloud backend via API.
从本地数据库读取联系人，通过 REST API 批量导入云端。

Usage:
  python scripts/import_contacts_to_cloud.py
"""

import os
import sys
import time

import httpx
import psycopg2
import psycopg2.extras

# === Config ===
LOCAL_DB = dict(
    host="localhost",
    port=5432,
    user="sdrcrm",
    password="sdrcrm_dev",
    dbname="sdrcrm",
)
CLOUD_URL = "https://crmsdr-production.up.railway.app"
ADMIN_EMAIL = "admin@amazonsolutions.us"
ADMIN_PASSWORD = "admin123"


def login() -> str:
    """登录云端拿 JWT token"""
    r = httpx.post(
        f"{CLOUD_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=30,
    )
    r.raise_for_status()
    token = r.json()["access_token"]
    print(f"✅ Logged in as {ADMIN_EMAIL}")
    return token


def fetch_local_contacts() -> list[dict]:
    """从本地 Postgres 读取联系人"""
    conn = psycopg2.connect(**LOCAL_DB)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT first_name, last_name, email, phone, title,
               company_name, company_domain, industry, company_size,
               city, state, linkedin_url, website, notes,
               industry_tags_arr
          FROM contacts
         ORDER BY id
    """)
    rows = [dict(r) for r in cur.fetchall()]
    cur.close()
    conn.close()
    print(f"📥 Loaded {len(rows)} contacts from local DB")
    return rows


def to_payload(row: dict) -> dict:
    """Contact DB row → ContactCreate payload"""
    payload = {
        "first_name": row["first_name"],
        "last_name": row["last_name"],
        "email": row["email"] or "",
    }
    for key in ("phone", "title", "company_name", "company_domain",
                "industry", "company_size", "city", "state",
                "linkedin_url", "website", "notes"):
        v = row.get(key)
        if v:
            payload[key] = v

    tags = row.get("industry_tags_arr") or []
    if tags:
        payload["industry_tags"] = tags[:10]
    return payload


def post_contact(client: httpx.Client, payload: dict) -> tuple[bool, str]:
    """Create contact, return (success, note)"""
    try:
        r = client.post("/api/contacts", json=payload, timeout=30)
        if r.status_code == 201:
            return True, "created"
        if r.status_code == 409:
            return True, "duplicate-skipped"
        return False, f"HTTP {r.status_code}: {r.text[:200]}"
    except Exception as e:
        return False, f"exception: {e}"


def main():
    token = login()
    contacts = fetch_local_contacts()
    if not contacts:
        print("❌ No local contacts to import")
        sys.exit(1)

    created = skipped = failed = 0
    errors = []

    with httpx.Client(
        base_url=CLOUD_URL,
        headers={"Authorization": f"Bearer {token}"},
    ) as client:
        for i, row in enumerate(contacts, 1):
            payload = to_payload(row)
            ok, note = post_contact(client, payload)
            name = f"{payload['first_name']} {payload['last_name']}"
            if ok:
                if note == "created":
                    created += 1
                    print(f"  [{i}/{len(contacts)}] ✅ {name}")
                else:
                    skipped += 1
                    print(f"  [{i}/{len(contacts)}] ⏭  {name} ({note})")
            else:
                failed += 1
                errors.append((name, note))
                print(f"  [{i}/{len(contacts)}] ❌ {name}: {note}")
            time.sleep(0.1)  # rate-limit gentle

    print("\n=== Summary ===")
    print(f"  Created:  {created}")
    print(f"  Skipped:  {skipped} (duplicates)")
    print(f"  Failed:   {failed}")
    if errors:
        print("\nErrors:")
        for n, e in errors[:10]:
            print(f"  - {n}: {e}")


if __name__ == "__main__":
    main()
