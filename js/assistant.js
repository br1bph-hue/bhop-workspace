/* Two-layer Q&A over window.DASHBOARD_DATA.
   Layer 1 — smart-search: pure, synchronous intent matcher (specific company,
   vertical, tier, top-N, compare, methodology). No network. Works file://.
   Layer 2 — askLLM: optional Perplexity Sonar call when the visitor pastes
   their own API key (sessionStorage only). Used as fallback when smart-search
   has no match. Classic script; same IIFE pattern as the other js/*.js. */
(function (A) {
  "use strict";

  var KEY_STORAGE = "aitop.perplexityKey";
  var NUM_WORD = { one: 1, two: 2, three: 3, four: 4, five: 5,
                   six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

  function fmt() { return A.format; }
  function esc(s) { return fmt().esc(s); }

  // ---------- Key management (sessionStorage; cleared on tab close) ----------

  function getKey() {
    try { return window.sessionStorage.getItem(KEY_STORAGE) || ""; }
    catch (_) { return ""; }
  }
  function setKey(k) {
    try { window.sessionStorage.setItem(KEY_STORAGE, String(k || "").trim()); return true; }
    catch (_) { return false; }
  }
  function clearKey() {
    try { window.sessionStorage.removeItem(KEY_STORAGE); return true; }
    catch (_) { return false; }
  }

  // ---------- Company index (built once per call; phase-gated) ----------

  function normName(s) {
    return String(s || "").toLowerCase()
      .replace(/[.,&'’()]/g, " ")
      .replace(/\binc\b|\bcorp(oration)?\b|\bco\b|\bcompany\b|\bllc\b|\bltd\b/g, " ")
      .replace(/\s+/g, " ").trim();
  }

  function buildCompanyIndex(companies) {
    // Build candidate keys per company: full normalised name, ticker, and any
    // *unique* token (>= 4 chars) that appears in exactly one company name in
    // the dataset. Unique tokens let "Grainger" match "W.W. Grainger" without
    // also matching generic words like "International" or "Industrial" that
    // appear in multiple names.
    var tokenCounts = {};
    var perCompanyTokens = [];
    companies.forEach(function (c) {
      var toks = normName(c.company).split(" ").filter(function (t) {
        return t.length >= 4;
      });
      perCompanyTokens.push(toks);
      toks.forEach(function (t) { tokenCounts[t] = (tokenCounts[t] || 0) + 1; });
    });
    var entries = [];
    companies.forEach(function (c, i) {
      var n = normName(c.company);
      if (n) entries.push({ key: n, company: c });
      if (c.ticker) entries.push({ key: String(c.ticker).toLowerCase(), company: c });
      perCompanyTokens[i].forEach(function (t) {
        if (tokenCounts[t] === 1 && t !== n) {
          entries.push({ key: t, company: c });
        }
      });
    });
    entries.sort(function (a, b) { return b.key.length - a.key.length; });
    return entries;
  }

  function findCompanies(qNorm, idx) {
    // qNorm is space-padded (" how is tier scored "). Match keys at word
    // boundaries — " key " — so the token "core" doesn't match inside the
    // word "scored".
    var seen = {}, hits = [];
    idx.forEach(function (e) {
      if (qNorm.indexOf(" " + e.key + " ") !== -1 && !seen[e.company.id]) {
        seen[e.company.id] = 1;
        hits.push(e.company);
      }
    });
    return hits;
  }

  // ---------- Smart-search intent detection ----------

  function detectTier(q) {
    var m = q.match(/\btier\s*([1-5])\b/);
    if (m) return parseInt(m[1], 10);
    m = q.match(/\btier\s*(one|two|three|four|five)\b/);
    if (m) return NUM_WORD[m[1]];
    return null;
  }

  function detectTopN(q) {
    var m = q.match(/\b(?:top|first|best)\s+(\d{1,2})\b/);
    if (m) return Math.min(50, parseInt(m[1], 10));
    m = q.match(/\b(?:top|first|best)\s+(one|two|three|four|five|six|seven|eight|nine|ten)\b/);
    if (m) return NUM_WORD[m[1]];
    return null;
  }

  function detectVertical(q, pcs) {
    var verticals = {};
    pcs.forEach(function (c) { if (c.vertical) verticals[c.vertical] = 1; });
    // Match longest first so "Industrial Gases" wins over "Industrial".
    var names = Object.keys(verticals).sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < names.length; i++) {
      if (q.indexOf(names[i].toLowerCase()) !== -1) return names[i];
    }
    // Small alias map for things people say differently than the data spells.
    var aliases = {
      "hvac": "HVAC", "jan san": "Jan/San", "jansan": "Jan/San",
      "janitorial": "Jan/San", "mro": "Industrial",
      "industrial gas": "Industrial Gases", "auto parts": "Automotive Parts",
      "pool": "Pool & Outdoor", "outdoor": "Pool & Outdoor",
      "tech": "Electronics & Technology", "electronics": "Electronics & Technology",
      "medical": "Medical Supplies", "food service": "Foodservice",
      "building": "Building Materials",
    };
    var keys = Object.keys(aliases).sort(function (a, b) { return b.length - a.length; });
    for (var j = 0; j < keys.length; j++) {
      if (q.indexOf(keys[j]) !== -1 && verticals[aliases[keys[j]]]) return aliases[keys[j]];
    }
    return null;
  }

  function isMethodologyQ(q) {
    return /\b(methodology|scoring|score|how\s+(is|are)\s+(tier|rank|score)|what\s+(does|is)\s+(tier|confidence|maturity)|tier\s*defin|source(s)?\s+model|why\s+is\s+\w+\s+tier)/i.test(q);
  }

  function isCompareQ(q) {
    return /\b(compare|versus|\bvs\.?\b|\bdiff\b)\b/.test(q);
  }

  // ---------- Renderers ----------

  function tierBadge(tier, meta) { return fmt().tierBadge(tier, meta); }

  function renderCompany(c, d) {
    var blocks = "";
    function block(label, value) {
      if (!value || value === fmt().FALLBACK) return "";
      return '<div class="as-block"><h4>' + esc(label) + "</h4><p>"
        + esc(value) + "</p></div>";
    }
    blocks += block("Working assessment", c.workingDescription);
    blocks += block("Strongest AI signal", c.strongestSignal);
    blocks += block("Key evidence", c.keyEvidence);
    blocks += block("Signal gaps / watch-outs", c.signalGaps);

    return '<div class="as-card">'
      + '<div class="as-card-head">'
      + '<span class="as-rank">#' + esc(c.rank) + "</span>"
      + '<span class="as-co">' + esc(c.company) + "</span>"
      + tierBadge(c.tier, d.tierMeta)
      + (c.ownership ? fmt().ownershipBadge(c.ownership) : "")
      + "</div>"
      + '<div class="as-card-meta">'
      + esc(c.vertical || "") + (c.sector && c.sector !== c.vertical ? " · " + esc(c.sector) : "")
      + (c.confidence ? " · " + esc(c.confidence) + " confidence" : "")
      + (c.signalStrength ? " · " + esc(c.signalStrength) + " signal" : "")
      + "</div>"
      + blocks
      + "</div>";
  }

  function renderList(rows, d, headline) {
    if (!rows.length) {
      return '<div class="as-empty">No companies in the current phase match that.</div>';
    }
    var items = rows.map(function (c) {
      return '<li class="as-li">'
        + '<span class="as-li-rank">#' + esc(c.rank) + "</span>"
        + '<span class="as-li-co">' + esc(c.company) + "</span>"
        + '<span class="as-li-vert">' + esc(c.vertical || "") + "</span>"
        + '<span class="as-li-tier">' + tierBadge(c.tier, d.tierMeta) + "</span>"
        + "</li>";
    }).join("");
    return (headline ? '<p class="as-headline">' + esc(headline) + "</p>" : "")
      + '<ol class="as-list">' + items + "</ol>";
  }

  function renderCompare(a, b, d) {
    function col(c) {
      return '<div class="as-col">'
        + '<div class="as-card-head">'
        + '<span class="as-rank">#' + esc(c.rank) + "</span>"
        + '<span class="as-co">' + esc(c.company) + "</span></div>"
        + '<div class="as-card-meta">' + tierBadge(c.tier, d.tierMeta)
        + " · " + esc(c.vertical || "") + "</div>"
        + (c.workingDescription
            ? '<p class="as-block-p">' + esc(c.workingDescription) + "</p>" : "")
        + (c.strongestSignal
            ? '<p class="as-block-p"><strong>Signal:</strong> '
              + esc(fmt().truncate(c.strongestSignal, 220)) + "</p>" : "")
        + "</div>";
    }
    return '<div class="as-compare">' + col(a) + col(b) + "</div>";
  }

  function renderMethodology(d) {
    var meth = d.methodology || {};
    var html = '<div class="as-card"><h4>Methodology</h4>';
    if (meth.scoring && meth.scoring.length) {
      html += '<div class="as-block"><h4>Scoring</h4>';
      meth.scoring.forEach(function (s) {
        html += "<p><strong>" + esc(s.label) + ":</strong> " + esc(s.text) + "</p>";
      });
      html += "</div>";
    }
    if (meth.sources && meth.sources.length) {
      html += '<div class="as-block"><h4>Source models</h4>';
      meth.sources.forEach(function (s) {
        html += "<p><strong>" + esc(s.code) + ":</strong> " + esc(s.desc) + "</p>";
      });
      html += "</div>";
    }
    if (meth.confidence && meth.confidence.length) {
      html += '<div class="as-block"><h4>Confidence levels</h4>';
      meth.confidence.forEach(function (c) {
        html += "<p><strong>" + esc(c.level) + ":</strong> " + esc(c.def) + "</p>";
      });
      html += "</div>";
    }
    if (d.tierMeta) {
      html += '<div class="as-block"><h4>Maturity tiers</h4>';
      Object.keys(d.tierMeta).sort().forEach(function (t) {
        var m = d.tierMeta[t];
        html += "<p>" + tierBadge(parseInt(t, 10), d.tierMeta)
          + " " + esc(m.def) + "</p>";
      });
      html += "</div>";
    }
    return html + "</div>";
  }

  // ---------- Main smart-search entry ----------

  function answer(question, d) {
    var pcs = A.data.phaseCompanies(d);
    var idx = buildCompanyIndex(pcs);
    var raw = String(question || "").trim();
    var q = " " + raw.toLowerCase().replace(/\s+/g, " ") + " ";
    var qNorm = " " + normName(raw) + " ";

    if (!raw) {
      return { kind: "empty",
               html: '<div class="as-empty">Type a question above.</div>',
               matched: false };
    }

    var hits = findCompanies(qNorm, idx);
    var tier = detectTier(q);
    var topN = detectTopN(q);
    var vert = detectVertical(q, pcs);
    var meth = isMethodologyQ(q);
    var compare = isCompareQ(q);

    // 1. Compare two companies.
    if (compare && hits.length >= 2) {
      return { kind: "compare",
               html: '<p class="as-headline">'
                 + esc(hits[0].company) + " vs. " + esc(hits[1].company) + "</p>"
                 + renderCompare(hits[0], hits[1], d),
               matched: true };
    }

    // 2. Specific company (single hit, no compare, no topN) — preferred over
    //    bare tier/methodology filters so "Why is Grainger Tier 3?" answers
    //    about Grainger rather than listing every Tier 3 company.
    if (hits.length === 1 && !topN) {
      return { kind: "company", html: renderCompany(hits[0], d), matched: true };
    }

    // 3. Methodology question (no specific company).
    if (meth && !hits.length) {
      return { kind: "methodology", html: renderMethodology(d), matched: true };
    }

    // 4. Vertical + optional top-N + optional tier filter.
    if (vert || tier || topN) {
      var rows = pcs.slice();
      if (vert) rows = rows.filter(function (c) { return c.vertical === vert; });
      if (tier) rows = rows.filter(function (c) { return c.tier === tier; });
      rows.sort(function (a, b) { return a.rank - b.rank; });
      var n = topN || (vert || tier ? rows.length : 10);
      var headParts = [];
      if (topN) headParts.push("Top " + n);
      else headParts.push("Companies");
      if (vert) headParts.push("in " + vert);
      if (tier) headParts.push("at Tier " + tier
        + " · " + (d.tierMeta[String(tier)] || {}).label);
      return { kind: vert ? "vertical" : (tier ? "tier" : "topN"),
               html: renderList(rows.slice(0, n), d, headParts.join(" ")),
               matched: rows.length > 0 };
    }

    // 5. Specific company with multiple hits (no compare) — list them.
    if (hits.length > 1) {
      return { kind: "company-multi",
               html: renderList(hits.slice(0, 10), d,
                 "Matched " + hits.length + " companies — pick one to ask about"),
               matched: true };
    }

    // 6. No match.
    return {
      kind: "unknown",
      html: '<div class="as-empty">I couldn’t match that to the rankings. '
        + "Try a company name, a vertical (e.g. HVAC), a tier (Tier 2/3), "
        + '"top 5 in Electrical", or "compare Grainger and Fastenal". '
        + "For free-form questions, set a Perplexity key in Settings.</div>",
      matched: false,
    };
  }

  // ---------- Perplexity Sonar (optional, requires user key) ----------

  function buildCompanyDigest(d, maxRows) {
    var pcs = A.data.phaseCompanies(d);
    pcs.sort(function (a, b) { return a.rank - b.rank; });
    return pcs.slice(0, maxRows || 50).map(function (c) {
      return "#" + c.rank + " " + c.company
        + " (" + (c.vertical || "—") + ", Tier " + (c.tier || "?") + ")";
    }).join("\n");
  }

  function buildSystemPrompt(d) {
    var meth = d.methodology || {};
    var scoring = (meth.scoring || []).map(function (s) {
      return s.label + ": " + s.text; }).join(" | ");
    var sources = (meth.sources || []).map(function (s) {
      return s.code + " = " + s.desc; }).join(" | ");
    return "You are an analyst answering questions about Distribution Strategy "
      + "Group's AI Top 25/50 ranking of North American wholesale distributors. "
      + "Ground your answer in the supplied ranking list and methodology. "
      + "Use web search to enrich with recent, specific facts about the named "
      + "companies (announcements, deployments, partnerships) and cite sources. "
      + "Be concise: short paragraphs or tight bullets. Don't invent ranks or "
      + "tiers — quote them verbatim from the list.\n\n"
      + "Methodology — Scoring: " + scoring + "\n"
      + "Methodology — Source models: " + sources;
  }

  function tryHost(u) {
    try { return new URL(u).hostname.replace(/^www\./, ""); }
    catch (_) { return null; }
  }

  function renderLLM(text, citations) {
    var safeText = esc(text || "").replace(/\n\n+/g, "</p><p>").replace(/\n/g, "<br>");
    var citeHtml = "";
    if (citations && citations.length) {
      var items = citations.map(function (u, i) {
        var host = tryHost(u);
        return '<li><a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">'
          + (host ? esc(host) : esc(u)) + "</a> "
          + '<span class="as-cite-n">[' + (i + 1) + "]</span></li>";
      }).join("");
      citeHtml = '<div class="as-cites"><h4>Sources</h4><ul>' + items + "</ul></div>";
    }
    return '<div class="as-card as-llm">'
      + '<div class="as-llm-tag">Perplexity Sonar</div>'
      + "<p>" + safeText + "</p>"
      + citeHtml + "</div>";
  }

  function askLLM(question, d, apiKey) {
    if (!apiKey) {
      return Promise.reject(new Error("No API key set."));
    }
    var system = buildSystemPrompt(d);
    var user = "Ranking (rank · company · vertical · tier):\n"
      + buildCompanyDigest(d, 50)
      + "\n\nQuestion: " + String(question || "").trim();
    var body = {
      model: "sonar",
      temperature: 0.3,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    };
    return fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }).then(function (res) {
      if (!res.ok) {
        // Redacted error — never echo headers or the key.
        return Promise.reject(new Error("Perplexity request failed [" + res.status + "]"));
      }
      return res.json();
    }).then(function (json) {
      var text = (json && json.choices && json.choices[0]
        && json.choices[0].message && json.choices[0].message.content) || "";
      var cites = (json && Array.isArray(json.citations)) ? json.citations.slice(0, 8) : [];
      return { text: text.trim(), citations: cites };
    });
  }

  A.assistant = {
    answer: answer,
    askLLM: askLLM,
    renderLLM: renderLLM,
    getKey: getKey,
    setKey: setKey,
    clearKey: clearKey,
  };
})(window.AITOP = window.AITOP || {});
