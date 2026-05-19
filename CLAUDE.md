# Business Data Brain — agent context

This file gives an LLM coding assistant (Claude Code, Cursor, etc.) the
minimum it needs to work in this repo without re-deriving the architecture
from scratch.

## What this is

A template Next.js dashboard that pulls business data from ~12 SaaS sources
into Supabase, applies an overrides layer, and renders it. See `README.md`
for full architecture.

## Hard rules

1. **All reads go through `src/lib/dataSources.ts`.** Components never
   import from `mock-data.ts` directly and never call third-party APIs
   directly. Add a function to the switching layer if you need new data.
2. **All operator edits go through the `overrides` table.** Sync workers
   upsert raw source data; edits left-join on read. Never mutate source
   rows from the UI.
3. **`mock-data.ts` is the dev fallback** when Supabase tables are empty
   or env vars aren't configured. Don't delete it.
4. **Storage = Supabase Postgres.** Not Vercel Postgres. We need pgvector,
   storage buckets, realtime, and RLS in one place.
5. **One integration at a time.** Don't bundle "wire up Meta + GHL +
   Slack" into a single PR. Land them as separate pillars.

## Adding a new integration

1. Add a mapper at `src/lib/mappers/<source>.ts` that fetches from the
   source API and returns typed rows matching `src/lib/types.ts`.
2. Add a sync worker at `src/lib/sync/<source>.ts` that calls the mapper
   and upserts to a Supabase table. Wire its route in
   `src/app/api/sync/<source>/route.ts`.
3. Add a cron entry in `vercel.json` so it runs on a schedule.
4. Update `src/lib/dataSources.ts` so the relevant `getX()` function
   prefers the live table when populated.
5. Update `src/app/api/integrations/status/route.ts` so the System Health
   tab knows when this integration is connected.
6. Add the integration's env vars to `.env.example` with comments.

## File map (high level)

| Path | What it does |
|---|---|
| `src/app/page.tsx` | Main dashboard route (`/`) |
| `src/app/today/page.tsx` | Daily-cadence dashboard |
| `src/app/week/page.tsx` | Weekly-cadence dashboard |
| `src/app/month/page.tsx` | Monthly-cadence + projection setting |
| `src/app/api/data/*` | Read endpoints proxying `dataSources.ts` |
| `src/app/api/sync/*` | Vercel Cron sync workers |
| `src/app/api/scoring/*` | Claude-based qualitative scoring |
| `src/app/api/chat/*` | AI chat panel (tool-use loop) |
| `src/app/api/overrides/*` | CRUD for the overrides table |
| `src/components/Dashboard.tsx` | Top-level component |
| `src/components/main/*` | Cards on the main route |
| `src/lib/dataSources.ts` | The switching layer |
| `src/lib/types.ts` | Canonical TypeScript types |
| `src/lib/mock-data.ts` | Local-dev fallback |
| `src/lib/mappers/*` | One file per integration |
| `src/lib/sync/*` | One file per sync worker |
| `src/lib/parsers/slack/*` | Parse structured Slack messages |
| `src/lib/scoring/*` | Lead-scoring prompts + runners |
| `src/lib/chat/*` | Chat tools + system prompt |
| `src/lib/commission-config.ts` | Team / commission config |
| `supabase/migrations/*.sql` | Warehouse schema |

## Conventions

- Mapper functions take a token + IDs as args, not env vars directly. The
  caller (`dataSources.ts` or a sync worker) reads env. This makes the
  mappers testable.
- All amounts are in dollars (numbers, not strings). Cents are rare.
- Dates in code are ISO strings (`YYYY-MM-DD`) unless the function is
  doing time-of-day work.
- Keep the SQL migration filenames sequential and don't rewrite history —
  add a new migration to fix something rather than editing an existing one.

## What NOT to do

- Don't add a new top-level dependency without a reason. The footprint is
  intentionally small.
- Don't store secrets in the repo. `.env*` files are gitignored.
- Don't write fake data into Supabase. Use `mock-data.ts` for dev.
- Don't hardcode IDs (Slack channel IDs, ad account IDs, GHL location
  IDs, Monday board IDs, etc.) — use env vars. The template has these
  parameterized; keep it that way.
