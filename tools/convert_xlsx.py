#!/usr/bin/env python3
"""
convert_xlsx.py — AI Top 50 tracker xlsx -> data.js (window.DASHBOARD_DATA).

One-time / re-run build step. Reads ONLY allow-listed, public-safe columns from
the Research Tracker (spine), Public Index (enrichment), and Methodology sheets.
Internal columns (Validation Outreach, Researcher, Research Notes, Profile Draft
Link, Stage status/flags, Sources) are never read into the output.

Usage:
    pip install --user openpyxl
    python3 tools/convert_xlsx.py AI_Top_50_Public_Index_Tracker.xlsx
    python3 tools/convert_xlsx.py <xlsx> --phase 2
    python3 tools/convert_xlsx.py <xlsx> --deterministic   # frozen timestamp

Exit codes: 0 ok | 2 openpyxl missing | 3 file/sheet/header error | 4 no rows.
"""
import argparse
import datetime as _dt
import glob
import json
import os
import re
import sys

try:
    import openpyxl
except ModuleNotFoundError:
    sys.stderr.write("ERROR: openpyxl not installed. Run: pip install --user openpyxl\n")
    sys.exit(2)

SPINE_SHEET = "Research Tracker"
ENRICH_SHEET = "Public Index"
METHOD_SHEET = "Methodology"
FALLBACK = "Limited public evidence"

# Logical field -> case-insensitive header patterns. Resolution is by header
# NAME (headers sit on row ~2 under a title banner), never by column letter.
HEADER_MATCHERS = {
    "rank": [r"^rank$"],
    "company": [r"company\s*name", r"^company$"],
    "sector": [r"^sector$"],
    "size": [r"^size$"],
    "ownership": [r"^ownership$"],
    "tier": [r"prelim.*tier", r"^tier"],
    "confidence": [r"^confidence"],
    "ticker": [r"ticker"],
    "market_cap": [r"market\s*cap"],
    "signal_strength": [r"signal\s*strength"],
    "key_evidence": [r"key\s*evidence"],
    "strongest_signal": [r"strongest\s*signal"],
    "signal_gaps": [r"signal\s*gaps"],
    "working_description": [r"working\s*description"],
}
SPINE_REQUIRED = ["rank", "company", "sector", "tier", "confidence"]
ENRICH_REQUIRED = ["company", "tier"]

# The security boundary is the POSITIVE allow-list above: only these logical
# fields are ever resolved/read, so internal columns (Validation Outreach,
# Researcher, Research Notes, Profile Draft Link, Stage status/flags, Sources)
# are never touched. Defence in depth = an exact-shape assertion on the emitted
# company objects (a naive substring scan would false-positive on ordinary
# English in the allowed public narrative, e.g. "Stage 1 screening required").
ALLOWED_COMPANY_KEYS = {
    "id", "rank", "company", "sector", "sectorBucket", "size", "ownership",
    "ticker", "marketCap", "tier", "tierLabel", "confidence", "signalStrength",
    "workingDescription", "strongestSignal", "keyEvidence", "signalGaps",
    "tableSummary", "_thin", "_enriched",
}

# Ordered sector-bucket rules (first hit wins). Raw sector is always kept for
# display; the bucket only drives the chart grouping and the sector filter.
SECTOR_RULES = [
    ("Healthcare",            r"health|pharma|dental|pharmacy"),
    ("Foodservice",           r"foodservice|natural foods|\bfood\b"),
    ("Auto",                  r"\bauto\b|automotive"),
    ("Fasteners",             r"fastener"),
    ("Electrical",            r"electrical"),
    ("HVAC / Plumbing",       r"hvac|plumbing|hvacr|waterworks"),
    ("Building Materials",    r"building materials|roofing"),
    ("Gases / Welding",       r"gases|welding"),
    ("Chemicals",             r"chemical|ingredients"),
    ("Packaging",             r"packaging"),
    ("Metals",                r"metals|steel"),
    ("Electronics / Tech",    r"electronics|technology|it solutions"),
    ("Security",              r"security|low voltage|smart home"),
    ("Pipe / Valve / Fitting", r"pipe|valve|fitting"),
    ("Specialty",             r"pool|landscape|specialty"),
    ("Industrial / MRO",      r"industrial|mro|fluid power|pumps|c-parts"),
    ("Multi-Vertical",        r"multi-vertical"),
]

