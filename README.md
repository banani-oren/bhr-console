# BHR Console

Internal financial and operational management system for **Banani HR** — an HR boutique firm offering recruitment outsourcing, LinkedIn workshops, employer branding, and AI training.

Built for Oren (CEO) to get real-time visibility into placements, hourly billing, team bonuses, and client agreements — all in one place.

---

## Stack

- **React 19** + **Vite 8** + **TypeScript 6**
- **TailwindCSS v4** + **shadcn/ui**
- **Supabase** — auth, Postgres, RLS, Storage, Edge Functions
- **@tanstack/react-query** — server state
- **react-router-dom v6** — routing
- **vite-plugin-pwa** — installable PWA with offline support
- **Vercel** — CI/CD and hosting

Interface language: **Hebrew (RTL)**

---

## Getting Started

```bash
# Install dependencies
npm install

# Copy env template and fill in values
cp .env.example .env.local

# Start dev server
npm run dev
```

Open `http://localhost:5173`

---

## Environment Variables

Create `.env.local`:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Both values are in the Supabase project dashboard under **Settings → API**.

---

## Commands

```bash
npm run dev        # dev server with HMR
npm run build      # production build (tsc + vite)
npm run lint       # ESLint
npm run preview    # preview production build locally
npx tsc --noEmit   # type-check only
```

---

## Database

Schema and RLS policies: `supabase-schema.sql`

Run it in the **Supabase SQL Editor** to bootstrap a fresh project.

Edge functions: `supabase/functions/`
- `delete-user` — deletes an auth user (admin only)
- `extract-agreement` — extracts structured data from a PDF agreement

---

## Deployment

Vercel auto-deploys on push to `main`. Config: `vercel.json` (SPA rewrite rules).

Environment variables must be set in the **Vercel project settings** as well.

---

## Architecture Notes

- See `CLAUDE.md` for the full codebase map, patterns, and architectural decisions.
- `agreements` has a **1:1 relationship** with `clients` — upserted on `client_id` conflict.
- **Mobile** (`/m/*`) is scoped to hours entry only — no admin surfaces.
- Transaction form fields are **fully dynamic**, driven by `service_types.fields` from the database.
- Money is stored as Postgres `numeric` — no floating-point arithmetic anywhere.
