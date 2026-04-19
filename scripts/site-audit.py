#!/usr/bin/env python3
"""
SDR CRM — Site Audit
Runs 5 categories of checks on the entire codebase and generates
audit-report.md with Critical / Warning / Info classification.

Usage:
    python scripts/site-audit.py [--fix]

Exit code:
    0 — no Critical issues
    1 — has Critical issues (blocking)
"""

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional


# ============================================================================
# Config
# ============================================================================

ROOT = Path(__file__).resolve().parent.parent
FRONTEND_SRC = ROOT / "frontend" / "src"
BACKEND_APP = ROOT / "backend" / "app"
REPORT_PATH = ROOT / "audit-report.md"

# Routes that MUST exist (from app-shell navLinks + common deep-links)
KNOWN_ROUTES = {"/", "/dashboard", "/contacts", "/finder", "/settings", "/login"}

SEVERITY_ICON = {"critical": "🔴", "warning": "🟡", "info": "ℹ️", "pass": "🟢"}


# ============================================================================
# Finding data structure
# ============================================================================

@dataclass
class Finding:
    category: str          # e.g. "Chinese Text", "Hardcoded Localhost"
    severity: str          # critical | warning | info | pass
    message: str
    location: Optional[str] = None   # file:line or file
    detail: Optional[str] = None     # the offending string


@dataclass
class AuditResult:
    findings: List[Finding] = field(default_factory=list)

    def add(self, f: Finding):
        self.findings.append(f)

    @property
    def critical(self):
        return [f for f in self.findings if f.severity == "critical"]

    @property
    def warnings(self):
        return [f for f in self.findings if f.severity == "warning"]

    @property
    def infos(self):
        return [f for f in self.findings if f.severity == "info"]

    @property
    def passed(self):
        return [f for f in self.findings if f.severity == "pass"]


# ============================================================================
# Helpers
# ============================================================================

def run(cmd: List[str], cwd: Optional[Path] = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd, cwd=cwd or ROOT, capture_output=True, text=True, check=False
    )


CHINESE_RE = re.compile(r"[\u4e00-\u9fff]+")
# Line-start comment markers we treat as comments (not user-visible)
COMMENT_PREFIXES = ("//", "#", " *", "*", "/*", "/**")


def iter_frontend_src_files(extensions=(".ts", ".tsx", ".json")):
    for p in FRONTEND_SRC.rglob("*"):
        if p.is_file() and p.suffix in extensions:
            yield p


def iter_backend_files():
    for p in BACKEND_APP.rglob("*.py"):
        if p.is_file():
            yield p


def is_comment_line(stripped: str) -> bool:
    """True if the line is a code or JSX comment."""
    if stripped.startswith(COMMENT_PREFIXES):
        return True
    # JSX comment: {/* ... */}
    if stripped.startswith("{/*") or stripped.startswith("{/**"):
        return True
    return False


# Identifier tokens that contain "Apollo" but are NOT user-visible
# (camelCase / snake_case / PascalCase function/variable names, API URL segments, etc.)
# Allow zero prefix chars so bare "apolloKey" matches (starts with apollo).
_IDENTIFIER_APOLLO_RE = re.compile(r"\b[A-Za-z0-9_]*[Aa]pollo[A-Za-z0-9_]*\b")
_URL_APOLLO_RE = re.compile(r"/[A-Za-z0-9_\-/]*apollo[A-Za-z0-9_\-/]*", re.I)
_IMPORT_APOLLO_RE = re.compile(r"""['"][^'"]*apollo[^'"]*['"]""", re.I)


def strip_code_apollo(line: str) -> str:
    """Remove identifier / URL / import-path usages of 'apollo' so only
    user-visible strings remain. Used by check_apollo_leak."""
    # Order matters: URL first (inside quotes), then imports, then identifiers.
    line = _URL_APOLLO_RE.sub("", line)
    # Only strip quoted strings whose ENTIRE content matches an import/URL-like path;
    # otherwise "Search Apollo's database" inside a string would be wrongly stripped.
    def maybe_strip_quoted(m: re.Match) -> str:
        inner = m.group(0).strip("'\"")
        # import path / route / file path
        if inner.startswith(("/", ".")) or inner.count("/") >= 2:
            return ""
        return m.group(0)
    line = _IMPORT_APOLLO_RE.sub(maybe_strip_quoted, line)
    line = _IDENTIFIER_APOLLO_RE.sub("", line)
    return line


