# Transcript Q&A — Setup Checklist

Simple, non-technical instructions for what to put in place before (and
alongside) the build. Companion to the full technical blueprint in
[`transcript-rag-app-plan.md`](./transcript-rag-app-plan.md).

Each item is roughly a 15–30 minute task.

---

## Step 1 — Create the core accounts (day one)

| # | What | Where | Notes |
|---|---|---|---|
| 1 | **GitHub repository** for the app | github.com | e.g. `transcript-qa` (separate from this workspace repo) |
| 2 | **Supabase** account + project | supabase.com | Free tier to start. One account provides three things: the Postgres database, the pgvector extension (one click), and file storage for raw transcript files — no separate S3 needed for a pilot |
| 3 | **Anthropic API** key | console.anthropic.com | Powers answer generation. Set a monthly spend limit (start at $50–100/mo) |
| 4 | **Voyage AI** key | voyageai.com | Powers embeddings (semantic search). Cost is tiny — embedding ~1,000 hours of transcripts is a few dollars |

That's it for a pilot. **Four accounts.**

## Step 2 — Configure them (with your developer)

5. In Supabase:
   - Enable the **pgvector extension** (Database → Extensions → `vector`).
   - Create a **private storage bucket** named `transcripts`.
   - Turn on **Row Level Security**.
6. Store the API keys in a **password manager** (1Password / Bitwarden) as
   the source of truth. The developer loads them into the app's secret
   settings — **never into the code or the repo**.
7. Authentication: use **Supabase Auth** (built into the same account —
   email/password + invites) for the pilot. Only buy a dedicated auth
   product (WorkOS / Auth0) later, when a distributor asks for single
   sign-on (SSO).

## Step 3 — Prepare the content side (no developer needed — start now)

8. **Gather the transcripts in one folder** (Dropbox / Drive is fine as a
   staging area). Preferred formats, best first:
   1. JSON with speaker names + timestamps
   2. VTT or SRT subtitle files
   3. Plain text / DOCX (works, but answers lose timestamp citations)
9. **Fill in the metadata spreadsheet** — one row per transcript. Template:
   [`templates/transcript-metadata-template.csv`](./templates/transcript-metadata-template.csv).
   This becomes the bulk-import manifest and forces the licensing decisions
   early.
10. **Write down the access rules** — one line per grant, e.g. *"Distributor
    X gets Season 1–3, US/Canada, through June 2027."* Template:
    [`templates/entitlements-template.csv`](./templates/entitlements-template.csv).
    This maps directly to the app's entitlements system.
11. **Draft ~50 test questions with known answers**, plus ~10 questions the
    transcripts *cannot* answer (the app must say "not found" on those).
    Template: [`templates/test-questions-template.csv`](./templates/test-questions-template.csv).
    This becomes the accuracy test suite — the most valuable thing a
    non-developer can contribute.

## Step 4 — Going from pilot to production

12. **Hosting**: Vercel (frontend) + Render or Fly.io (backend) — simplest;
    or AWS if IT standards require it. ~$50–100/month.
13. Upgrade Supabase to **Pro** (~$25/month) for backups and no project
    pausing.
14. Add **Langfuse** (free tier, langfuse.com) so you can see exactly which
    transcript passages produced each answer — essential for debugging any
    accuracy complaint.

## Rough running cost

| Stage | Monthly |
|---|---|
| Pilot | ~$25–75 (mostly Anthropic API usage) |
| Production, moderate use | ~$150–400 (hosting + database + LLM usage) |

The biggest variable is **question volume** — LLM cost scales with how many
questions get asked, roughly **$0.01–0.03 per answered question** at
Sonnet-class pricing.

---

## Quick-reference: who does what

| Task | Owner |
|---|---|
| Create accounts (Steps 1) | Operations |
| Configure Supabase, secrets, auth (Step 2) | Developer (with ops holding the keys) |
| Gather transcripts + metadata sheet (Steps 8–9) | Operations / content team |
| Access rules (Step 10) | Whoever owns distribution licensing |
| Test questions (Step 11) | Content team / subject-matter experts |
| Hosting & monitoring (Steps 12–14) | Developer |
