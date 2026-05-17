# AI Top 25 / Top 50 — Interactive Dashboard

Single-page, dependency-free interactive ranking of AI maturity across North
American wholesale distributors, for Distribution Strategy Group. Built for a
conference QR-code launch and an ungated GEO/engagement page that drives readers
to the gated full report.

- **No build step, no framework, no runtime dependencies.** Vanilla
  HTML/CSS/JS. Works served over HTTP **and** opened directly via `file://`
  (no `fetch`/ES-modules; data is a plain `<script>`).
- **Data-driven.** All copy/numbers come from `data.js`. Switching Phase 1 → 2
  (or refreshing the tracker) is a `data.js` regeneration, not a code change.

## Run locally

```bash
# Option A: any static server
npx http-server -p 8080 -c-1 .
#   -> http://localhost:8080

# Option B: just open the file
open index.html        # file:// works too
```

## Regenerate `data.js` (after a tracker refresh / for Phase 2)

The dashboard ships a generated, filtered `data.js`. To rebuild it from the
source spreadsheet:

```bash
pip install --user openpyxl
SPINE=AI_Top_50_Public_Index_Tracker.xlsx
VERT=AI_Top_50_Rebuilt_v4_with_vertical_column.xlsx
python3 tools/convert_xlsx.py $SPINE --verticals $VERT                  # Phase 1 (Top 25)
python3 tools/convert_xlsx.py $SPINE --verticals $VERT --phase 2        # Phase 2 (Top 50)
python3 tools/convert_xlsx.py $SPINE --verticals $VERT --deterministic  # frozen timestamp (clean diffs)
# (--verticals is auto-detected if a *vertical*.xlsx sits in the repo root)
```

The converter prints a **DATA CHECK** summary (counts, tier distribution,
enrichment + vertical-match coverage, unrated/dropped rows) and exits non-zero
on any structural problem (missing sheet/header, zero rows) or if an
internal-process phrase would leak into a public narrative field.

It reads from two workbooks:
- the spine workbook — `Research Tracker` (full ranked universe, public +
  private), `Public Index` (richer public-safe narrative for public companies,
  joined by company name), `Methodology` (verbatim public methodology copy);
- the vertical-source workbook — **only** its `Company` + `DSG Prime Vertical`
  columns (clean 14-vertical taxonomy), joined to the spine by normalised
  company name (diacritic-folded, parenthetical-alias aware, with a small
  explicit alias map). All of that workbook's internal columns are ignored.

## Security / data handling — IMPORTANT

This page is **public and ungated**. The raw tracker spreadsheet is **not**
public.

- `.gitignore` excludes `*.xlsx` / `*.csv`. **Never commit or deploy the raw
  spreadsheet.** Only the generated, filtered `data.js` is committed.
- The converter uses a strict **positive column allow-list** (~14 fields).
  Internal columns — Validation Outreach, Researcher Assigned, Research Notes,
  Profile Draft Link, Stage 1/2 Status & Flags, Sources — are never read.
- Defence in depth: the converter asserts the emitted company schema exactly
  and refuses to write if any unambiguous internal-process phrase (e.g.
  "Stage 2 Flag", "Validation Outreach") survives in a public narrative field.
  It also strips internal research-process prefixes embedded in evidence text.
- Quick audit: `grep -i -E 'stage [12] flag|validation outreach|researcher
  assigned' data.js` must return nothing.

## Data model notes (spec adaptations)

The dashboard follows the source data as authoritative; three adaptations vs.
the original illustrative spec:

1. **Tier = the DSG 5-level *maturity* scale, ascending** (1 Emerging →
   5 Native; data currently tops out at Tier 3 Integrated). It is **separate
   from rank**. Colour ramp: higher maturity = stronger (red).
   **Phase 1 = Rank 1–25, Phase 2 = Rank 1–50** (the composite rank).
2. **Detail panel** uses the data's public-safe fields (Working assessment,
   Strongest signal, Key evidence, Signal gaps, Confidence, Market cap, …).
3. **Vertical** = the clean **DSG Prime Vertical** column from the
   vertical-source workbook (14-vertical taxonomy) — it drives the filter and
   the maturity-by-vertical chart. The granular raw `Sector` is still shown in
   each company's detail panel.

Maturity-tier labels/definitions, scoring method, source models, and confidence
levels are read verbatim from the spreadsheet's `Methodology` sheet.

## Project layout

```
index.html              # one page; ordered <script> tags
data.js                 # GENERATED, committed (filtered/allow-listed)
css/{reset,tokens,styles}.css
js/{config,format,data-access,state,filters,chart,render,app}.js
assets/favicon.svg
tools/convert_xlsx.py   # xlsx -> data.js (allow-list, sanitise, fail-loud)
```

> Ephemeral environments: both source workbooks (`*.xlsx`) are git-ignored, so
> a fresh clone won't contain them. The committed `data.js` keeps the deployed
> site fully reproducible without the spreadsheets; re-upload the tracker **and**
> the vertical-source workbook only when you need to regenerate (e.g. the
> Phase 2 cut).
