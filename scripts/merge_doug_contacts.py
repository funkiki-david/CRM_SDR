#!/usr/bin/env python3
"""
One-off script: merge Doug's CA contact list into local CRM DB.

Steps:
  1. Read existing contacts from local Postgres
  2. Parse Doug's CSV (custom format: Customer / Contact / City / Phone / Notes)
  3. Dedup:
     - skip row if email matches existing
     - skip row if email empty AND (company, first_name, last_name) matches existing
  4. Write merged CSV (old + new) to exports/contacts_merged.csv for review
  5. Write incremental CSV (new rows only) to exports/contacts_incremental.csv
  6. Report stats
  7. Import incremental via /api/contacts/import
  8. Verify final count in DB

Run: python scripts/merge_doug_contacts.py
"""

import csv
import re
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
SRC_NEW = Path("/Users/davidz/Downloads/Doug Contact List CA 2026.xlsx - Sheet1.csv")
EXPORT_DIR = ROOT / "exports"
SRC_EXISTING = EXPORT_DIR / "contacts_2026-04-19.csv"  # produced earlier by /api/contacts/export
OUT_MERGED = EXPORT_DIR / "contacts_merged.csv"
OUT_INCREMENTAL = EXPORT_DIR / "contacts_incremental.csv"
EXPORT_DIR.mkdir(exist_ok=True)

API = "http://localhost:8000"
ADMIN_EMAIL = "info@amazonsolutions.us"
ADMIN_PASSWORD = "admin123"

# Standard CRM columns (must match ContactCreate schema order)
COLUMNS = [
    "first_name", "last_name", "email", "phone", "title",
    "company_name", "company_domain", "industry", "company_size",
    "city", "state", "linkedin_url", "website",
    "industry_tags", "notes",
]

# Known title keywords — used to split "FirstName LastName Title" patterns
# Order matters: longer multi-word titles first so "Sales Mgr" matches before "Sales"
KNOWN_TITLES = [
    "VP Operations", "Regional Mgr", "Business Mgr", "Branch Mgr",
    "Production Mgr", "Sales Mgr", "Sales Manager", "Ops Mgr",
    "Asst Mgr", "Reg Mrg", "Reg Mgr", "Regional Manager",
    "General Manager", "Operations Manager",
    "Estimator/Purchaser", "Estimator",
    "CEO", "CFO", "CTO", "COO", "GM", "VP",
    "President", "Owner", "Owners", "Sales",
]
TITLE_RE = re.compile(
    r"^(?P<name>.*?)\s*[\-–]?\s*(?P<title>(?:"
    + "|".join(re.escape(t) for t in KNOWN_TITLES)
    + r"))\s*$",
    re.IGNORECASE,
)


# ============================================================================
# Parsing
# ============================================================================

def parse_contact_field(raw: str) -> tuple[str, str, str]:
    """
    Parse Doug's 'Contact' column into (first_name, last_name, title).

    Examples:
      'Mark Lander GM'         → ('Mark', 'Lander', 'GM')
      'Ken Adel   Sales'       → ('Ken', 'Adel', 'Sales')
      'Jeanne   Sales'         → ('Jeanne', '', 'Sales')
      'Abby - Owner'           → ('Abby', '', 'Owner')
      'David Lee'              → ('David', 'Lee', '')
      'Moon, Phil -Owners'     → ('Phil', 'Moon', 'Owners')
      'Justin Lopez VP Operations' → ('Justin', 'Lopez', 'VP Operations')
      'Branch Mgr'             → ('Unknown', '', 'Branch Mgr')
    """
    s = re.sub(r"\s+", " ", raw or "").strip()
    if not s:
        return ("", "", "")

    # Handle "LastName, FirstName -Title"
    if "," in s:
        parts = [p.strip() for p in s.split(",", 1)]
        last = parts[0]
        rest = parts[1]
        m = TITLE_RE.match(rest)
        if m:
            first = m.group("name").strip(" -").strip()
            title = m.group("title").strip()
        else:
            first = rest
            title = ""
        return (first or "Unknown", last, title)

    # Try to extract trailing title
    m = TITLE_RE.match(s)
    if m:
        name_part = m.group("name").strip(" -").strip()
        title = m.group("title").strip()
    else:
        name_part = s
        title = ""

    # Split name_part into first / last
    if not name_part:
        return ("Unknown", "", title)

    words = name_part.split()
    if len(words) == 1:
        return (words[0], "", title)
    return (words[0], " ".join(words[1:]), title)


def normalize_phone(raw: str) -> str:
    s = re.sub(r"\s+", " ", raw or "").strip()
    return s[:30]