# Maturity colour ramp: higher tier = stronger (Key Decision #1). Labels and
# definitions are read from the Methodology sheet; these are fallbacks only.
TIER_COLORS = {1: "#888888", 2: "#28C4F4", 3: "#2E69B3", 4: "#D32D37", 5: "#A21D24"}
TIER_FALLBACK = {
    1: ("Emerging", "Isolated pilots, vendor-driven, no measurable enterprise-wide impact."),
    2: ("Functional", "Named deployed use case with documented ROI. Committed but narrow."),
    3: ("Integrated", "AI across multiple functions. Cross-functional governance. Internal capability building."),
    4: ("Agentic", "Autonomous AI systems in defined domains. Exception-based management."),
    5: ("Native", "AI is architectural. Operations assume AI. Would require reinvention to operate without it."),
}
CONF_MAP = {"H": "High", "M": "Medium", "L": "Low", "N": "Not determined"}

EMPTY_TOKENS = {"", "n/a", "na", "n/d", "nd", "none", "tbd", "-", "—", "–", "tbc", "unknown"}
_norm_strip = re.compile(
    r"\b(incorporated|inc|corp|corporation|company|co|plc|llc|l\.l\.c|ltd|lp|"
    r"holdings?|the|operating)\b", re.I)

# Internal research-PROCESS boilerplate that researchers prefix onto the
# Key Evidence cell. It is not a separate column, so the allow-list cannot
# catch it; strip a leading internal clause so it never reaches the public
# page. Only the leading process annotation is removed — the substantive
# evidence that follows is preserved verbatim.
SANITIZE_LEAD = [
    re.compile(r"^\s*stage\s*[12]\s*(flag|status)\b[^.]*\.\s*", re.I),
    re.compile(r"^\s*stage\s*[12]\s*complete\b[^.]*\.\s*", re.I),
    re.compile(r"^\s*stage\s*[12]\s*[—\-:]\s*", re.I),
]
# Unambiguous internal-process phrases (multi-word, do not occur in ordinary
# public evidence prose). Presence in any emitted narrative => fail the build.
INTERNAL_PHRASES = [
    "stage 2 flag", "stage 1 flag", "stage 2 status", "stage 1 status",
    "validation outreach", "researcher assigned", "profile draft",
    "tracker_update.csv", "stage 2 complete", "stage 1 complete",
    "stage 2 not started", "stage 1 not started",
]
NARRATIVE_FIELDS = ("workingDescription", "strongestSignal", "keyEvidence",
                    "signalGaps")


def sanitize(text):
    t = s(text)
    for _ in range(3):                       # peel up to 3 stacked lead-ins
        new = t
        for pat in SANITIZE_LEAD:
            new = pat.sub("", new, count=1)
        if new == t:
            break
        t = new
    return t.strip()


def die(code, msg):
    sys.stderr.write("ERROR: " + msg + "\n")
    sys.exit(code)


def s(v):
    return "" if v is None else str(v).strip()


def is_empty(v):
    return s(v).lower() in EMPTY_TOKENS


def clean(v):
    """Public-safe value or the never-blank fallback (+ thin flag via caller)."""
    t = s(v)
    return FALLBACK if t.lower() in EMPTY_TOKENS else t


def normalize_name(name):
    t = s(name).lower()
    t = re.sub(r"\([^)]*\)", " ", t)          # drop trailing parentheticals e.g. (UNFI)
    t = t.replace("&", " and ")
    t = re.sub(r"[.,/']", " ", t)
    t = _norm_strip.sub(" ", t)
    return re.sub(r"\s+", " ", t).strip()


def sector_bucket(raw):
    low = s(raw).lower()
    for bucket, pat in SECTOR_RULES:
        if re.search(pat, low):
            return bucket
    return "Other"


def parse_tier(v):
    m = re.match(r"\s*([1-5])\s*$", s(v))
    return int(m.group(1)) if m else None


def parse_rank(v):
    m = re.match(r"\s*(\d{1,3})\s*$", s(v))
    return int(m.group(1)) if m else None


