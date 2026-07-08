# Transcript Q&A — Technical Plan & Implementation Blueprint

A RAG (Retrieval-Augmented Generation) web application that lets internal admins,
distribution company users, and end viewers ask natural-language questions about
content transcripts and receive **accurate, cited, permission-scoped answers
grounded only in the transcript corpus**.

> Design priorities, in order: **(1) answer accuracy & groundedness,
> (2) source citation, (3) permissions/tenant isolation, (4) usability,
> (5) scalability/operability.**

---

## Table of contents

1. [Product overview](#1-product-overview)
2. [User flows](#2-recommended-user-flows)
3. [App architecture](#3-app-architecture)
4. [Database schema](#4-database-schema)
5. [Vector database / RAG design](#5-vector-database--rag-design)
6. [Transcript ingestion pipeline](#6-transcript-ingestion-pipeline)
7. [Chunking & embedding strategy](#7-chunking--embedding-strategy)
8. [Search & retrieval strategy](#8-search--retrieval-strategy)
9. [Prompting strategy for grounded answers](#9-prompting-strategy-for-grounded-answers)
10. [User permission model](#10-user-permission-model)
11. [API endpoints](#11-api-endpoints)
12. [Suggested tech stack](#12-suggested-tech-stack)
13. [Frontend screens](#13-frontend-screens)
14. [Backend services](#14-backend-services)
15. [Security considerations](#15-security-considerations)
16. [Evaluation & testing plan](#16-evaluation--testing-plan)
17. [MVP scope](#17-mvp-version)
18. [Future advanced features](#18-future-advanced-features)

---

## 1. Product overview

### What it is

A multi-tenant "ask the transcripts" application. The knowledge base is a
library of content transcripts (episodes, webinars, interviews, training
videos, documents) that have already been converted to text and prepared for
retrieval. Users type questions in plain English (or another supported
language); the system retrieves the most relevant transcript passages the user
is *allowed to see*, and an LLM composes an answer **strictly from those
passages**, with inline citations that link back to the exact transcript
snippet — including episode/content title and timestamp or section where
available.

### Who it serves

| User type | Primary jobs-to-be-done |
|---|---|
| **Internal admin** (content owner org) | Upload/manage/tag transcripts, organize collections, manage companies & users, set access rules, monitor usage & answer quality |
| **Distribution company user** | Research licensed content ("What did the speaker say about tariffs in Episode 12?"), verify claims, pull quotes with timestamps, prep marketing/sales material — limited to the transcripts their company has rights to |
| **End user / viewer** | Ask questions about content they can watch ("Where in this series is warehouse automation discussed?"), jump to the exact timestamp, explore related content |

### Key product principles

- **Grounded or silent.** Every answer is synthesized only from retrieved
  transcript chunks. If retrieval finds nothing sufficiently relevant, the app
  says *"I couldn't find this in the transcripts available to you"* — it never
  falls back to the model's general knowledge.
- **Show your work.** Every answer carries citations; every citation expands
  into the verbatim transcript snippet with title, speaker, and timestamp, and
  (optionally) a deep link into the media player.
- **Permission-first retrieval.** Access control is enforced *inside the
  retrieval query* (pre-filtering), not by post-filtering LLM output. A user
  can never have a chunk they're not entitled to enter the LLM context.
- **Metadata is a first-class citizen.** Title, speaker, date, topic, content
  type, rights region, distributor, language — all filterable in the UI and
  all enforced/usable at retrieval time.

### Success metrics

- Groundedness/faithfulness score ≥ 0.95 on the eval set (no unsupported claims).
- Citation accuracy ≥ 0.98 (cited snippet actually supports the sentence).
- Retrieval hit rate (gold chunk in top-k) ≥ 0.90.
- Correct "not found" behavior ≥ 0.95 on out-of-corpus questions.
- Zero cross-tenant leakage (hard requirement, tested continuously).
- P50 time-to-first-token < 2s; P95 full answer < 10s.

---

## 2. Recommended user flows

### 2.1 End user / viewer — "Ask a question"

1. User lands on **Ask** screen (optionally scoped to a specific
   show/episode they arrived from).
2. Types a question; optional filter chips (content type, series, date range,
   language) refine scope. Autosuggest offers recent/popular questions.
3. Submits → streaming answer renders token-by-token with inline citation
   markers `[1] [2]`.
4. Citation markers are clickable: a **Sources panel** shows each snippet
   verbatim — content title, speaker, timestamp, surrounding context — with a
   "Play from 14:32" deep link when media is available.
5. If nothing relevant is found: explicit "Not found in your available
   transcripts" message + suggestions (rephrase, broaden filters, related
   questions that *do* have answers).
6. User can thumbs-up/down the answer and flag "wrong citation" /
   "hallucination" (feeds the eval pipeline).
7. Follow-up questions continue the conversation with context carried over
   (query rewriting handles pronouns: "what did *he* say next?").

### 2.2 Distribution company user — research workflow

1. Logs in → **Library** shows only transcripts licensed to their company
   (rights region + window enforced).
2. Browses/filters by title, speaker, topic, date, content type, language.
3. Opens a transcript → full-text reader with search-within-transcript,
   speaker turns, timestamps.
4. Uses **Ask** either corpus-wide (their entitlement scope) or scoped to a
   selected set of titles ("only Season 3").
5. Copies answer + citations ("Copy with sources") for internal decks;
   exports a snippet report.
6. Company admin (a role within the distributor) can view their team's usage
   and manage their own users (invite, deactivate).

### 2.3 Internal admin — content management

1. Logs into **Admin console**.
2. **Upload**: drag-and-drop transcript files (JSON/VTT/SRT/TXT/DOCX) or bulk
   import from cloud storage; attaches/edits metadata (title, series, episode,
   speakers, date, topics, content type, language, rights region, distributor
   entitlements).
3. Pipeline status view: parsing → chunking → embedding → indexed, with
   per-file errors and retry.
4. **Manage**: edit metadata, re-tag, replace transcript versions
   (re-index is automatic), archive/unpublish (removes from retrieval
   immediately), organize into collections.
5. **Entitlements**: assign which companies (and which regions/date windows)
   can access which titles/collections.
6. **Quality**: review flagged answers, inspect the retrieval trace (query →
   chunks → prompt → answer) for any Q&A, run the eval suite, tune
   synonyms/boosts.
7. **Analytics**: top questions, zero-result questions (content gap signal),
   usage by company, latency and cost dashboards.

### 2.4 "Not found" flow (explicit, first-class)

- Retrieval returns nothing above the relevance threshold → the API returns a
  structured `answer_type: "not_found"` (no LLM free-styling).
- UI shows a distinct state: what was searched, active filters that may have
  narrowed scope ("You're filtered to Season 2 — try removing filters"),
  and nearest-miss topics if any medium-relevance chunks existed.
- Question is logged to the **unanswered questions** report for admins.

---

## 3. App architecture

### 3.1 High-level diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                              CLIENTS                                   │
│   Web app (Next.js)  ·  Admin console (same app, role-gated)  ·  API   │
└───────────────┬────────────────────────────────────────────────────────┘
                │ HTTPS (JWT session)
┌───────────────▼────────────────────────────────────────────────────────┐
│                        API GATEWAY / BFF                               │
│   AuthN (OIDC/JWT) · rate limiting · request validation · audit log    │
└───────┬───────────────────────┬───────────────────────┬────────────────┘
        │                       │                       │
┌───────▼────────┐   ┌──────────▼─────────┐   ┌─────────▼──────────────┐
│  Query/RAG svc │   │  Content mgmt svc  │   │  Identity & access svc │
│  (stateless)   │   │  (uploads, meta,   │   │  (users, orgs, roles,  │
│                │   │   entitlements)    │   │   entitlement resolver)│
└───┬─────┬──────┘   └──────────┬─────────┘   └─────────┬──────────────┘
    │     │                     │                       │
    │     │              ┌──────▼─────────┐             │
    │     │              │ Ingestion      │             │
    │     │              │ workers (queue)│             │
    │     │              └──────┬─────────┘             │
┌───▼─────▼──────────────────── ▼───────────────────────▼───────────────┐
│                          DATA LAYER                                   │
│  Postgres (metadata, users, entitlements, chat history, audit)        │
│  + pgvector OR dedicated vector DB (chunks + embeddings)              │
│  Object storage (raw transcript files, media refs)                    │
│  Redis (cache, rate limits, job queue)                                │
└───────────────────────────────┬───────────────────────────────────────┘
                                │
                     ┌──────────▼──────────┐
                     │   LLM provider      │
                     │  (Claude API):      │
                     │  answer synthesis,  │
                     │  query rewriting,   │
                     │  eval judging       │
                     │  + embedding model  │
                     └─────────────────────┘
```

### 3.2 Request path for a question (the critical path)

1. **AuthN/AuthZ** — gateway validates JWT, loads user → org → role.
2. **Entitlement resolution** — identity service resolves the user's
   *entitlement set*: the set of `transcript_id`s (or collection/region
   predicates) they may query. Cached in Redis (~60s TTL, invalidated on
   entitlement writes).
3. **Query understanding** — small/fast LLM call: rewrite follow-ups into
   standalone queries, extract structured filters mentioned in text
   ("in the March webinar" → date filter), detect language.
4. **Hybrid retrieval** — vector similarity + BM25 keyword search, both
   **hard-filtered by the entitlement set and user-selected metadata
   filters**, then merged (RRF) and re-ranked (cross-encoder) to top-N.
5. **Groundedness gate** — if the best re-ranked score < threshold →
   return `not_found` without calling the answer LLM.
6. **Answer synthesis** — LLM prompt with numbered chunks; streaming
   response with structured citations.
7. **Citation verification** — post-check that every cited chunk ID exists
   in the retrieved set (drop/repair otherwise); optional fast entailment
   check per sentence.
8. **Persist & log** — store Q, retrieved chunk IDs, answer, citations,
   latencies; emit audit event.

### 3.3 Architecture decisions & rationale

- **Modular monolith first, services later.** Deploy one backend app with
  clear internal module boundaries (query, content, identity, ingestion) and a
  separate worker pool. Split into services only when scale demands. Fewer
  moving parts = faster to production-ready.
- **Postgres + pgvector to start** (single source of truth for metadata *and*
  vectors → transactional consistency between entitlements and chunks; one
  backup story). Design the retrieval layer behind an interface so a dedicated
  vector DB (Qdrant/Weaviate/Pinecone) can be swapped in past ~20–50M chunks
  or if QPS demands it.
- **Queue-based ingestion** (Redis/BullMQ or SQS + workers) — uploads are
  async, idempotent, retryable; the API never blocks on embedding jobs.
- **Stateless query service** — horizontal scale behind a load balancer;
  conversation state lives in Postgres, caches in Redis.
- **Everything streamed** — SSE from LLM to client for perceived latency.

---

## 4. Database schema

Postgres. `id`s are UUIDv7. Soft deletes via `deleted_at` where noted.
`orgs` covers both the internal owner org and distribution companies.

```sql
-- ===================== Identity & tenancy =====================

CREATE TABLE orgs (
  id            UUID PRIMARY KEY,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('internal','distributor')),
  status        TEXT NOT NULL DEFAULT 'active',   -- active|suspended
  settings      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            UUID PRIMARY KEY,
  org_id        UUID NOT NULL REFERENCES orgs(id),
  email         CITEXT NOT NULL UNIQUE,
  display_name  TEXT,
  role          TEXT NOT NULL CHECK (role IN
                  ('internal_admin','internal_editor','internal_analyst',
                   'company_admin','company_user','viewer')),
  status        TEXT NOT NULL DEFAULT 'active',
  auth_provider TEXT NOT NULL DEFAULT 'oidc',
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

-- ===================== Content & metadata =====================

CREATE TABLE collections (               -- series, seasons, topics-as-shelves
  id          UUID PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  parent_id   UUID REFERENCES collections(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transcripts (
  id             UUID PRIMARY KEY,
  title          TEXT NOT NULL,
  content_type   TEXT NOT NULL,          -- episode|webinar|interview|doc|training
  series_name    TEXT,
  episode_number INT,
  description    TEXT,
  language       TEXT NOT NULL DEFAULT 'en',        -- BCP-47
  published_at   DATE,                                -- content date
  duration_secs  INT,
  media_url      TEXT,                                -- optional deep-link target
  source_file_key TEXT NOT NULL,                      -- object-storage key (raw upload)
  version        INT NOT NULL DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'processing',  -- processing|indexed|failed|archived
  checksum       TEXT NOT NULL,                       -- dedupe / idempotency
  created_by     UUID NOT NULL REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);

CREATE TABLE transcript_collections (
  transcript_id UUID REFERENCES transcripts(id),
  collection_id UUID REFERENCES collections(id),
  PRIMARY KEY (transcript_id, collection_id)
);

CREATE TABLE speakers (
  id    UUID PRIMARY KEY,
  name  TEXT NOT NULL,
  title TEXT, org TEXT,
  UNIQUE (name, org)
);

CREATE TABLE transcript_speakers (
  transcript_id UUID REFERENCES transcripts(id),
  speaker_id    UUID REFERENCES speakers(id),
  PRIMARY KEY (transcript_id, speaker_id)
);

CREATE TABLE tags (                       -- topics + free-form admin tags
  id    UUID PRIMARY KEY,
  kind  TEXT NOT NULL DEFAULT 'topic',    -- topic|custom
  value TEXT NOT NULL,
  UNIQUE (kind, value)
);

CREATE TABLE transcript_tags (
  transcript_id UUID REFERENCES transcripts(id),
  tag_id        UUID REFERENCES tags(id),
  source        TEXT NOT NULL DEFAULT 'manual',  -- manual|auto (LLM-suggested)
  PRIMARY KEY (transcript_id, tag_id)
);

-- ===================== Chunks & embeddings (pgvector) =====================

CREATE TABLE chunks (
  id             UUID PRIMARY KEY,
  transcript_id  UUID NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
  version        INT  NOT NULL,             -- matches transcripts.version
  seq            INT  NOT NULL,             -- order within transcript
  text           TEXT NOT NULL,             -- chunk body (verbatim)
  context_header TEXT NOT NULL,             -- "Title · Speaker · 14:02–15:31" prefix used at embed time
  start_ms       INT,                       -- timestamp start (NULL for docs)
  end_ms         INT,
  section        TEXT,                      -- doc section heading when no timestamps
  speaker_names  TEXT[],                    -- denormalized for filtering
  token_count    INT NOT NULL,
  embedding      VECTOR(1024),              -- dimension per chosen model
  tsv            TSVECTOR,                  -- BM25-ish keyword search
  -- denormalized filter columns (kept in sync by ingestion; avoids joins in the hot path)
  language       TEXT NOT NULL,
  content_type   TEXT NOT NULL,
  published_at   DATE,
  UNIQUE (transcript_id, version, seq)
);

CREATE INDEX chunks_embedding_idx ON chunks
  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX chunks_tsv_idx        ON chunks USING gin (tsv);
CREATE INDEX chunks_transcript_idx ON chunks (transcript_id);

-- ===================== Entitlements (access control) =====================

-- Grant = (org) may access (a transcript OR a whole collection),
-- optionally constrained by region and a rights window.
CREATE TABLE entitlements (
  id            UUID PRIMARY KEY,
  org_id        UUID NOT NULL REFERENCES orgs(id),
  transcript_id UUID REFERENCES transcripts(id),
  collection_id UUID REFERENCES collections(id),
  rights_region TEXT[],                    -- e.g. {'US','CA'}; NULL = all regions
  starts_at     DATE,
  ends_at       DATE,
  granted_by    UUID NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ,
  CHECK (num_nonnulls(transcript_id, collection_id) = 1)
);
CREATE INDEX entitlements_org_idx ON entitlements (org_id) WHERE revoked_at IS NULL;

-- Materialized resolution: org -> concrete transcript ids (refreshed on write).
-- This is what the retrieval query filters on.
CREATE TABLE org_transcript_access (
  org_id        UUID NOT NULL,
  transcript_id UUID NOT NULL,
  PRIMARY KEY (org_id, transcript_id)
);

-- ===================== Q&A, feedback, audit =====================

CREATE TABLE conversations (
  id         UUID PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id),
  title      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE messages (
  id              UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  role            TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content         TEXT NOT NULL,
  answer_type     TEXT,                    -- grounded|not_found|partial
  rewritten_query TEXT,                    -- post query-understanding
  filters         JSONB,                   -- filters active for this ask
  retrieved       JSONB,                   -- [{chunk_id, score, rank}]
  citations       JSONB,                   -- [{marker, chunk_id, start_ms, ...}]
  model           TEXT,
  usage           JSONB,                   -- tokens, cost, latencies
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE feedback (
  id         UUID PRIMARY KEY,
  message_id UUID NOT NULL REFERENCES messages(id),
  user_id    UUID NOT NULL REFERENCES users(id),
  rating     TEXT NOT NULL CHECK (rating IN ('up','down')),
  reason     TEXT,                          -- wrong_answer|wrong_citation|hallucination|other
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ingestion_jobs (
  id            UUID PRIMARY KEY,
  transcript_id UUID NOT NULL REFERENCES transcripts(id),
  stage         TEXT NOT NULL,              -- parse|chunk|embed|index
  status        TEXT NOT NULL,              -- queued|running|done|failed
  error         TEXT,
  attempts      INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id         UUID PRIMARY KEY,
  actor_id   UUID,                          -- NULL for system
  org_id     UUID,
  action     TEXT NOT NULL,                 -- e.g. entitlement.grant, transcript.archive, qa.ask
  target     JSONB NOT NULL,
  ip         INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Notes:

- **`org_transcript_access`** is the linchpin: entitlement writes (grant,
  revoke, collection membership change, rights-window expiry via a daily job)
  re-materialize the affected org's rows in one transaction. The retrieval
  query then needs only `chunk.transcript_id IN (SELECT transcript_id FROM
  org_transcript_access WHERE org_id = $user_org)` — simple, indexable, and
  auditable. Region/date windows are evaluated at materialization time.
- **Chunk denormalization** (language, content_type, published_at,
  speaker_names) keeps the hot retrieval query join-free; ingestion owns
  keeping it consistent (re-sync job on metadata edits).
- **Versioning**: replacing a transcript bumps `version`, indexes new chunks,
  then deletes old-version chunks atomically — no window where both or
  neither are searchable.

---

## 5. Vector database / RAG design

### 5.1 Store choice

| Option | When |
|---|---|
| **Postgres + pgvector (HNSW)** — *recommended start* | ≲ 10–20M chunks, moderate QPS. One database for metadata + vectors + FTS; entitlement filter is a native SQL predicate; transactional re-indexing. |
| **Qdrant** (self-hosted) or **Pinecone/Weaviate** (managed) | Scale-out: >20M chunks, high QPS, or need for advanced payload-filtered ANN at scale. Keep Postgres as source of truth; vector DB holds `chunk_id + embedding + filter payload (transcript_id, org-agnostic metadata)`. |

Abstraction: a `Retriever` interface (`search(queryVec, filters, allowedTranscriptIds, k)`)
so the backend swap is a config change, not a rewrite.

**Critical design rule regardless of store: entitlement filtering is a
pre-filter inside the ANN query** (SQL `WHERE` with pgvector; payload filter
with Qdrant/Pinecone) — never "retrieve then discard," which both leaks
signal and starves top-k.

### 5.2 Index layout

- Single logical collection of chunks; **tenancy by filter, not by
  per-tenant index** (entitlements overlap heavily across distributors —
  per-tenant indexes would duplicate massively). Revisit per-tenant
  partitioning only if an isolation requirement demands it.
- HNSW parameters (pgvector): `m=16, ef_construction=64`, query-time
  `ef_search` tuned (start 80) for recall ≥ 0.95 vs exact search on the eval set.
- Filterable payload fields: `transcript_id`, `language`, `content_type`,
  `published_at`, `speaker_names`, plus tag IDs (int array) if tag-filtering
  at ANN level proves necessary.

### 5.3 RAG pipeline (summary — details in §7–§9)

```
question ─► query understanding (rewrite + filter extraction + language)
        ─► embed query
        ─► parallel: vector top-40  +  BM25 top-40      (both entitlement-filtered)
        ─► RRF merge ─► cross-encoder re-rank ─► top 8–12 chunks
        ─► groundedness gate (threshold)  ──► not_found response
        ─► expand chunks with neighbor context (seq ±1, same speaker turn)
        ─► answer LLM (numbered sources, strict grounding prompt, streaming)
        ─► citation validation ─► persist ─► respond
```

---

## 6. Transcript ingestion pipeline

Input: transcripts already converted to text — expected formats: **JSON with
speaker turns + timestamps** (preferred), **VTT/SRT**, **plain text / DOCX**
(documents, no timestamps).

### 6.1 Stages (each a queued, idempotent worker step)

```
upload ─► validate ─► parse/normalize ─► enrich ─► chunk ─► embed ─► index ─► publish
```

1. **Upload** — admin UI or `POST /admin/transcripts` (multipart or
   signed-URL to object storage). Compute checksum; duplicate checksum + same
   metadata → reject as duplicate (idempotency). Create `transcripts` row
   (`status=processing`) + `ingestion_jobs`.
2. **Validate** — file type/size limits; schema check for JSON; timestamp
   monotonicity for VTT/SRT; reject or warn with actionable errors surfaced
   in the admin UI.
3. **Parse & normalize** to a canonical internal form:
   ```json
   { "segments": [ { "speaker": "Jane Doe", "start_ms": 842000,
                     "end_ms": 851400, "text": "…" } ],
     "sections": [ { "heading": "…", "segments": [ … ] } ] }
   ```
   - Merge consecutive same-speaker micro-segments into full speaker turns.
   - Clean ASR artifacts (repeated fillers, `[inaudible]` normalization).
   - Language detection (confirm/override declared language).
4. **Enrich** (LLM-assisted, admin-reviewable, non-blocking):
   - Auto-suggest topic tags and a 2–3 sentence summary per transcript.
   - Speaker name canonicalization against the `speakers` table.
5. **Chunk** — per §7; write `chunks` rows (new `version`) without embeddings.
6. **Embed** — batch chunks (e.g. 64/call) through the embedding model with
   retry + rate-limit backoff; write vectors + `tsv`.
7. **Index & publish** — build/refresh index entries; atomic switch: mark
   `status=indexed`, delete previous-version chunks in the same transaction;
   emit `transcript.indexed` audit event; invalidate retrieval caches.

### 6.2 Operational properties

- **Idempotent + resumable**: every stage keyed by `(transcript_id, version, stage)`;
  re-running a stage is safe. Failures park in a dead-letter state visible in
  the admin pipeline dashboard with one-click retry.
- **Bulk import**: CSV/JSON manifest (file key + metadata per row) for
  back-catalog loads; ingestion fans out per file.
- **Re-index on demand**: admin action re-runs chunk→embed→index for a
  transcript (or globally, e.g. after an embedding-model upgrade — run as a
  dual-write migration: new index built in background, flip when complete).
- **Metadata-only edits** don't re-embed — they update transcript rows and
  re-sync denormalized chunk columns.

---

## 7. Chunking and embedding strategy

### 7.1 Chunking

**Unit: speaker-turn-aware semantic windows with timestamp fidelity.**

- **Target size:** 300–500 tokens per chunk; hard cap 800.
- **Boundaries:** never split mid-sentence; prefer splitting at speaker-turn
  boundaries; long monologues split at sentence boundaries near the target
  size.
- **Overlap:** 15% (~60–80 tokens) sentence-aligned overlap between adjacent
  chunks so boundary-straddling answers aren't lost.
- **Timestamps:** each chunk carries `start_ms`/`end_ms` from its first/last
  segment — this powers "Play from 14:32" citations. Documents without
  timestamps carry `section` (heading path) instead.
- **Contextual header (embedded *with* the text):** each chunk is embedded as:
  ```
  [{Series} — {Title} ({date}) · Speaker(s): {names} · {mm:ss–mm:ss}]
  {chunk text}
  ```
  The header dramatically improves retrieval for queries that reference
  titles, speakers, or dates; the verbatim `text` (without header) is what's
  shown to users and sent as source material.
- **Optional contextual summarization** (post-MVP): prepend a one-sentence
  LLM-generated "situating" sentence per chunk (Anthropic-style contextual
  retrieval) — measurable retrieval lift, at ingestion-time LLM cost.

### 7.2 Embeddings

- **Model:** a top multilingual embedding model — e.g. **Voyage
  `voyage-3-large`** (or Cohere `embed-v4`, or open-weight `bge-m3` if
  self-hosting is required). Criteria: multilingual (rights regions imply
  multiple languages), ≥1024-dim quality tier, long-enough input window
  for chunk+header, asymmetric query/document modes.
- **Query vs. document encoding:** use the model's `input_type=query` /
  `document` distinction where supported.
- **Dimension/storage:** 1024-dim float32 ≈ 4KB/chunk → 10M chunks ≈ 40GB —
  fine for pgvector on a well-sized instance; enable scalar quantization when
  moving to a dedicated store.
- **Version pinning:** embedding model + version stored in config and stamped
  on each index generation; never mix embeddings from different models in one
  searchable index (migration = full re-embed behind a flag).

---

## 8. Search and retrieval strategy

### 8.1 Query understanding (fast LLM pass, ~100–300ms with a small model)

- **Conversational rewrite:** fold follow-up questions + pronouns into a
  standalone query using chat history.
- **Filter extraction:** map natural-language constraints to structured
  filters ("in last month's webinars" → `content_type=webinar,
  published_at>=…`), merged with UI-selected filters (UI filters win on
  conflict).
- **Language detection** → search same-language chunks first, cross-language
  as fallback (multilingual embeddings make this a soft preference, not a
  hard filter).
- Skippable via config for latency-sensitive deployments (first question,
  no filters → pass-through).

### 8.2 Hybrid retrieval

Run in parallel, both with the **entitlement pre-filter + metadata filters**:

1. **Dense**: cosine ANN over chunk embeddings, top-40.
2. **Sparse**: Postgres FTS (`ts_rank_cd` over `tsv`, websearch-style query),
   top-40 — catches exact names, product codes, rare terms embeddings blur.

Merge with **Reciprocal Rank Fusion** (k=60). Deduplicate chunks from the
same transcript that overlap (keep best-ranked).

### 8.3 Re-ranking

Cross-encoder re-ranker (e.g. **Cohere Rerank 3.5** or self-hosted
`bge-reranker-v2-m3`) over the fused top-~50 → score each (query, chunk)
pair → keep **top 8–12** for the prompt. This is the single biggest
precision lever in RAG stacks and directly serves the accuracy priority.

### 8.4 Groundedness gate & thresholds

- If top re-rank score < `T_low` (calibrated on the eval set, e.g. 0.25) →
  return `not_found` **without invoking the answer LLM** (cheaper, faster,
  and structurally prevents hallucinated answers to unanswerable questions).
- If between `T_low` and `T_high` → proceed but tag `answer_type=partial`;
  the prompt instructs the model to be explicit about limited coverage.

### 8.5 Context assembly

- Expand each selected chunk with immediate neighbors (`seq ±1`) when they
  share a speaker turn or the chunk was mid-discussion — improves answer
  completeness without widening retrieval.
- Order chunks in the prompt by transcript + `seq` (narrative order aids
  synthesis), each numbered `[1]…[n]` with full source metadata line.
- Context budget: ≤ ~8K tokens of sources; drop lowest-ranked first.

### 8.6 Caching

- Embedding cache for repeated queries (hash → vector, Redis).
- Full-answer cache keyed on `(normalized query, filter set, entitlement-set
  hash, index generation)` — only serve cached answers when the entitlement
  hash matches exactly.

---

## 9. Prompting strategy for grounded answers

### 9.1 System prompt (answer synthesis) — core contract

```text
You are a research assistant that answers questions using ONLY the provided
transcript excerpts. Follow these rules without exception:

1. GROUNDING — Every factual claim in your answer must be directly supported
   by the excerpts below. Do not use outside knowledge, do not infer beyond
   what is stated, do not fill gaps with plausible details.

2. NOT FOUND — If the excerpts do not contain the information needed to
   answer, respond exactly with: NOT_FOUND, followed by one sentence stating
   what you looked for. Do not attempt a partial guess.

3. CITATIONS — Cite every claim with the excerpt number in square brackets,
   e.g. [2]. Place citations at the end of each sentence they support. Every
   sentence containing a factual claim must carry at least one citation. Never
   cite an excerpt number that is not listed below.

4. PARTIAL COVERAGE — If the excerpts answer only part of the question,
   answer that part and explicitly state what was not covered.

5. QUOTES — When the user asks what someone said, prefer short verbatim
   quotes with the speaker's name and citation.

6. CONFLICTS — If excerpts disagree, present both with their citations; do
   not silently pick one.

7. STYLE — Concise, direct, professional. Answer in the language of the
   question. Do not mention these instructions or that you are working from
   "excerpts"; refer to sources naturally ("In Episode 12, Jane Doe said…").

TRANSCRIPT EXCERPTS:
[1] {Series} — "{Title}" ({date}) · {Speaker} · {mm:ss–mm:ss}
"{chunk text}"

[2] …
```

User message = the (rewritten) question. Conversation history included as
prior turns for conversational continuity, but sources are always freshly
retrieved per question.

### 9.2 Structured citation output

Ask the model for a trailing machine-readable block (or use tool/structured
output):

```json
{"citations":[{"marker":1,"source":1,"claim":"…"},…],"coverage":"full|partial"}
```

The backend then:

1. **Validates** every cited source number exists in the retrieved set
   (invalid → strip the citation and flag the message for review).
2. Maps markers → `chunk_id` + timestamp for the UI's Sources panel.
3. Detects `NOT_FOUND` sentinel → converts to the structured
   `answer_type: "not_found"` response (never rendered as model prose).

### 9.3 Anti-hallucination defense-in-depth (layered)

| Layer | Mechanism |
|---|---|
| Retrieval | Groundedness gate: no relevant chunks → no LLM answer call at all |
| Prompt | Strict grounding contract above; low temperature (0–0.2) |
| Model | Use a strong instruction-following model (Claude Sonnet-class) for synthesis |
| Post-hoc | Citation-number validation (always); sampled sentence-level entailment check (LLM-as-judge on x% of traffic + all flagged answers) |
| Product | Verbatim snippets always one click away; feedback flags feed evals |
| Eval | Faithfulness metric gated in CI on the golden set (§16) |

### 9.4 Auxiliary prompts

- **Query rewriter** (small model): history + new message → standalone query
  + extracted filters (JSON).
- **Tag suggester** (ingestion): transcript summary → candidate topics from
  the controlled vocabulary.
- **Eval judge** (offline): (question, answer, sources) → faithfulness /
  relevance / citation-correctness scores.

---

## 10. User permission model

### 10.1 Roles (RBAC)

| Role | Org kind | Capabilities |
|---|---|---|
| `internal_admin` | internal | Everything: content CRUD, entitlements, orgs/users, analytics, eval console, audit log |
| `internal_editor` | internal | Content upload/edit/tag/organize; no entitlement or user management |
| `internal_analyst` | internal | Read-only admin: analytics, Q&A traces, eval results |
| `company_admin` | distributor | Manage own org's users; view own org's usage; query entitled corpus |
| `company_user` | distributor | Query + browse entitled corpus; export citations |
| `viewer` | either / consumer | Query only surfaces exposed to viewers (optionally scoped to a single title/series context they arrived from) |

### 10.2 Resource access (ReBAC-lite via entitlements)

- **Grant model:** `entitlement = (org, transcript-or-collection,
  rights_region[], starts_at, ends_at)`. Collections make bulk licensing
  manageable ("Season 3 to Distributor X in US/CA until 2027-06").
- **Resolution:** grants materialize into `org_transcript_access`
  (org → transcript IDs) on every entitlement/collection write and via a
  daily expiry sweep. Internal-org users implicitly access all
  non-archived transcripts.
- **Viewer scoping:** viewers inherit their org's entitlements; embedded/
  public-viewer deployments use a scoped service org with exactly the
  intended titles.
- **Enforcement points (all of them, not one):**
  1. **Retrieval pre-filter** — `transcript_id ∈ allowed set` inside the
     ANN/FTS query (the security-critical one).
  2. **API layer** — direct object fetches (`GET /transcripts/:id`, chunk
     fetches, media deep links) re-check entitlement.
  3. **UI** — library/filters only display entitled metadata (usability, not
     security).
- **Postgres RLS as a backstop:** row-level security policies on
  `transcripts`/`chunks` keyed to a session-set org ID, so even a buggy query
  path cannot cross tenants.

### 10.3 AuthN

- OIDC via a managed auth provider (Auth0 / WorkOS / Clerk / Cognito):
  email+password with MFA, SSO (SAML/OIDC) for distributor orgs that want it,
  invite-based provisioning, SCIM later.
- Short-lived JWT access tokens (≤15 min) + rotating refresh; org + role
  claims resolved server-side per request (never trusted from the token alone
  for entitlements).
- API keys (hashed, scoped, revocable) for programmatic access, mapped to a
  service user with a role + org.

---

## 11. API endpoints

REST, versioned under `/api/v1`. All authenticated; role requirements noted.
Errors: RFC 9457 problem+json. Pagination: cursor-based.

### Q&A

| Method & path | Role | Description |
|---|---|---|
| `POST /qa/ask` | any | Body: `{question, conversation_id?, filters?, scope?: {transcript_ids?/collection_ids?}, stream: true}`. SSE stream: `token`, `citations`, `done{answer_type, message_id}`. |
| `GET /qa/conversations` · `GET /qa/conversations/:id` | any | Own history |
| `DELETE /qa/conversations/:id` | any | Own history |
| `POST /qa/messages/:id/feedback` | any | `{rating, reason?, note?}` |
| `GET /qa/messages/:id/sources` | any | Full snippets for each citation (re-checked against entitlements) |

### Library (entitlement-scoped reads)

| Method & path | Role | Description |
|---|---|---|
| `GET /transcripts` | any | List/search entitled transcripts; filters: `q, content_type, language, speaker, tag, collection, published_from/to`; facet counts included |
| `GET /transcripts/:id` | any | Metadata + sections/speaker index |
| `GET /transcripts/:id/content` | any | Paginated full text with timestamps |
| `GET /collections` · `GET /speakers` · `GET /tags` | any | Entitled-scope reference data for filter UIs |

### Admin — content

| Method & path | Role | Description |
|---|---|---|
| `POST /admin/transcripts` | editor+ | Create (metadata + file or signed-URL key); returns `ingestion_job` |
| `POST /admin/transcripts/bulk` | editor+ | Manifest import |
| `PATCH /admin/transcripts/:id` | editor+ | Metadata/tags edit |
| `POST /admin/transcripts/:id/replace` | editor+ | New file → new version → atomic re-index |
| `POST /admin/transcripts/:id/archive` · `/restore` | editor+ | Pull from / return to retrieval |
| `POST /admin/transcripts/:id/reindex` | admin | Re-run chunk/embed/index |
| `GET /admin/ingestion-jobs` · `POST /admin/ingestion-jobs/:id/retry` | editor+ | Pipeline monitoring |
| `POST /admin/collections` · `PATCH` · membership ops | editor+ | Organize |

### Admin — access & orgs

| Method & path | Role | Description |
|---|---|---|
| `POST /admin/orgs` · `PATCH /admin/orgs/:id` | admin | Distributor lifecycle |
| `POST /admin/orgs/:id/users` (invite) · `PATCH /admin/users/:id` | admin (company_admin for own org) | User management |
| `POST /admin/entitlements` | admin | Grant `{org_id, transcript_id|collection_id, rights_region?, starts_at?, ends_at?}` |
| `DELETE /admin/entitlements/:id` | admin | Revoke (immediate materialization + cache invalidation) |
| `GET /admin/orgs/:id/entitlements` | admin | Review grants |

### Admin — quality & analytics

| Method & path | Role | Description |
|---|---|---|
| `GET /admin/analytics/questions` | analyst+ | Top / zero-result / flagged questions; by org, date |
| `GET /admin/analytics/usage` | analyst+ | Volume, latency, token cost by org/day |
| `GET /admin/qa/traces/:message_id` | analyst+ | Full retrieval trace (query → chunks → prompt → answer) |
| `POST /admin/evals/run` · `GET /admin/evals/runs/:id` | admin | Trigger/inspect eval suite |
| `GET /admin/audit-log` | admin | Filterable audit events |

---

## 12. Suggested tech stack

| Layer | Recommendation | Rationale / alternatives |
|---|---|---|
| Frontend | **Next.js (React, TypeScript)** + Tailwind + shadcn/ui; TanStack Query; SSE client | Mature, fast to build, great streaming-UI support |
| Backend API | **TypeScript + NestJS (or Fastify)** on Node 22 | One language across the stack; strong typing on the security-critical entitlement path. *Alt:* Python + FastAPI if the team prefers Python for the RAG code |
| Workers/queue | **BullMQ on Redis** (same codebase, separate deployment) | Simple, observable; *alt:* SQS + Lambda/ECS at larger scale |
| Primary DB | **PostgreSQL 16 + pgvector** (managed: RDS/Neon/Supabase) | Metadata + vectors + FTS + RLS in one transactional store |
| Vector scale-out (later) | Qdrant (self-host) or Pinecone (managed) | Behind the `Retriever` interface |
| Cache/limits | Redis (ElastiCache/Upstash) | Entitlement cache, answer cache, rate limits, queue |
| Object storage | S3 (or GCS) with signed URLs | Raw transcript files |
| LLM — synthesis | **Claude Sonnet (latest)** via Claude API | Strong instruction-following + citation discipline; Haiku-class for query rewriting |
| Embeddings | **Voyage `voyage-3-large`** (alt: Cohere embed-v4, open `bge-m3`) | Multilingual, retrieval-tuned |
| Re-ranker | Cohere Rerank 3.5 (alt: self-hosted `bge-reranker-v2-m3`) | Biggest precision lever |
| AuthN | WorkOS or Auth0 (OIDC, SSO, SCIM-ready) | Distributor SSO will be asked for |
| Infra | Docker on AWS ECS Fargate (or Fly.io/Render early); Terraform | Stateless services, easy horizontal scale |
| Observability | OpenTelemetry → Grafana/Datadog; **Langfuse** (or Phoenix/Arize) for LLM traces & evals | Retrieval traces are essential for debugging RAG |
| CI/CD | GitHub Actions: lint, typecheck, tests, **eval-suite gate**, deploy | Quality gate includes RAG metrics, not just unit tests |

---

## 13. Frontend screens

### Shared (all roles)

1. **Ask / Chat** — the home screen. Question box; filter chips (content
   type, series, speaker, date range, language, topic); streaming answer with
   inline `[n]` citation chips; **Sources panel** (right rail / bottom sheet
   on mobile) listing each snippet verbatim with title · speaker · timestamp
   and "Play from mm:ss" / "Open transcript" links; distinct **Not-found
   state** with scope hints; thumbs up/down + flag control; conversation
   history sidebar.
2. **Library** — entitled transcripts as a filterable, faceted list
   (search-as-you-type over titles/descriptions; facet counts). Cards show
   title, series/episode, date, speakers, duration, language, topics.
3. **Transcript reader** — full text with speaker turns and timestamps;
   in-transcript keyword search; "Ask about this transcript" (scoped ask);
   citation deep links land here highlighted at the cited passage.
4. **Auth screens** — login (SSO buttons per org), invite acceptance, profile.

### Distribution company extra

5. **Company usage** (company_admin) — team questions volume, top topics, seat
   management (invite/deactivate own users).

### Internal admin console

6. **Content manager** — table of all transcripts with status
   (processing/indexed/failed/archived), inline metadata edit, tag editor,
   collection organizer (drag into series/collections), upload (single +
   bulk with manifest preview), version replace.
7. **Ingestion pipeline** — job board per stage with errors and retry.
8. **Access manager** — orgs list; per-org entitlement editor (grant titles/
   collections with region + rights window); effective-access preview
   ("view as Distributor X" — renders the library as that org sees it).
9. **Users & roles** — invite, role assignment, deactivate; per-org grouping.
10. **Quality console** — flagged answers queue; full retrieval trace viewer
    (query → rewritten query → retrieved chunks with scores → prompt →
    answer → citation validation results); eval-run dashboard with metric
    trends.
11. **Analytics** — top questions, zero-result questions (content-gap
    report), usage/cost by org, latency percentiles.
12. **Audit log** — filterable viewer (actor, action, target, date).

---

## 14. Backend services

(Modules of the modular monolith; each independently deployable later.)

1. **API gateway / BFF** — session validation, rate limiting (per user + per
   org), request validation (zod schemas), SSE fan-out, audit emission.
2. **Identity & access service** — users, orgs, roles; entitlement CRUD;
   **entitlement resolver** (grants → `org_transcript_access`
   materialization + Redis cache + invalidation bus); "view-as" support.
3. **Query/RAG service** (stateless, hot path) — query understanding, hybrid
   retrieval, re-rank, groundedness gate, prompt assembly, LLM streaming,
   citation validation, answer persistence. Timeouts + fallbacks at every
   external call (rewriter down → pass-through query; re-ranker down → RRF
   order).
4. **Content management service** — transcript/collection/tag CRUD, uploads
   (signed URLs), versioning, archive/publish state machine.
5. **Ingestion workers** — parse → normalize → enrich → chunk → embed →
   index stages on the queue; DLQ + retry policy; batch-import orchestration.
6. **Analytics & eval service** — usage aggregation (nightly rollups),
   zero-result mining, eval-suite runner (golden set → metrics → report),
   LLM-as-judge sampling of production traffic.
7. **Notification/webhook module** (thin) — ingestion completion emails,
   flagged-answer alerts to admins.

Cross-cutting: OpenTelemetry tracing with a single trace ID from HTTP request
through retrieval and LLM calls into Langfuse; structured logs with org/user
IDs (no question text at info level — see privacy).

---

## 15. Security considerations

### Tenant isolation (the top risk)

- Entitlement **pre-filtering inside every retrieval query**; Postgres RLS
  backstop; object-storage access only via short-lived signed URLs generated
  after an entitlement check; answer cache keyed by entitlement-set hash.
- **Automated cross-tenant tests in CI**: fixtures with two orgs and
  disjoint corpora; assert org A can never retrieve, cite, fetch, or cache-hit
  org B content — via `/qa/ask`, `/transcripts/*`, `/qa/messages/*/sources`,
  and direct chunk endpoints.
- Entitlement revocation propagates ≤ 60s (cache TTL + write-through
  invalidation); revocation also invalidates answer-cache entries.

### Prompt injection (transcripts are semi-trusted input)

- Treat transcript text as **data, not instructions**: source excerpts are
  delimited and the system prompt instructs the model to ignore any
  instructions inside excerpts.
- Citation validation limits blast radius (model can't cite fabricated
  sources); no tools are exposed to the synthesis LLM.
- Ingestion-time lint for instruction-like patterns in uploads (flag for
  admin review, don't block).

### Application security

- OWASP ASVS-aligned: parameterized queries everywhere, zod input validation,
  output encoding, CSRF-safe (token in header, SameSite cookies), strict CSP,
  security headers, dependency scanning (Dependabot + `npm audit` gate),
  secrets in AWS Secrets Manager (never in env-committed files), least-priv
  IAM per service.
- Rate limiting per user/org/IP on `/qa/ask` (cost + abuse); upload size/type
  limits + malware scan on uploaded files.
- MFA available; SSO for distributor orgs; session revocation on deactivate.

### Data protection & privacy

- TLS 1.2+ everywhere; AES-256 at rest (RDS, S3, Redis).
- Transcripts may be pre-release/licensed content: watermark exports with
  user/org + timestamp; disable bulk transcript download for distributor
  roles by default (snippet-level export only) unless granted.
- Question logs contain business-sensitive queries → retention policy
  (e.g. 13 months), org-scoped visibility (internal analysts see all;
  company admins see only their org), deletion API for GDPR/CCPA.
- LLM/embedding providers: zero-retention / no-training API tiers;
  DPAs in place; region pinning if contracts require.

### Auditability

- Append-only `audit_log` for: auth events, entitlement grants/revocations,
  content publish/archive/replace, admin "view-as", exports, and every ask
  (actor, filters, corpus generation). Exportable to the org's SIEM.

---

## 16. Evaluation / testing plan

### 16.1 Golden dataset (built before launch, grown continuously)

150–300 examples spanning:

- **Answerable** questions with gold chunk IDs + reference answers
  (factoid, multi-chunk synthesis, quote-retrieval, speaker-specific,
  date/filter-dependent).
- **Unanswerable** questions (plausible but absent from corpus) — expected
  `not_found`.
- **Permission probes** — questions answerable only from another org's
  corpus; expected `not_found` for the restricted user (and answerable for
  the entitled one).
- **Conversational** follow-up chains (tests query rewriting).
- Multi-language samples if corpus is multilingual.

Sources: admin/SME authored + mined from real usage (zero-result and flagged
questions become new cases).

### 16.2 Metrics & gates

| Layer | Metric | Gate (CI, on golden set) |
|---|---|---|
| Retrieval | Recall@10 (gold chunk retrieved) | ≥ 0.90 |
| Retrieval | MRR@10 | trend-tracked |
| Answer | Faithfulness (LLM-judge: every claim supported) | ≥ 0.95 |
| Answer | Citation precision (cited chunk supports the sentence) | ≥ 0.98 |
| Answer | Answer relevance/completeness (judge) | ≥ 0.85 |
| Abstention | Correct `not_found` on unanswerable set | ≥ 0.95 |
| Abstention | False-refusal rate on answerable set | ≤ 0.05 |
| Security | Cross-tenant leakage | **= 0 (hard fail)** |
| Latency | P95 end-to-end on eval harness | ≤ 10s |

Runner: Promptfoo or a Langfuse-integrated harness; judge = Claude with a
rubric prompt; every retrieval/prompt/model config change runs the suite in
CI and blocks merge on gate regression.

### 16.3 Testing pyramid

- **Unit**: chunker (boundaries, overlap, timestamp math), parsers
  (VTT/SRT/JSON edge cases), entitlement resolver (region/window/collection
  logic), citation validator, filter-extraction mapping.
- **Integration**: ingestion pipeline end-to-end on fixture files (upload →
  indexed, version replace atomicity); retrieval query correctness incl.
  entitlement filters against a seeded DB; SSE streaming contract.
- **E2E (Playwright)**: ask → streamed answer → citation click → snippet →
  transcript deep link; admin upload → tag → entitle → distributor user can
  query it; revoke → they can't (within TTL).
- **Security tests**: the cross-tenant suite (§15); authz matrix tests
  (every endpoint × every role); prompt-injection corpus (transcripts
  containing adversarial instructions) asserting no behavior change.
- **Load tests (k6)**: concurrent `/qa/ask` at target QPS; ingestion of a
  1K-file back-catalog; degradation behavior when LLM provider throttles.

### 16.4 Production monitoring

- Online sampled LLM-judge scoring (x% of answers) → faithfulness trend
  alerts; user feedback rates; zero-result rate; per-stage latency; token
  cost per org; embedding/index drift after model upgrades (A/B on golden
  set before flip).

---

## 17. MVP version

**Goal: prove grounded, cited, permission-scoped Q&A with a manageable
corpus — 6–8 weeks of build for a small team.**

### In scope

- Single web app (Next.js + NestJS + Postgres/pgvector + Redis).
- Roles: `internal_admin`, `company_user`, `viewer` (editor/analyst/company_admin fold into admin/user for now).
- Ingestion: JSON + VTT/SRT + TXT upload (single + simple bulk), fixed
  chunking (speaker-turn aware, header-prefixed embeddings), one embedding
  model, admin pipeline status with retry.
- Entitlements: org → transcript/collection grants (region + window fields
  present but region enforcement can start as metadata), materialized access
  table, retrieval pre-filter, RLS backstop.
- Retrieval: hybrid (pgvector + FTS) + RRF + **re-ranker** + groundedness
  gate. (Re-ranker stays in MVP — it's the accuracy backbone. Query
  rewriting can ship as pass-through + follow-up rewrite only.)
- Answers: streaming, strict grounding prompt, numbered citations, citation
  validation, explicit not-found state, Sources panel with verbatim snippets
  + timestamps, thumbs + flag feedback.
- Screens: Ask, Library, Transcript reader, Admin content manager (upload/
  edit/tag/archive), Access manager (grants), basic usage list, login.
- Golden set v1 (~100 cases) + CI eval gate on faithfulness / recall /
  not-found / cross-tenant.
- Audit log, rate limiting, OTel + Langfuse tracing.

### Deliberately out (fast follows)

- Conversation memory beyond simple rewrite; answer cache; contextual chunk
  summaries; SSO/SCIM; company-admin self-serve seats; analytics dashboards
  (raw SQL/reports suffice); media player embedding (deep links only);
  multilingual UI (multilingual retrieval works via the embedding model);
  export/report builder.

### MVP milestones

1. **W1–2** — Schema, auth, org/role scaffolding, upload → parse → chunk →
   embed → index pipeline on fixtures.
2. **W3–4** — Retrieval stack (hybrid + rerank + gate), `/qa/ask` streaming
   with citations + validation; Ask UI.
3. **W5** — Entitlements end-to-end (grants → materialization → pre-filter →
   RLS), Library + Reader, admin content screens.
4. **W6** — Golden set + eval harness in CI; security test suite; load test;
   observability; polish not-found & sources UX.
5. **W7–8** — Pilot with one distributor org; feed real questions into the
   golden set; threshold calibration; hardening → production.

---

## 18. Future advanced features

**Retrieval & answer quality**

- Contextual chunk summaries (Anthropic-style contextual retrieval) and/or
  late-interaction retrieval (ColBERT-style) for another recall step-change.
- Agentic multi-hop answering for cross-episode synthesis questions
  ("How did the panel's view on X evolve across the season?") with per-hop
  citations.
- Per-sentence entailment verification on 100% of answers (as judge costs drop).
- Fine-tuned re-ranker on accumulated click/feedback data.
- Knowledge-graph layer over entities (people, companies, products) for
  "who said what about whom" queries and entity pages.

**Product**

- Media-synced experience: embedded player that follows citations; ask-while-
  watching overlay; clip generation from cited spans.
- Saved research notebooks: pin answers + snippets, export branded PDF/Docx
  reports with citations.
- Alerts/digests: "notify me when new content mentions <topic>"; weekly
  what's-new summaries per distributor, scoped to entitlements.
- Suggested questions per transcript (LLM-generated at ingest) and related-
  content recommendations.
- Public/embeddable widget: scoped viewer Q&A embedded on partner sites
  (iframe + scoped token).

**Platform & enterprise**

- SSO (SAML/OIDC) + SCIM provisioning per distributor; fine-grained custom
  roles; per-org usage quotas and billing/metering.
- Dedicated vector DB migration (Qdrant/Pinecone) + embedding model upgrade
  playbook (dual-index A/B, golden-set gate, atomic flip).
- Public API + webhooks for distributors to integrate Q&A into their own
  portals.
- In-app transcript correction workflow (SME edits → re-index) with
  versioned diffs.
- Speech pipeline upstream: direct audio/video upload → ASR + diarization →
  auto-ingest (removing the "already converted" prerequisite).
- Multi-region deployment + data-residency options for rights regions.

---

*End of blueprint.*