def load_doug_file(path: Path) -> list[dict]:
    """Return list of standard-schema dicts"""
    out = []
    with open(path, encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = next(reader)  # noqa: F841 — intentionally discarded
        for row in reader:
            if not any(c.strip() for c in row):
                continue
            company = (row[0] if len(row) > 0 else "").strip()
            contact_raw = (row[1] if len(row) > 1 else "").strip()
            city = (row[2] if len(row) > 2 else "").strip()
            phone = normalize_phone(row[3] if len(row) > 3 else "")
            notes = (row[4] if len(row) > 4 else "").strip()

            first, last, title = parse_contact_field(contact_raw)

            out.append({
                "first_name": first or "Unknown",
                "last_name": last or "",
                "email": "",  # Doug's list has no emails
                "phone": phone,
                "title": title,
                "company_name": company,
                "company_domain": "",
                "industry": "",
                "company_size": "",
                "city": city,
                "state": "CA" if city else "",  # Doug's list is CA/AZ-area; default CA
                "linkedin_url": "",
                "website": "",
                "industry_tags": "",
                "notes": notes,
                "_raw_contact": contact_raw,  # for debugging only, stripped before write
            })
    return out


# ============================================================================
# Existing contacts (read from the CSV we exported earlier)
# ============================================================================

def load_existing_contacts() -> list[dict]:
    """Read existing contacts from the export CSV (utf-8-sig handles BOM)."""
    rows = []
    with open(SRC_EXISTING, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for r in reader:
            rows.append({k: (v or "") for k, v in r.items()})
    return rows


def normalize_for_dedup(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def build_dedup_keys(rows):
    """
    Build two lookup structures from a list of contacts:
      - email_set: lowercase emails (for email-match skip)
      - name_company_set: (lower company, lower first, lower last) tuples for empty-email dedup
    """
    emails = set()
    name_company = set()
    for r in rows:
        email = normalize_for_dedup(r.get("email", ""))
        if email:
            emails.add(email)
        else:
            key = (
                normalize_for_dedup(r.get("company_name", "")),
                normalize_for_dedup(r.get("first_name", "")),
                normalize_for_dedup(r.get("last_name", "")),
            )
            name_company.add(key)
    return emails, name_company


# ============================================================================
# Merge logic
# ============================================================================

def merge(existing: list[dict], new: list[dict]):
    old_emails, old_name_company = build_dedup_keys(existing)

    skipped_email = []
    skipped_name = []
    accepted = []

    for row in new:
        email = normalize_for_dedup(row.get("email", ""))
        if email and email in old_emails:
            skipped_email.append(row)
            continue
        if not email:
            key = (
                normalize_for_dedup(row.get("company_name", "")),
                normalize_for_dedup(row.get("first_name", "")),
                normalize_for_dedup(row.get("last_name", "")),
            )
            if key in old_name_company:
                skipped_name.append(row)
                continue
        accepted.append(row)

    return accepted, skipped_email, skipped_name


# ============================================================================
# CSV output
# ============================================================================

def write_csv(path: Path, rows: list[dict]):
    with open(path, "w", newline="", encoding="utf-8-sig") as f:  # utf-8 BOM
        writer = csv.writer(f)
        writer.writerow(COLUMNS)
        for r in rows:
            writer.writerow([(r.get(k) or "") for k in COLUMNS])


def to_csv_row(r: dict) -> dict:
    """Ensure a row has exactly the COLUMNS keys"""
    out = {k: (r.get(k) or "") for k in COLUMNS}
    # Clean newlines in notes
    if out.get("notes"):
        out["notes"] = re.sub(r"[\r\n]+", " ", str(out["notes"]))
    return out


# ============================================================================
# Import via API
# ============================================================================

def api_login() -> str:
    r = httpx.post(
        f"{API}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()["access_token"]


def api_import_csv(token: str, csv_path: Path) -> dict:
    with open(csv_path, "rb") as f:
        r = httpx.post(
            f"{API}/api/contacts/import",
            headers={"Authorization": f"Bearer {token}"},
            files={"file": (csv_path.name, f, "text/csv")},
            timeout=60,
        )
    r.raise_for_status()
    return r.json()


def api_contact_count(token: str) -> int:
    r = httpx.get(
        f"{API}/api/contacts?limit=1",
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()["total"]


# ============================================================================
# Main
# ============================================================================

def main():
    if not SRC_NEW.exists():
        print(f"❌ Source not found: {SRC_NEW}")
        sys.exit(1)

    print("1️⃣  Loading existing contacts from DB...")
    existing = load_existing_contacts()
    print(f"   → {len(existing)} contacts in DB")

    print("2️⃣  Parsing Doug's CSV...")
    new = load_doug_file(SRC_NEW)
    print(f"   → {len(new)} rows parsed")

    print("3️⃣  Deduplicating...")
    accepted, skipped_email, skipped_name = merge(existing, new)
    print(f"   → {len(accepted)} new to add")
    print(f"   → {len(skipped_email)} skipped (email match)")
    print(f"   → {len(skipped_name)} skipped (company+name match)")

    # Clean accepted rows (strip debug field)
    clean_accepted = [{k: v for k, v in r.items() if not k.startswith("_")} for r in accepted]

    print("4️⃣  Writing merged CSV (for review)...")
    merged = [to_csv_row(r) for r in existing] + clean_accepted
    write_csv(OUT_MERGED, merged)
    print(f"   → {OUT_MERGED.relative_to(ROOT)} ({len(merged)} rows)")

    print("5️⃣  Writing incremental CSV (for import)...")
    write_csv(OUT_INCREMENTAL, clean_accepted)
    print(f"   → {OUT_INCREMENTAL.relative_to(ROOT)} ({len(clean_accepted)} rows)")

    if not clean_accepted:
        print("\n✅ Nothing new to import. Done.")
        return

    print("6️⃣  Logging in + importing to DB...")
    token = api_login()
    before = api_contact_count(token)
    result = api_import_csv(token, OUT_INCREMENTAL)
    after = api_contact_count(token)

    print(f"\n=== Import result ===")
    print(f"   Created:  {result.get('created')}")
    print(f"   Updated:  {result.get('updated')}")
    print(f"   Skipped:  {result.get('skipped')}")
    print(f"   Failed:   {result.get('failed')}")
    if result.get("errors"):
        print(f"\n   Errors (first 5):")
        for err in result["errors"][:5]:
            print(f"     row {err.get('row')}: {err.get('reason')}")

    print(f"\n=== Final DB count ===")
    print(f"   Before: {before}")
    print(f"   After:  {after}  (delta: +{after - before})")


if __name__ == "__main__":
    main()