# ============================================================================
# Check 1: Chinese text in frontend
# ============================================================================

def check_chinese(result: AuditResult) -> None:
    """
    Critical: Chinese inside JSX text or user-facing string literals
    Info:     Chinese in source comments (already noted as OK per project rules)
    """
    critical_hits = []
    info_hits = []

    for path in iter_frontend_src_files():
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except UnicodeDecodeError:
            continue
        rel = path.relative_to(ROOT)

        for i, line in enumerate(lines, 1):
            if not CHINESE_RE.search(line):
                continue
            stripped = line.lstrip()
            snippet = CHINESE_RE.findall(line)[0][:40]

            # Classify
            if is_comment_line(stripped):
                info_hits.append((f"{rel}:{i}", snippet))
            else:
                # Could still be inside an inline comment mid-line — heuristic
                # If "//" appears before the Chinese char, it's a comment
                chinese_idx = next(
                    (m.start() for m in CHINESE_RE.finditer(line)), -1
                )
                inline_comment_idx = line.find("//")
                if inline_comment_idx != -1 and inline_comment_idx < chinese_idx:
                    info_hits.append((f"{rel}:{i}", snippet))
                else:
                    critical_hits.append((f"{rel}:{i}", snippet))

    for loc, snippet in critical_hits:
        result.add(Finding(
            category="Chinese Text (user-visible)",
            severity="critical",
            message="Chinese string in JSX or UI literal — must be English",
            location=loc,
            detail=snippet,
        ))
    for loc, snippet in info_hits:
        result.add(Finding(
            category="Chinese Text (comments)",
            severity="info",
            message="Chinese in code comment (allowed per project rules)",
            location=loc,
            detail=snippet,
        ))

    if not critical_hits:
        result.add(Finding(
            category="Chinese Text (user-visible)",
            severity="pass",
            message="No Chinese characters in user-visible frontend strings",
        ))


# ============================================================================
# Check 2: Links / localhost / routes
# ============================================================================

def check_links(result: AuditResult) -> None:
    # 2a. Hardcoded localhost (that isn't a fallback default)
    for path in iter_frontend_src_files((".ts", ".tsx")):
        lines = path.read_text(encoding="utf-8").splitlines()
        rel = path.relative_to(ROOT)
        for i, line in enumerate(lines, 1):
            if "localhost" not in line:
                continue
            # Allow: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
            if "NEXT_PUBLIC_API_URL" in line or "||" in line:
                continue
            if line.lstrip().startswith(COMMENT_PREFIXES):
                continue
            result.add(Finding(
                category="Hardcoded Localhost",
                severity="critical",
                message="Hardcoded localhost URL without env fallback",
                location=f"{rel}:{i}",
                detail=line.strip()[:120],
            ))

    # 2b. Internal href links — check route exists
    href_re = re.compile(r'href="(/[^"]*)"')
    router_push_re = re.compile(r'router\.push\(["\']([^"\']+)["\']')
    missing: set = set()
    found_routes: set = set()
    for path in iter_frontend_src_files((".ts", ".tsx")):
        text = path.read_text(encoding="utf-8")
        for m in href_re.finditer(text):
            found_routes.add(m.group(1).split("?")[0].split("#")[0])
        for m in router_push_re.finditer(text):
            if m.group(1).startswith("/"):
                found_routes.add(m.group(1).split("?")[0].split("#")[0])

    for r in sorted(found_routes):
        # Strip dynamic segments for comparison: /contacts?id=1 handled above
        base = r.rstrip("/") or "/"
        if base not in KNOWN_ROUTES:
            # Check if external or anchor
            if base.startswith(("http", "mailto:", "tel:", "#")):
                continue
            missing.add(base)

    for r in sorted(missing):
        result.add(Finding(
            category="Broken Internal Link",
            severity="warning",
            message=f"Link points to route '{r}' which is not in KNOWN_ROUTES",
            detail=r,
        ))

    if not missing:
        result.add(Finding(
            category="Internal Links",
            severity="pass",
            message=f"All internal links point to known routes ({len(KNOWN_ROUTES)} known)",
        ))


# ============================================================================
# Check 3: Code quality
# ============================================================================

