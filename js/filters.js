/* Pure filter/sort/derive helpers. AND across facets, OR within a facet. */
(function (A) {
  "use strict";

  function selected(group) { return Object.keys(group); }

  function applyFilters(companies, filters) {
    var tiers = selected(filters.tiers),
        sectors = selected(filters.sectors),
        own = selected(filters.ownership),
        conf = selected(filters.confidence),
        q = filters.search.trim().toLowerCase();

    return companies.filter(function (c) {
      if (tiers.length) {
        var tv = c.tier ? String(c.tier) : "0";
        if (tiers.indexOf(tv) === -1) return false;
      }
      if (sectors.length && sectors.indexOf(c.sectorBucket) === -1) return false;
      if (own.length && own.indexOf(c.ownership) === -1) return false;
      if (conf.length && conf.indexOf(c.confidence) === -1) return false;
      if (q) {
        var hay = (c.company + " " + c.sector + " " + c.sectorBucket + " "
          + c.tableSummary + " " + c.workingDescription).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function applySort(rows, sort) {
    var r = rows.slice();
    if (sort === "company") {
      r.sort(function (a, b) { return a.company.localeCompare(b.company); });
    } else if (sort === "sector") {
      r.sort(function (a, b) {
        return a.sectorBucket.localeCompare(b.sectorBucket) || a.rank - b.rank;
      });
    } else if (sort === "tier") {
      // Strongest maturity first; unrated last; rank as tiebreaker.
      r.sort(function (a, b) {
        return (b.tier || 0) - (a.tier || 0) || a.rank - b.rank;
      });
    } else {
      r.sort(function (a, b) { return a.rank - b.rank; });
    }
    return r;
  }

  function activeChips(filters, tierMeta) {
    var chips = [];
    Object.keys(filters.tiers).forEach(function (t) {
      chips.push({ facet: "tiers", value: t,
        label: t === "0" ? "Unrated" : "T" + t + " · " + (tierMeta[t] || {}).label });
    });
    ["sectors", "ownership", "confidence"].forEach(function (f) {
      Object.keys(filters[f]).forEach(function (v) {
        chips.push({ facet: f, value: v, label: v });
      });
    });
    if (filters.search.trim()) {
      chips.push({ facet: "search", value: "", label: '“' + filters.search.trim() + '”' });
    }
    return chips;
  }

  function summarize(shown, total) {
    return "Showing " + shown + " of " + total
      + (total === 1 ? " company" : " companies");
  }

  A.filters = { applyFilters: applyFilters, applySort: applySort,
                activeChips: activeChips, summarize: summarize };
})(window.AITOP = window.AITOP || {});