def expand_conf(v):
    t = s(v)
    if not t or t.lower() in EMPTY_TOKENS:
        return FALLBACK
    parts = re.split(r"[-/]", t)
    out = [CONF_MAP.get(p.strip().upper(), p.strip()) for p in parts if p.strip()]
    return "-".join(out) if out else t


def truncate(text, n=120):
    t = " ".join(s(text).split())
    if len(t) <= n:
        return t
    cut = t[:n].rsplit(" ", 1)[0].rstrip(",.;:—-")
    return (cut or t[:n]) + "…"


def find_header_row(ws, scan=15):
    for i, row in enumerate(ws.iter_rows(min_row=1, max_row=scan, values_only=True)):
        low = [s(c).lower() for c in row if s(c)]
        if any("company" in x for x in low) and any(
                ("tier" in x or "confidence" in x) for x in low):
            return i + 1, [s(c) for c in row]
    return None, None


def resolve_columns(headers, required, sheet):
    idx = {}
    for field, pats in HEADER_MATCHERS.items():
        for ci, h in enumerate(headers):
            hl = h.lower().replace("\n", " ")
            if any(re.search(p, hl) for p in pats):
                idx[field] = ci
                break
    missing = [f for f in required if f not in idx]
    if missing:
        die(3, "Sheet '%s': could not resolve header(s) %s.\nHeaders seen: %s"
            % (sheet, missing, headers))
    return idx


def is_banner(cells):
    nonfirst = [c for i, c in enumerate(cells) if i != 0 and s(c)]
    return s(cells[0]) and not nonfirst


def get(cells, idx, field):
    ci = idx.get(field)
    return cells[ci] if ci is not None and ci < len(cells) else None


# --------------------------------------------------------------------------- #
def build_enrich_map(ws):
    hr, headers = find_header_row(ws)
    if hr is None:
        die(3, "Sheet '%s': header row not found." % ENRICH_SHEET)
    idx = resolve_columns(headers, ENRICH_REQUIRED, ENRICH_SHEET)
    pmap, names = {}, []
    for row in ws.iter_rows(min_row=hr + 1, values_only=True):
        cells = list(row)
        if not any(s(c) for c in cells) or is_banner(cells):
            continue
        name = s(get(cells, idx, "company"))
        if not name:
            continue
        wd = s(get(cells, idx, "working_description"))
        ss = s(get(cells, idx, "strongest_signal"))
        ke = s(get(cells, idx, "key_evidence"))
        if re.match(r"^\s*(see (rank|main tracker)|duplicate reference)", ke, re.I):
            ke = ""
        if not (wd or ss or ke):                       # skip empty/dup ref rows
            continue
        key = normalize_name(name)
        names.append(name)
        if key in pmap:                                # ranked row wins
            continue
        pmap[key] = {
            "ticker": s(get(cells, idx, "ticker")),
            "market_cap": s(get(cells, idx, "market_cap")),
            "signal_strength": s(get(cells, idx, "signal_strength")),
            "key_evidence": ke,
            "strongest_signal": ss,
            "signal_gaps": s(get(cells, idx, "signal_gaps")),
            "working_description": wd,
        }
    return pmap, names