def check_typescript(result: AuditResult) -> None:
    """Run tsc --noEmit and parse errors (filter pre-existing noise)."""
    fe = ROOT / "frontend"
    tsc = fe / "node_modules" / ".bin" / "tsc"
    if not tsc.exists():
        result.add(Finding("TypeScript", "warning", "tsc not installed (run `npm install` in frontend/)"))
        return
    proc = run([str(tsc), "--noEmit"], cwd=fe)
    output = proc.stdout + proc.stderr
    # Filter pre-existing noise
    noise = ("quick-entry", ".next/types", "ai-search/page", "templates/page")
    errors = [
        line for line in output.splitlines()
        if line.strip() and "error TS" in line and not any(n in line for n in noise)
    ]
    if errors:
        for line in errors[:10]:
            result.add(Finding(
                category="TypeScript Error",
                severity="critical",
                message="Type error in user code",
                detail=line,
            ))
    else:
        result.add(Finding(
            category="TypeScript",
            severity="pass",
            message="tsc --noEmit clean (excluding known pre-existing noise)",
        ))


def check_console_log(result: AuditResult) -> None:
    """console.log in production frontend code → warning"""
    count = 0
    for path in iter_frontend_src_files((".ts", ".tsx")):
        text = path.read_text(encoding="utf-8")
        for i, line in enumerate(text.splitlines(), 1):
            if "console.log" in line and not line.lstrip().startswith(COMMENT_PREFIXES):
                count += 1
                result.add(Finding(
                    category="console.log",
                    severity="warning",
                    message="console.log in production code",
                    location=f"{path.relative_to(ROOT)}:{i}",
                    detail=line.strip()[:100],
                ))
    if count == 0:
        result.add(Finding("console.log", "pass", "No console.log in frontend source"))


def check_todo_fixme(result: AuditResult) -> None:
    """TODO / FIXME / HACK / XXX markers"""
    markers = ("TODO", "FIXME", "HACK", "XXX")
    count = 0
    for path in list(iter_frontend_src_files((".ts", ".tsx"))) + list(iter_backend_files()):
        text = path.read_text(encoding="utf-8")
        for i, line in enumerate(text.splitlines(), 1):
            # Find whole-word TODO etc (not "todos")
            if any(re.search(rf"\b{m}\b", line) for m in markers):
                count += 1
                result.add(Finding(
                    category="TODO/FIXME/HACK",
                    severity="info",
                    message="Code marker — review and resolve if stale",
                    location=f"{path.relative_to(ROOT)}:{i}",
                    detail=line.strip()[:100],
                ))
    if count == 0:
        result.add(Finding("TODO/FIXME", "pass", "No TODO/FIXME/HACK/XXX markers"))


# ============================================================================
# Check 4: Security
# ============================================================================

def check_security(result: AuditResult) -> None:
    # 4a. Hardcoded secrets in frontend
    secret_patterns = [
        (re.compile(r'(api[_-]?key)\s*[:=]\s*["\']([a-zA-Z0-9_\-]{20,})["\']', re.I), "api_key"),
        (re.compile(r'(secret)\s*[:=]\s*["\']([a-zA-Z0-9_\-]{20,})["\']', re.I), "secret"),
        (re.compile(r'sk-[a-zA-Z0-9_\-]{30,}'), "sk- prefix key"),
    ]
    found_secret = False
    for path in iter_frontend_src_files((".ts", ".tsx")):
        text = path.read_text(encoding="utf-8")
        for i, line in enumerate(text.splitlines(), 1):
            if line.lstrip().startswith(COMMENT_PREFIXES):
                continue
            for pat, kind in secret_patterns:
                m = pat.search(line)
                if m:
                    found_secret = True
                    result.add(Finding(
                        category="Hardcoded Secret",
                        severity="critical",
                        message=f"Possible hardcoded {kind} in frontend",
                        location=f"{path.relative_to(ROOT)}:{i}",
                        detail=line.strip()[:120],
                    ))
    if not found_secret:
        result.add(Finding(
            "Hardcoded Secrets",
            "pass",
            "No hardcoded API keys / secrets in frontend source",
        ))

    # 4b. .env in .gitignore
    gitignore = (ROOT / ".gitignore").read_text(encoding="utf-8")
    if ".env" not in gitignore:
        result.add(Finding(".env in .gitignore", "critical",
                          ".env NOT listed in .gitignore"))
    else:
        result.add(Finding(".env in .gitignore", "pass",
                          ".env is gitignored (not pushed to repo)"))

    # .env not tracked
    proc = run(["git", "ls-files", "backend/.env", ".env"])
    if proc.stdout.strip():
        result.add(Finding(".env tracked in git", "critical",
                          f"These env files are tracked: {proc.stdout.strip()}"))
    else:
        result.add(Finding(".env tracked in git", "pass",
                          "No .env files tracked in git"))

    # 4c. CORS config — backend main.py
    main_py = (BACKEND_APP / "main.py").read_text(encoding="utf-8")
    if 'allow_origins=["*"]' in main_py.replace(" ", ""):
        result.add(Finding("CORS wildcard", "critical",
                          "Backend CORS uses allow_origins=[\"*\"] (unsafe)",
                          location="backend/app/main.py"))
    else:
        # Extract whitelist
        m = re.search(r'_origins\s*=\s*\[(.*?)\]', main_py, re.S)
        origins = m.group(1).strip() if m else "(not parsed)"
        result.add(Finding(
            "CORS whitelist", "pass",
            "CORS uses explicit origin whitelist",
            detail=origins.replace("\n", " ")[:150],
        ))


