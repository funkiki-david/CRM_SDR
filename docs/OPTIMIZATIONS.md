# SDR ProCRM — Pending Optimizations & TODOs

## Deployment

- [ ] **Supabase cloud database migration** — Connect to Supabase PostgreSQL for production. Local `.env` `DATABASE_URL` needs to be updated with the correct Supabase Session mode connection string (`postgresql+asyncpg://...`). The "Tenant or user not found" error was likely a Session vs Transaction mode issue. Revisit when ready to deploy.
- [ ] Deploy backend to Railway
- [ ] Deploy frontend to Vercel
- [ ] Configure custom domain `crm.amazonsolutions.us`
- [ ] Set up Upstash Redis for production cache

## Email System

- [ ] Gmail OAuth integration (actual sending via Gmail API)
- [ ] Email open/click tracking (pixel tracking)
- [ ] Inbox sync (auto-import replies to activity timeline)

## AI Features

- [ ] AI voice parsing with Whisper (auto-extract contact, type, follow-up date from speech)
- [ ] Similar customer discovery (on new lead import, find most similar closed-won contacts)
- [ ] Auto-generate reports on Apollo import (batch)

## Security

- [ ] Change default admin password mechanism (force change on first login)
- [ ] Encrypt OAuth tokens at rest in database
- [ ] Rate limiting on auth endpoints
