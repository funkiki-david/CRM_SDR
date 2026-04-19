# SDR CRM — Project Briefing for Coworkers

Date: April 17, 2026
Repo: https://github.com/funkiki-david/CRM_SDR
Owner: David Zheng


## What Is This?

We are building an internal CRM system designed specifically for SDR (Sales Development Rep) teams. It helps sales reps find prospects, track conversations, send personalized cold emails, and use AI to research contacts — all in one place.

Think of it as a lightweight Salesforce alternative, built around our specific workflow.


## Tech Stack

- Frontend: Next.js 15 (React) with TypeScript and Tailwind CSS
- Backend: Python FastAPI with SQLAlchemy
- Database: PostgreSQL 16 with pgvector extension (for AI-powered search)
- AI: Anthropic Claude (Haiku 4.5) for research reports, email drafting, and smart search
- Integrations: Apollo.io for prospecting, Gmail API for email (planned)


## Current Status: Working Locally

The entire system runs on David's MacBook. All features below are functional at localhost.

NOT yet deployed to cloud — a Railway deployment was attempted on April 16-17 but was rolled back due to configuration issues. Redeployment is planned.


## What the System Can Do Right Now

LOGIN AND PERMISSIONS

Four user accounts exist with three permission levels:
- David Zheng (Admin) — full access to everything including settings and user management
- GT Marketing, GT Doug, GT Steve (Managers) — can see all contacts and data, but cannot change settings or manage users
- SDR role (not yet created) — would only see their own assigned contacts

DASHBOARD (what you see first after login)

- Today's Follow-up List: shows which contacts need attention today, sorted by urgency (overdue in red, due today in yellow, upcoming in blue)
- Activity Feed: a timeline showing recent team activity like "David sent an email to John Smith" or "David had a call with Sarah Lee"

CONTACTS PAGE

- Left panel (30% width): scrollable list of all contacts with search and checkboxes for bulk selection
- Right panel (70% width): detailed view of the selected contact including name, title, company, email, phone, city/state, LinkedIn link, website link, industry tags, AI research reports, activity timeline, and AI suggestions
- Add Contact button: opens a modal with full form validation, email dedup detection, and industry tag support
- Three buttons at top: Add, Import CSV (not yet built), Export CSV (not yet built)

FINDER (Apollo Integration)

- Search form with filters: job titles, location, company domain, company size
- Results show each person with a green "New Lead" or blue "Exists" badge (auto-checks against our database)
- Bulk select and import with a summary report ("Added 12, updated 3")
- Requires an Apollo.io API key (configured in Settings)

EMAIL SYSTEM

- Email template library with 4 built-in templates (Initial Outreach, Follow-up, Value-Add, Break-up)
- Create, edit, and delete templates with variable placeholders like first name, company name, etc.
- Compose email from a contact's detail page — pick a template, it auto-fills the contact's info
- AI Draft button that generates a personalized email using Claude
- Emails are currently recorded in the system but NOT actually sent via Gmail (Gmail OAuth integration is pending)

AI FEATURES (requires Anthropic API key)

- Person Research Report: generates a 3-4 paragraph brief about a contact's likely responsibilities, pain points, and outreach angles
- Company Research Report: similar analysis for the contact's company
- AI Email Draft: writes a personalized cold email using all available context (contact info, research reports, activity history)
- Smart Search: ask questions in plain English like "who mentioned budget problems" and Claude reads through all activity records to find matches
- Industry Tags: auto-generated keyword tags for each contact

QUICK ACTIVITY LOGGING

- Floating modal accessible from any page via the "+ Log Activity" button
- Select contact, pick activity type (Call, Email, LinkedIn, Meeting, Note), write notes
- Voice input support: click the microphone button and speak — auto-converts to text (Chrome only)
- Optional follow-up date and reason

SETTINGS PAGE (Admin only)

- Apollo.io API key input with connection status
- Anthropic (Claude AI) API key input with auto-validation (tests the key on save)
- Email account management (add/remove Gmail accounts)


## Data in the System

- 126 contacts total (117 real contacts imported from a CSV, plus 9 test contacts)
- Real contacts are primarily dealers and printers in Texas, Oklahoma, and surrounding states
- 4 email templates ready to use
- About 15 test activity records


## What Is NOT Done Yet

Must fix before deployment:
1. Frontend code is not properly tracked in GitHub due to a git submodule issue — needs to be converted to a regular directory
2. Cloud deployment to Railway needs to be re-attempted
3. Database URL format auto-conversion for Railway compatibility

Features not yet built:
4. Gmail OAuth — actual email sending through Gmail API
5. Email open and click tracking
6. Import CSV wizard (3-step: upload, map columns, preview and import)
7. Export CSV with field selection
8. API key encryption for secure storage
9. AI voice parsing (auto-extract contact name, activity type, follow-up date from speech)
10. Audit logging (who did what, when)


## How the Code Is Organized

The project has two main directories:

backend/ — Python FastAPI application
- app/main.py is the entry point
- app/models/ has 8 database table definitions (users, contacts, leads, activities, email_accounts, email_templates, sent_emails, embeddings)
- app/api/routes/ has 9 API route files handling authentication, contacts, activities, dashboard, email templates, email sending, Apollo integration, AI features, and system settings
- app/services/ has two service files — one for Claude AI, one for Apollo.io API
- app/core/ has configuration, database connection, authentication, and security utilities

frontend/ — Next.js React application
- src/app/ has 7 page directories (login, dashboard, contacts, finder, ai-search, templates, settings)
- src/components/ has 4 business components (app-shell layout, quick-entry modal, email-compose modal, add-contact modal) plus 15 shadcn UI components
- src/lib/api.ts is the single file that handles all communication with the backend

docs/ — Project documentation
- Original project plan, optimization backlog, deployment guides, contact data CSV, feature specs


## Key Design Decisions

- All AI features use a single Anthropic API key (no OpenAI dependency)
- All Apollo API calls go through the backend to keep the API key secure
- All timestamps are stored in UTC, converted to local time in the frontend
- Contact dedup is based on email address
- Manager role can see all data (same as Admin), only SDR role is restricted
- The system uses JWT tokens for authentication (8-hour expiration)
- UI design is clean white/light theme, no dark mode, no complex charts


## For Anyone Continuing Development

Read these files first:
1. CLAUDE.md (project root) — project memory and conventions
2. docs/SDR-CRM-Project-Plan-v2.md — the original feature spec
3. docs/OPTIMIZATIONS.md — prioritized backlog of improvements
4. docs/CONTACTS-ENHANCEMENT-SPEC.md — detailed spec for Import/Export CSV features

To run locally: start PostgreSQL and Redis via Homebrew, activate the Python venv in backend/, run uvicorn, then npm run dev in frontend/. Open localhost:3000.