def build_companies(ws, pmap):
    hr, headers = find_header_row(ws)
    if hr is None:
        die(3, "Sheet '%s': header row not found." % SPINE_SHEET)
    idx = resolve_columns(headers, SPINE_REQUIRED, SPINE_SHEET)
    companies, dropped, enriched_keys = [], [], set()
    for row in ws.iter_rows(min_row=hr + 1, values_only=True):
        cells = list(row)
        if not any(s(c) for c in cells) or is_banner(cells):
            continue
        rank = parse_rank(get(cells, idx, "rank"))
        name = s(get(cells, idx, "company"))
        if rank is None or not name:
            dropped.append((s(get(cells, idx, "rank")), name))
            continue
        raw_sector = s(get(cells, idx, "sector")) or "Other"
        key = normalize_name(name)
        enr = pmap.get(key)
        if enr:
            enriched_keys.add(key)

        def pick(field, spine_val):
            ev = sanitize(enr.get(field) if enr else "")
            if ev and ev.lower() not in EMPTY_TOKENS:
                return ev, False
            sv = sanitize(spine_val)
            if sv and sv.lower() not in EMPTY_TOKENS:
                return sv, False
            return FALLBACK, True

        ke, ke_t = pick("key_evidence", get(cells, idx, "key_evidence"))
        wd, wd_t = pick("working_description", None)
        ss, ss_t = pick("strongest_signal", None)
        sg, sg_t = pick("signal_gaps", None)
        ticker, _ = pick("ticker", get(cells, idx, "ticker"))
        mcap, mcap_t = pick("market_cap", None)
        sig, sig_t = pick("signal_strength", None)
        ticker_t = ticker == FALLBACK
        primary = next((x for x in (wd, ss, ke) if x and x != FALLBACK), FALLBACK)
        tier = parse_tier(get(cells, idx, "tier"))

        companies.append({
            "id": "co-%04d" % rank,
            "rank": rank,
            "company": name,
            "sector": raw_sector,
            "sectorBucket": sector_bucket(raw_sector),
            "size": clean(get(cells, idx, "size")),
            "ownership": s(get(cells, idx, "ownership")) or "",
            "ticker": None if ticker_t else ticker,
            "marketCap": None if mcap_t else mcap,
            "tier": tier,
            "tierLabel": (TIER_FALLBACK.get(tier, ("Unrated", ""))[0] if tier else "Unrated"),
            "confidence": expand_conf(get(cells, idx, "confidence")),
            "signalStrength": None if sig_t else sig,
            "workingDescription": wd,
            "strongestSignal": ss,
            "keyEvidence": ke,
            "signalGaps": sg,
            "tableSummary": truncate(primary, 120),
            "_thin": {"workingDescription": wd_t, "strongestSignal": ss_t,
                      "keyEvidence": ke_t, "signalGaps": sg_t,
                      "marketCap": mcap_t, "signalStrength": sig_t,
                      "ticker": ticker_t},
            "_enriched": bool(enr),
        })
    companies.sort(key=lambda c: c["rank"])
    return companies, dropped, enriched_keys


# --------------------------------------------------------------------------- #
METHOD_SECTIONS = {
    "SOURCE DOCUMENTS": "sources",
    "SCORING METHOD": "scoring",
    "CONFIDENCE LEVELS": "confidence",
    "MATURITY TIERS": "tiers",
}


def parse_methodology(ws):
    out = {"sources": [], "scoring": [], "confidence": [], "tiers": []}
    cur = None
    for row in ws.iter_rows(min_row=1, values_only=True):
        a = s(row[0] if len(row) > 0 else "")
        b = s(row[1] if len(row) > 1 else "")
        if not a:
            continue
        if not b:
            cur = METHOD_SECTIONS.get(a.upper())
            continue
        if cur == "sources":
            out["sources"].append({"code": a, "desc": b})
        elif cur == "scoring":
            out["scoring"].append({"label": a, "text": b})
        elif cur == "confidence":
            out["confidence"].append({"level": a, "def": b})
        elif cur == "tiers":
            m = re.search(r"([1-5])", a)
            out["tiers"].append({"tier": int(m.group(1)) if m else None,
                                 "label": a, "def": b})
    return out


def build_tier_meta(method):
    meta = {}
    for t in range(1, 6):
        lbl, dfn = TIER_FALLBACK[t]
        for row in method.get("tiers", []):
            if row.get("tier") == t:
                mlabel = re.sub(r"^\s*tier\s*[1-5]\s*[—\-:]*\s*", "",
                                row["label"], flags=re.I).strip()
                lbl = mlabel or lbl
                dfn = row["def"] or dfn
                break
        meta[str(t)] = {"label": lbl, "def": dfn,
                        "color": TIER_COLORS[t], "badge": "T%d" % t}
    return meta