# ============================================================================
# Check 5: Consistency
# ============================================================================

def check_brand(result: AuditResult) -> None:
    """ProCRM / Pro CRM — should be absent everywhere"""
    bad = re.compile(r"\b(ProCRM|Pro CRM|procrm|SdrProCRM)\b")
    hits = []
    for path in list(iter_frontend_src_files()) + list(iter_backend_files()):
        text = path.read_text(encoding="utf-8")
        for i, line in enumerate(text.splitlines(), 1):
            if bad.search(line):
                hits.append(f"{path.relative_to(ROOT)}:{i}  —  {line.strip()[:100]}")
    if hits:
        for h in hits:
            result.add(Finding("Brand Consistency", "critical",
                               "Legacy brand name 'ProCRM' found — should be 'SDR CRM'",
                               detail=h))
    else:
        result.add(Finding("Brand Consistency", "pass",
                           "All files use 'SDR CRM' branding"))


def check_apollo_leak(result: AuditResult) -> None:
    """
    Apollo should not appear in user-visible frontend strings.
    OK in: code comments, identifiers (apolloApi / apolloId / setSavingApollo / …),
           API URL paths (/api/apollo/*), import paths.
    Critical: JSX text, placeholder/title/alt attrs, user-facing string literals.
    """
    pat = re.compile(r"[Aa]pollo")
    critical_hits = []
    ok_hits = []

    for path in iter_frontend_src_files((".ts", ".tsx")):
        text = path.read_text(encoding="utf-8")
        for i, line in enumerate(text.splitlines(), 1):
            if not pat.search(line):
                continue
            stripped = line.lstrip()
            if is_comment_line(stripped):
                ok_hits.append((f"{path.relative_to(ROOT)}:{i}", "comment"))
                continue
            # Strip all identifier / URL / import usages, see what's left
            remaining = strip_code_apollo(line)
            if pat.search(remaining):
                critical_hits.append((f"{path.relative_to(ROOT)}:{i}", line.strip()[:100]))
            else:
                ok_hits.append((f"{path.relative_to(ROOT)}:{i}", "identifier/URL"))

    for loc, snippet in critical_hits:
        result.add(Finding(
            "Apollo Leak (user-visible)",
            "critical",
            "Apollo name leaked to user-facing string",
            location=loc, detail=snippet,
        ))
    if not critical_hits:
        result.add(Finding(
            "Apollo Leak (user-visible)",
            "pass",
            f"No user-visible 'Apollo' strings ({len(ok_hits)} OK occurrences in code identifiers / comments / API URLs)",
        ))


def check_contact_info(result: AuditResult) -> None:
    """
    Admin email should be info@amazonsolutions.us everywhere.
    Previously was admin@amazonsolutions.us — should be 0 now.
    """
    bad = re.compile(r"\badmin@amazonsolutions\.us\b")
    hits = []
    for path in list(iter_frontend_src_files()) + list(iter_backend_files()):
        text = path.read_text(encoding="utf-8")
        for i, line in enumerate(text.splitlines(), 1):
            if bad.search(line):
                hits.append(f"{path.relative_to(ROOT)}:{i}  —  {line.strip()[:100]}")
    if hits:
        for h in hits:
            result.add(Finding("Contact Info", "warning",
                               "Old 'admin@' email still present (should be 'info@')",
                               detail=h))
    else:
        result.add(Finding("Contact Info", "pass",
                           "Admin email uses 'info@amazonsolutions.us' consistently"))


