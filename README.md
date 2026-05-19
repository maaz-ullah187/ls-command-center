# Business Data Brain — Template

An open-source template for building a unified business-intelligence dashboard
for a coaching / agency / info-product business. It pulls **leads, ads,
payments, calls, content, and team activity** from a stack of common SaaS
tools into one Supabase warehouse, then renders the whole picture in a
Next.js dashboard.

This repo is **a template** — fork it, plug in your own credentials, and
adjust the mappers / migrations / components for your own business model.

## Live demo

The original (private) version of this dashboard runs at
`https://your-dashboard.vercel.app`. Spin up your own copy by following the
setup instructions below.

## What's inside

A 3-tier architecture:

```
[ Meta / GHL / Whop / Fanbasis / Stripe / Grain / Fathom / Slack / Calendly /
  Typeform / YouTube / Instagram / X / LinkedIn / Mercury / Monday / Manychat ]
                                      │
                                      ▼
                          Sync workers (Vercel Cron)
                          src/lib/sync/<source>.ts
                                      │
                                      ▼
                              Supabase Postgres
              (leads, ads, payments, calls, daily_metrics,
               content_posts, eod_reports, lead_scores, overrides, …)
                                      │
                                      ▼
                          src/lib/dataSources.ts
                          (left-joins overrides on every read)
                                      │
                                      ▼
                          Dashboard / tabs / charts / chat panel
```

### Key pieces

- **`src/lib/dataSources.ts`** — central switching layer. Components never
  call third-party APIs directly. They call this. It tries live source →
  Supabase table → mock data, in that order, and left-joins user overrides
  on every read.
- **`src/lib/mappers/`** — one file per integration. Pull / parse / shape.
- **`src/lib/sync/`** — Vercel Cron workers that hydrate Supabase tables.
- **`src/lib/parsers/slack/`** — parse structured Slack messages
  (closer EODs, new-client notifications, payment notifications) into rows.
- **`src/lib/scoring/`** — Claude-powered qualitative lead scoring.
- **`src/lib/chat/`** — AI chat panel with tool-use over your dashboard data.
- **`supabase/migrations/`** — SQL migrations for the warehouse schema.
- **`src/components/`** — React components. `Dashboard.tsx` is the top.

### Stack

- **Framework:** Next.js 15 App Router (Turbopack), React 19, TypeScript
- **Styling:** Tailwind CSS v4
- **Database:** Supabase Postgres (free tier works for dev)
- **AI:** Anthropic Claude (Opus / Sonnet) via `@anthropic-ai/sdk`
- **Charts:** Recharts
- **Hosting:** Vercel (free tier works for dev)

## Quick start

### 1. Clone and install

```bash
git clone https://github.com/<your-username>/business-data-brain-template.git
cd business-data-brain-template
npm install
```

### 2. Set up Supabase

1. Create a new project at https://supabase.com
2. Open the SQL Editor and run each file in `supabase/migrations/` in order
   (`0001_init.sql`, `0002_overrides.sql`, …).
3. Grab your `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and
   `SUPABASE_ANON_KEY` from Project Settings → API.

### 3. Configure environment

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in **at minimum**:

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `DASHBOARD_AUTH_PASS`, `DASHBOARD_AUTH_SECRET` (any strings)

The dashboard runs in mock-data mode for any integration whose env vars
aren't set, so you can flip on integrations one at a time.

### 4. Run

```bash
npm run dev
```

Open http://localhost:3000 and log in with `DASHBOARD_AUTH_PASS`.

## Adding integrations one at a time

This template was built **pillar by pillar** — you connect one source,
verify the dashboard matches the source system's native UI, ship it, then
move to the next. Don't try to wire up 12 integrations at once.

Recommended order:

| Pillar | Integration | What it lights up |
|---|---|---|
| 0 | Supabase + Auth | The shell, the overrides table |
| 1 | Meta Ads | Spend / impressions / CPL / ROAS cards |
| 2 | GHL | Lead records, pipeline stage, closer assignment |
| 3 | Calendly + Typeform | Booked-call enrichment, application answers |
| 4 | Whop / Fanbasis / Stripe | Cash collected, contracted revenue |
| 5 | Grain (+ Fathom fallback) | Call recordings, transcripts |
| 5.5 | Anthropic | Qualitative lead scoring |
| 6 | Slack | EODs, new-client notifs, payment notifs |
| 6.5 | Anthropic + tool-use | AI chat panel |
| 7 | YouTube | Video performance |
| 8 | Instagram / X / LinkedIn | Organic content perf |

Each integration's credentials and behaviour are documented in
`.env.example` and in the relevant mapper file's header comment.

## Three programs

The template ships with three placeholder offers — `Program A`, `Program B`,
`Program C` — wired through types, components, scoring, and migrations.
Rename them globally to your actual programs:

```bash
# adjust the strings to your offers, then:
grep -rln 'Program A\|Program B\|Program C' src/ supabase/ | xargs sed -i '' \
  -e 's/Program A/Launch & Land/g' \
  -e 's/Program B/License & Scale/g' \
  -e 's/Program C/Done-For-You/g'
```

(Or do it the safer way — search-and-replace via your editor and review each
match.)

The `Program` enum in `src/lib/types.ts` and the program enum in
`supabase/migrations/0001_init.sql` need to stay in sync.

## Overrides — the editable layer

Every value rendered through `dataSources.ts` is left-joined against an
`overrides` table. Operators can hover any number, click the pencil, type a
correction, save → it persists to Supabase and wins on every future read.
Sync workers never mutate source rows.

This is essential for businesses where source data is messy: Slack typos,
GHL attribution gaps, Whop product-name drift. The dashboard becomes the
source of truth without touching the source systems.

## Deploying to Vercel

```bash
vercel link        # link to a new Vercel project
vercel env add ... # set every env var in `.env.example` you care about
vercel deploy      # preview
vercel deploy --prod
```

The `vercel.json` cron schedule wires up the sync workers. If you don't want
all of them running, prune `vercel.json`.

## Caveats / non-goals

- **This is a template, not a product.** Some mappers assume specific
  conventions of the original business (e.g. Slack EOD message format from
  RepVision, Calendly event-name patterns). Adjust to your conventions.
- **Some sync workers won't run out-of-the-box** because they assume a
  specific Slack message schema or specific GHL custom-field IDs. Read the
  mapper before trusting the sync.
- **The mock data is for SSR / dev.** It's deterministic but it's not your
  data. Get to live data quickly.
- **No tests.** The original repo doesn't ship tests; this template doesn't
  either.

## Contributing

This is a fork-friendly template. Open issues and PRs are welcome but the
repo is intentionally small-scope — most improvements should land in your
own fork rather than here.

## License

MIT — see `LICENSE`.
