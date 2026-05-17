/* Reads & validates window.DASHBOARD_DATA, applies the phase (rank) gate, and
   derives live facet option lists. Throws a typed error that app.js renders as
   a visible panel (never a white screen). */
(function (A) {
  "use strict";

  function validate(d) {
    if (!d || typeof d !== "object") throw mkErr("window.DASHBOARD_DATA missing.");
    if (!Array.isArray(d.companies) || !d.companies.length)
      throw mkErr("No companies in data.");
    if (!d.tierMeta || !d.phaseConfig) throw mkErr("Data shape invalid (tierMeta/phaseConfig).");
    return d;
  }
  function mkErr(m) { var e = new Error(m); e.isDataError = true; return e; }

  function phaseCfg(d, phase) {
    return d.phaseConfig[String(phase || d.phase || 1)] || d.phaseConfig["1"];
  }

  // Companies visible in the active phase: rank within maxRank.
  function phaseCompanies(d, phase) {
    var max = phaseCfg(d, phase).maxRank;
    return d.companies.filter(function (c) {
      return typeof c.rank === "number" && c.rank >= 1 && c.rank <= max;
    });
  }

  function uniqueSorted(arr) {
    return Object.keys(arr.reduce(function (m, v) {
      if (v != null && v !== "") m[v] = 1; return m;
    }, {})).sort();
  }

  // Facet option lists + counts over the phase set (counts ignore that facet's
  // own selection so option counts stay meaningful).
  function facets(pcs, meta) {
    var tiers = [];
    Object.keys(meta).sort().forEach(function (t) {
      var n = pcs.filter(function (c) { return String(c.tier) === t; }).length;
      if (n) tiers.push({ value: t, label: "T" + t + " · " + meta[t].label,
                          color: meta[t].color, count: n });
    });
    var unrated = pcs.filter(function (c) { return !c.tier; }).length;
    if (unrated) tiers.push({ value: "0", label: "Unrated", color: "#888888",
                              count: unrated });

    function facet(key) {
      return uniqueSorted(pcs.map(function (c) { return c[key]; })).map(function (v) {
        return { value: v, label: v,
                 count: pcs.filter(function (c) { return c[key] === v; }).length };
      });
    }
    return {
      tiers: tiers,
      sectors: facet("sectorBucket"),
      ownership: facet("ownership"),
      confidence: facet("confidence"),
    };
  }

  A.data = {
    validate: validate, phaseCfg: phaseCfg, phaseCompanies: phaseCompanies,
    facets: facets,
  };
})(window.AITOP = window.AITOP || {});