# --------------------------------------------------------------------------- #
def aggregate(companies):
    ranked = [c for c in companies if c["rank"] <= 50]

    def block(maxrank):
        sub = [c for c in companies if c["rank"] <= maxrank]
        by = {}
        for c in sub:
            if c["tier"]:
                by[str(c["tier"])] = by.get(str(c["tier"]), 0) + 1
        return {"companies": len(sub), "byTier": by,
                "sectorCount": len({c["sectorBucket"] for c in sub})}

    by_all = {}
    for c in companies:
        if c["tier"]:
            by_all[str(c["tier"])] = by_all.get(str(c["tier"]), 0) + 1

    sect = {}
    for c in ranked:
        d = sect.setdefault(c["sectorBucket"], {"sector": c["sectorBucket"],
                                                "total": 0, "byTier": {}})
        d["total"] += 1
        if c["tier"]:
            k = str(c["tier"])
            d["byTier"][k] = d["byTier"].get(k, 0) + 1
    return {
        "universeTotal": len(companies),
        "rankedTotal": len(ranked),
        "byTierAll": by_all,
        "phase1": block(25),
        "phase2": block(50),
        "sectorCounts": sorted(sect.values(),
                               key=lambda x: (-x["total"], x["sector"])),
    }


def stat_strip(agg, companies, tier_meta):
    p1 = [c for c in companies if c["rank"] <= 25]
    p2 = [c for c in companies if c["rank"] <= 50]

    def peak(sub):
        ts = [c["tier"] for c in sub if c["tier"]]
        if not ts:
            return "—", "no rated tiers"
        mx = max(ts)
        return "Tier %d" % mx, "%s — peak maturity" % tier_meta[str(mx)]["label"]

    pv, ps = peak(p1)
    high1 = sum(1 for c in p1 if c["confidence"].lower().startswith("high"))
    t3p2 = sum(1 for c in p2 if c["tier"] == 3)
    return {
        "phase1": [
            {"label": "Companies Ranked", "value": str(len(p1)),
             "sub": "of %d in the full index" % agg["rankedTotal"]},
            {"label": "Distribution Sectors", "value": str(agg["phase1"]["sectorCount"]),
             "sub": "represented in the Top 25"},
            {"label": "Peak Maturity", "value": pv, "sub": ps},
            {"label": "High-Confidence Profiles", "value": str(high1),
             "sub": "evidence-backed placements"},
        ],
        "phase2Extra": [
            {"label": "Total Universe", "value": str(agg["universeTotal"]),
             "sub": "incl. gap-analysis additions"},
            {"label": "Integrated (Tier 3)", "value": str(t3p2),
             "sub": "most-mature cohort in the Top 50"},
        ],
    }


# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser(description="AI Top 50 xlsx -> data.js")
    ap.add_argument("xlsx", nargs="?", help="path to tracker .xlsx")
    ap.add_argument("--phase", type=int, choices=(1, 2), default=1)
    ap.add_argument("--out", default=os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data.js"))
    ap.add_argument("--deterministic", action="store_true",
                    help="freeze generatedAt to the xlsx mtime (idempotent)")
    args = ap.parse_args()

    path = args.xlsx
    if not path:
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        cands = sorted(glob.glob(os.path.join(root, "*.xlsx")))
        if not cands:
            die(3, "No xlsx given and none found in repo root.")
        path = cands[0]
    if not os.path.isfile(path):
        die(3, "xlsx not found: %s" % os.path.abspath(path))

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    for need in (SPINE_SHEET, ENRICH_SHEET, METHOD_SHEET):
        if need not in wb.sheetnames:
            die(3, "Sheet '%s' missing. Sheets: %s" % (need, wb.sheetnames))

    pmap, pi_names = build_enrich_map(wb[ENRICH_SHEET])
    companies, dropped, enriched_keys = build_companies(wb[SPINE_SHEET], pmap)
    if not companies:
        die(4, "Zero shippable company rows.")
    method = parse_methodology(wb[METHOD_SHEET])
    tier_meta = build_tier_meta(method)
    agg = aggregate(companies)
    strip = stat_strip(agg, companies, tier_meta)
    wb.close()

    if args.deterministic:
        gen = _dt.datetime.utcfromtimestamp(
            os.path.getmtime(path)).replace(microsecond=0).isoformat() + "Z"
    else:
        gen = _dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"

    sectors_present = [x["sector"] for x in agg["sectorCounts"]]
    data = {
        "meta": {"generatedAt": gen, "sourceFile": os.path.basename(path),
                 "sheets": [SPINE_SHEET, ENRICH_SHEET, METHOD_SHEET],
                 "isFixture": False},
        "phase": args.phase,
        "phaseConfig": {
            "1": {"maxRank": 25, "pill": "PHASE 1: TOP 25", "statCards": 4},
            "2": {"maxRank": 50, "pill": "FULL TOP 50", "statCards": 6}},
        "tierMeta": tier_meta,
        "methodology": method,
        "sectors": sectors_present,
        "aggregates": agg,
        "statStrip": strip,
        "companies": companies,
    }

    body = json.dumps(data, ensure_ascii=False, indent=2)
    header = ("/* AUTO-GENERATED by tools/convert_xlsx.py — DO NOT EDIT BY HAND.\n"
              "   source: %s | sheets: %s\n"
              "   generatedAt: %s | rowsIn(spine): %d | rowsShipped: %d | enriched: %d\n"
              "   Raw spreadsheet is git-ignored; only this filtered, allow-listed\n"
              "   file is committed/deployed. Regenerate after a tracker refresh. */\n"
              % (os.path.basename(path), ", ".join(data["meta"]["sheets"]),
                 gen, len(companies) + len(dropped), len(companies),
                 len(enriched_keys)))
    out_text = header + "window.DASHBOARD_DATA = " + body + ";\n"

    # Defence in depth #1: every company object must have exactly the public
    # schema — no stray field could carry internal data into the bundle.
    stray = sorted({k for c in companies for k in c
                    if k not in ALLOWED_COMPANY_KEYS})
    if stray:
        die(3, "Refusing to write: unexpected company field(s): %s" % stray)

    # Defence in depth #2: no unambiguous internal-process phrase may survive
    # in an emitted narrative field (catches embedded leaks the column
    # allow-list cannot, e.g. researcher boilerplate inside Key Evidence).
    hits = []
    for c in companies:
        for fld in NARRATIVE_FIELDS:
            low = str(c.get(fld, "")).lower()
            for ph in INTERNAL_PHRASES:
                if ph in low:
                    hits.append("#%d %s.%s ~ %r" % (c["rank"], c["company"], fld, ph))
    if hits:
        die(3, "Refusing to write: internal phrase(s) in public narrative:\n  "
            + "\n  ".join(hits[:20]))

    tmp = args.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(out_text)
    os.replace(tmp, args.out)

    # ---- DATA CHECK (stdout, non-fatal) ----
    unmatched = sorted({n for n in pi_names
                         if normalize_name(n) not in enriched_keys})
    null_tier = [c["company"] for c in companies if c["tier"] is None]
    print("=" * 64)
    print("DATA CHECK  ->  %s" % args.out)
    print("  universe (spine rows shipped) : %d" % agg["universeTotal"])
    print("  ranked (rank<=50)             : %d" % agg["rankedTotal"])
    print("  phase 1 (rank<=25)            : %d  byTier=%s"
          % (agg["phase1"]["companies"], agg["phase1"]["byTier"]))
    print("  phase 2 (rank<=50)            : %d  byTier=%s"
          % (agg["phase2"]["companies"], agg["phase2"]["byTier"]))
    print("  tier distribution (all)       : %s" % agg["byTierAll"])
    print("  sector buckets                : %d  %s"
          % (len(sectors_present), sectors_present))
    print("  enriched from Public Index    : %d / %d spine companies"
          % (len(enriched_keys), len(companies)))
    print("  unmatched Public Index names  : %d  %s"
          % (len(unmatched), unmatched))
    print("  null/unrated tier (kept)      : %d  %s" % (len(null_tier), null_tier))
    print("  dropped rows (no rank/name)   : %d  %s" % (len(dropped), dropped))
    print("  methodology: sources=%d scoring=%d confidence=%d tiers=%d"
          % (len(method["sources"]), len(method["scoring"]),
             len(method["confidence"]), len(method["tiers"])))
    print("  SPEC NOTE: Phase1 target 'Top 25', Phase2 'Top 50' (rank-based).")
    print("  generatedAt: %s%s" % (gen, "  [deterministic]" if args.deterministic else ""))
    print("=" * 64)


if __name__ == "__main__":
    main()
