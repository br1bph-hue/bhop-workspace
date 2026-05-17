/* Region renderers. Build markup with data-* hooks; app.js owns events.
   All dynamic values pass through fmt.esc (XSS-safe). */
(function (A) {
  "use strict";
  var fmt = A.format, cfg = A.config;
  var esc = fmt.esc;

  function header(d) {
    var pill = A.data.phaseCfg(d).pill;
    return ''
      + '<div class="container">'
      + '<div class="brand"><span class="logo" aria-hidden="true">DSG</span>'
      + '<span class="org">' + esc(cfg.ORG) + "</span></div>"
      + '<span class="pill">' + esc(pill) + "</span>"
      + "<h1>" + esc(cfg.TITLE) + "</h1>"
      + '<p class="subtitle">' + esc(cfg.SUBTITLE) + "</p>"
      + '<p class="intro">' + esc(cfg.INTRO) + "</p>"
      + "</div>";
  }

  function stats(d) {
    var n = A.data.phaseCfg(d).statCards;
    var cards = d.statStrip.phase1.slice();
    if (n >= 6) cards = cards.concat(d.statStrip.phase2Extra);
    return '<div class="container"><div class="stat-grid" style="--n:'
      + cards.length + '">' + cards.map(function (c) {
        return '<div class="stat-card"><div class="stat-val">' + esc(c.value)
          + '</div><div class="stat-label">' + esc(c.label)
          + '</div><div class="stat-sub">' + esc(c.sub) + "</div></div>";
      }).join("") + "</div></div>";
  }

  function checkGroup(facetKey, options, selected, legend) {
    return '<fieldset class="facet" data-facet="' + facetKey + '">'
      + "<legend>" + esc(legend) + "</legend>"
      + '<div class="facet-opts">' + options.map(function (o) {
        var on = !!selected[o.value];
        return '<label class="opt' + (on ? " on" : "") + '">'
          + '<input type="checkbox" data-facet="' + facetKey + '" '
          + 'value="' + esc(o.value) + '"' + (on ? " checked" : "") + ">"
          + (o.color ? '<span class="sw" style="background:' + esc(o.color)
              + '"></span>' : "")
          + "<span>" + esc(o.label) + '</span><span class="cnt">'
          + o.count + "</span></label>";
      }).join("") + "</div></fieldset>";
  }

  function controls(d, facets, st) {
    return '<div class="container">'
      + '<div class="ctrl-row">'
      + checkGroup("tiers", facets.tiers, st.filters.tiers, "Maturity tier")
      + checkGroup("verticals", facets.verticals, st.filters.verticals, "Distribution vertical")
      + "</div><div class=\"ctrl-row\">"
      + checkGroup("ownership", facets.ownership, st.filters.ownership, "Ownership")
      + checkGroup("confidence", facets.confidence, st.filters.confidence, "Confidence")
      + '<div class="ctrl-tools">'
      + '<label class="srch"><span class="vh">Search companies</span>'
      + '<input type="search" id="searchInput" placeholder="Search company, '
      + 'vertical, or AI signal…" value="' + esc(st.filters.search) + '"></label>'
      + '<label class="sortbox"><span class="vh">Sort</span>'
      + '<select id="sortSelect">'
      + opt("rank", "Sort: Rank", st.sort) + opt("tier", "Sort: Maturity", st.sort)
      + opt("company", "Sort: Company A–Z", st.sort)
      + opt("vertical", "Sort: Vertical", st.sort) + "</select></label>"
      + "</div></div></div>";
  }
  function opt(v, label, cur) {
    return '<option value="' + v + '"' + (cur === v ? " selected" : "") + ">"
      + esc(label) + "</option>";
  }

  function chipsBar(chips, shown, total) {
    var c = chips.map(function (ch) {
      return '<button class="chip" data-chip-facet="' + esc(ch.facet)
        + '" data-chip-value="' + esc(ch.value) + '">' + esc(ch.label)
        + ' <span aria-hidden="true">×</span></button>';
    }).join("");
    return '<div class="container chips-inner">'
      + '<span class="count">' + esc(A.filters.summarize(shown, total)) + "</span>"
      + '<div class="chips">' + c + "</div>"
      + (chips.length ? '<button class="clear" id="clearAll">Clear all</button>' : "")
      + "</div>";
  }

  function detailPanel(c, d) {
    function block(label, value) {
      var f = fmt.fieldOrFallback(value);
      return '<div class="d-block"><h4>' + esc(label) + "</h4><p"
        + (f.thin ? ' class="thin"' : "") + ">" + f.html + "</p></div>";
    }
    function fact(label, value, thin) {
      var empty = value == null || value === "" || value === fmt.FALLBACK;
      return '<div class="fact"><dt>' + esc(label) + "</dt><dd"
        + (thin || empty ? ' class="thin"' : "") + ">"
        + esc(empty ? fmt.FALLBACK : value) + "</dd></div>";
    }
    var m = d.tierMeta[String(c.tier)];
    var tierTxt = c.tier ? ("T" + c.tier + " · " + m.label) : "Unrated";
    return '<div class="detail">'
      + '<div class="d-main">'
      + block("Working assessment", c.workingDescription)
      + block("Strongest AI signal", c.strongestSignal)
      + block("Key evidence", c.keyEvidence)
      + "</div>"
      + '<aside class="d-side">'
      + '<dl class="facts">'
      + fact("Rank", "#" + c.rank)
      + fact("Maturity", tierTxt + (c.tier ? "" : ""))
      + (c.tier ? '<div class="fact tierdef"><dt>Tier meaning</dt><dd>'
          + esc(m.def) + "</dd></div>" : "")
      + fact("Confidence", c.confidence)
      + fact("Signal strength", c.signalStrength, c._thin.signalStrength)
      + fact("Market cap", c.marketCap, c._thin.marketCap)
      + fact("Ticker", c.ticker, c._thin.ticker)
      + fact("Ownership", c.ownership)
      + fact("DSG vertical", c.vertical)
      + fact("Sector", c.sector)
      + "</dl>"
      + block("Signal gaps / watch-outs", c.signalGaps)
      + "</aside>"
      + '<div class="d-cta"><a href="' + esc(cfg.DETAIL_CTA_URL)
      + '" target="_blank" rel="noopener">' + esc(cfg.DETAIL_CTA_TEXT) + "</a></div>"
      + "</div>";
  }

  function table(rows, d, expandedId) {
    if (!rows.length) return emptyResult();
    var body = rows.map(function (c) {
      var open = c.id === expandedId;
      var tr = '<tr class="row' + (open ? " open" : "") + '" data-id="'
        + esc(c.id) + '" role="button" tabindex="0" aria-expanded="'
        + (open ? "true" : "false") + '" aria-controls="x-' + esc(c.id) + '">'
        + '<td class="c-rank">' + esc(c.rank) + "</td>"
        + '<td class="c-co"><span class="co-name">' + esc(c.company) + "</span>"
        + fmt.ownershipBadge(c.ownership) + "</td>"
        + '<td class="c-sec">' + esc(c.vertical) + "</td>"
        + '<td class="c-tier">' + fmt.tierBadge(c.tier, d.tierMeta) + "</td>"
        + '<td class="c-conf">' + esc(c.confidence) + "</td>"
        + '<td class="c-sum">' + esc(c.tableSummary) + "</td>"
        + '<td class="c-chev" aria-hidden="true">' + (open ? "▾" : "▸") + "</td>"
        + "</tr>";
      var det = '<tr class="det-row' + (open ? "" : " hidden")
        + '" id="x-' + esc(c.id) + '"><td colspan="7">'
        + (open ? detailPanel(c, d) : "") + "</td></tr>";
      return tr + det;
    }).join("");
    return '<div class="container"><table class="grid"><thead><tr>'
      + "<th>Rank</th><th>Company</th><th>Vertical</th><th>Maturity tier</th>"
      + "<th>Conf.</th><th>AI signal summary</th><th><span class=\"vh\">Detail</span></th>"
      + "</tr></thead><tbody>" + body + "</tbody></table></div>";
  }

  function cards(rows, d, expandedId) {
    if (!rows.length) return emptyResult();
    return '<div class="container card-list">' + rows.map(function (c) {
      var open = c.id === expandedId;
      return '<div class="card' + (open ? " open" : "") + '" data-id="'
        + esc(c.id) + '" role="button" tabindex="0" aria-expanded="'
        + (open ? "true" : "false") + '">'
        + '<div class="card-top"><span class="c-rank">#' + esc(c.rank)
        + '</span>' + fmt.tierBadge(c.tier, d.tierMeta) + "</div>"
        + '<div class="card-co">' + esc(c.company) + " "
        + fmt.ownershipBadge(c.ownership) + "</div>"
        + '<div class="card-meta">' + esc(c.vertical) + " · "
        + esc(c.confidence) + " confidence</div>"
        + '<p class="card-sum">' + esc(c.tableSummary) + "</p>"
        + (open ? detailPanel(c, d) : '<span class="card-more">Tap for detail ▸</span>')
        + "</div>";
    }).join("") + "</div>";
  }

  function emptyResult() {
    return '<div class="container"><p class="no-result">No companies match '
      + 'these filters. <button class="linkbtn" id="clearAll2">Clear all '
      + "filters</button> to see the full list.</p></div>";
  }

  function methodology(d) {
    var meth = d.methodology;
    function list(items, fa, fb) {
      return "<dl class=\"m-dl\">" + items.map(function (it) {
        return "<div><dt>" + esc(it[fa]) + "</dt><dd>" + esc(it[fb])
          + "</dd></div>";
      }).join("") + "</dl>";
    }
    var tierCards = Object.keys(d.tierMeta).sort().map(function (t) {
      var m = d.tierMeta[t];
      return '<div class="tier-card"><span class="tier" style="background:'
        + esc(m.color) + '">T' + esc(t) + "</span><h4>" + esc(m.label)
        + "</h4><p>" + esc(m.def) + "</p></div>";
    }).join("");
    return '<div class="container">'
      + "<h2>" + esc(cfg.METHOD_TITLE) + "</h2>"
      + '<p class="m-note">' + esc(cfg.METHOD_NOTE) + "</p>"
      + '<div class="m-grid">'
      + "<div><h3>Source models</h3>" + list(meth.sources, "code", "desc") + "</div>"
      + "<div><h3>Scoring method</h3>" + list(meth.scoring, "label", "text") + "</div>"
      + "<div><h3>Confidence levels</h3>" + list(meth.confidence, "level", "def") + "</div>"
      + "</div>"
      + '<h3 class="m-tiers-h">The AI maturity ladder</h3>'
      + '<div class="tier-cards">' + tierCards + "</div></div>";
  }

  function footer(d) {
    var y = new Date().getFullYear();
    return '<div class="container">'
      + '<div class="f-cta">'
      + '<a class="btn-primary" href="' + esc(cfg.FOOTER_DOWNLOAD_URL)
      + '" target="_blank" rel="noopener">' + esc(cfg.FOOTER_DOWNLOAD_TEXT) + "</a>"
      + '<a class="btn-ghost" href="' + esc(cfg.FOOTER_CONTACT_MAILTO) + '">'
      + esc(cfg.FOOTER_CONTACT_TEXT) + "</a></div>"
      + '<p class="f-teaser">' + esc(cfg.PHASE_TEASER) + "</p>"
      + '<p class="f-legal"><span class="logo" aria-hidden="true">DSG</span> © '
      + y + " " + esc(cfg.ORG)
      + ". Data generated " + esc((d.meta.generatedAt || "").slice(0, 10))
      + " from internal research; filtered for public release.</p></div>";
  }

  function errorPanel(msg) {
    return '<div class="container"><div class="err"><h2>Dashboard data '
      + "unavailable</h2><p>" + esc(msg) + "</p><p>Regenerate <code>data.js</code>"
      + " with <code>tools/convert_xlsx.py</code> and reload.</p></div></div>";
  }

  A.render = {
    header: header, stats: stats, controls: controls, chipsBar: chipsBar,
    table: table, cards: cards, methodology: methodology, footer: footer,
    errorPanel: errorPanel, detailPanel: detailPanel,
  };
})(window.AITOP = window.AITOP || {});
