# SDR ProCRM — Deployment Guide

## Architecture

```
Browser → Vercel (Frontend) → Railway (Backend API) → Supabase (PostgreSQL + pgvector)
```

## Step 1: Supabase (Database)

1. Go to [supabase.com](https://supabase.com) → Sign up / Log in
2. Click **New Project** → Name it `sdr-procrm`
3. Choose a strong database password → **Save it** (you'll need it later)
4. Region: choose the closest to your users (e.g. `US East`)
5. Wait for the project to be created (~2 minutes)
6. Go to **Settings → Database** → Copy the **Connection string (URI)**
   - It looks like: `postgresql://postgres:PASSWORD@db.xxxxx.supabase.co:5432/postgres`
   - **Change** `postgresql://` to `postgresql+asyncpg://` (our backend needs this format)
7. Go to **SQL Editor** → Run this query to enable pgvector:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```

## Step 2: Railway (Backend)

1. Go to [railway.app](https://railway.app) → Sign up with GitHub
2. Click **New Project → Deploy from GitHub repo**
3. Select your repo → Set the **Root Directory** to `backend`
4. Go to **Variables** tab and add:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | Your Supabase connection string (with `postgresql+asyncpg://`) |
| `SECRET_KEY` | Run `openssl rand -hex 32` in Terminal to generate |
| `JWT_ALGORITHM` | `HS256` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `480` |
| `FRONTEND_URL` | `https://crm.amazonsolutions.us` (or your Vercel URL) |
| `REDIS_URL` | (optional — add later from Upstash if needed) |

5. Railway will auto-detect Python and deploy. You'll get a URL like `sdr-procrm-backend.up.railway.app`
6. Test it: open `https://YOUR-RAILWAY-URL/` → should see `{"status":"ok"}`

## Step 3: Vercel (Frontend)

1. Go to [vercel.com](https://vercel.com) → Sign up with GitHub
2. Click **Add New → Project → Import** your GitHub repo
3. Set **Root Directory** to `frontend`
4. In **Environment Variables**, add:

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_API_URL` | `https://YOUR-RAILWAY-URL` (from Step 2) |

5. Click **Deploy** → Wait for build to finish (~2 minutes)
6. You'll get a URL like `sdr-procrm.vercel.app`

## Step 4: Custom Domain (Optional)

### On Vercel:
1. Go to your project → **Settings → Domains**
2. Add `crm.amazonsolutions.us`
3. Vercel will tell you to add a CNAME record

### In your DNS provider (Cloudflare / GoDaddy / etc.):
1. Add a CNAME record:
   - Name: `crm`
   - Target: `cname.vercel-dns.com`
2. Wait for DNS propagation (~5 minutes)

## Step 5: Verify Everything

1. Open `https://crm.amazonsolutions.us` (or your Vercel URL)
2. Login with: `admin@amazonsolutions.us` / `admin123`
3. **Change the password immediately after first login**
4. Go to Settings → Add your API keys (Apollo, Anthropic, OpenAI)

## Environment Variables Summary

### Railway (Backend)
- `DATABASE_URL` — Supabase PostgreSQL connection
- `SECRET_KEY` — Random string for JWT signing
- `FRONTEND_URL` — Your frontend domain for CORS
- `APOLLO_API_KEY` — (optional, can set via Settings page)
- `ANTHROPIC_API_KEY` — (optional, can set via Settings page)
- `OPENAI_API_KEY` — (optional, can set via Settings page)

### Vercel (Frontend)
- `NEXT_PUBLIC_API_URL` — Your Railway backend URL