# ============================================================================
# Reporting
# ============================================================================

def print_report(result: AuditResult) -> None:
    c = SEVERITY_ICON
    print("\n" + "=" * 70)
    print("  SDR CRM — SITE AUDIT REPORT")
    print("=" * 70)

    groups = [
        (result.critical, c["critical"], "CRITICAL ISSUES (must fix)"),
        (result.warnings, c["warning"], "WARNINGS (should review)"),
        (result.infos, c["info"], "INFO"),
        (result.passed, c["pass"], "PASSED CHECKS"),
    ]
    for items, icon, title in groups:
        if not items:
            continue
        print(f"\n{icon} {title} ({len(items)})")
        print("-" * 70)
        for f in items[:50]:  # cap per group
            loc = f.location or ""
            msg = f.message
            detail = f.detail or ""
            line = f"  • [{f.category}] {msg}"
            if loc:
                line += f"  ({loc})"
            if detail:
                line += f"\n    → {detail[:140]}"
            print(line)
        if len(items) > 50:
            print(f"  ... +{len(items)-50} more (see audit-report.md)")

    print("\n" + "=" * 70)
    print(f"Summary: {c['critical']} {len(result.critical)} critical · "
          f"{c['warning']} {len(result.warnings)} warnings · "
          f"{c['info']} {len(result.infos)} info · "
          f"{c['pass']} {len(result.passed)} passed")
    print("=" * 70 + "\n")


def write_markdown(result: AuditResult) -> None:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        f"# SDR CRM — Site Audit Report",
        f"",
        f"Generated: {now}",
        f"",
        f"## Summary",
        f"",
        f"- 🔴 **Critical**: {len(result.critical)}",
        f"- 🟡 **Warnings**: {len(result.warnings)}",
        f"- ℹ️ **Info**: {len(result.infos)}",
        f"- 🟢 **Passed**: {len(result.passed)}",
        f"",
    ]

    def section(title: str, items: List[Finding]) -> List[str]:
        out = [f"## {title}", ""]
        if not items:
            out.append("_None_")
            out.append("")
            return out
        for f in items:
            bullet = f"- **{f.category}** — {f.message}"
            if f.location:
                bullet += f" ({f.location})"
            if f.detail:
                bullet += f"\n  - `{f.detail[:200]}`"
            out.append(bullet)
        out.append("")
        return out

    lines += section("🔴 Critical Issues (must fix)", result.critical)
    lines += section("🟡 Warnings (should review)", result.warnings)
    lines += section("ℹ️ Info", result.infos)
    lines += section("🟢 Passed Checks", result.passed)

    lines += [
        "## Recommendations",
        "",
        "1. Resolve all Critical findings before deploying to production.",
        "2. Triage Warnings — decide fix-now vs. backlog.",
        "3. Periodically re-run `scripts/site-audit.sh` (or add as a pre-deploy gate).",
        "",
    ]

    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(f"📄 Report written to: {REPORT_PATH.relative_to(ROOT)}")


# ============================================================================
# Main
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description="SDR CRM site audit")
    parser.add_argument("--json", action="store_true", help="Output JSON to stdout")
    args = parser.parse_args()

    result = AuditResult()

    # Run all checks
    check_chinese(result)
    check_links(result)
    check_typescript(result)
    check_console_log(result)
    check_todo_fixme(result)
    check_security(result)
    check_brand(result)
    check_apollo_leak(result)
    check_contact_info(result)

    if args.json:
        payload = {
            "findings": [f.__dict__ for f in result.findings],
            "summary": {
                "critical": len(result.critical),
                "warnings": len(result.warnings),
                "info": len(result.infos),
                "passed": len(result.passed),
            },
        }
        print(json.dumps(payload, indent=2))
    else:
        print_report(result)
        write_markdown(result)

    sys.exit(1 if result.critical else 0)


if __name__ == "__main__":
    main()
