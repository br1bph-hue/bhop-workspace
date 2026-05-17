/* Tiny observable store. Filters use Sets; subscribe() fires on every change. */
(function (A) {
  "use strict";

  function createStore() {
    var subs = [];
    var state = {
      filters: { tiers: {}, sectors: {}, ownership: {}, confidence: {}, search: "" },
      sort: "rank",            // rank | company | tier | sector
      expandedId: null,
      viewMode: "table",       // table | cards
    };

    function emit() { subs.forEach(function (fn) { fn(state); }); }

    function toggleFilter(facet, value) {
      var grp = state.filters[facet];
      if (grp[value]) delete grp[value]; else grp[value] = true;
      state.expandedId = null;
      emit();
    }
    function setSearch(v) { state.filters.search = v || ""; state.expandedId = null; emit(); }
    function setSort(v) { state.sort = v; emit(); }
    function setView(v) { if (state.viewMode !== v) { state.viewMode = v; emit(); } }
    function toggleExpanded(id) {
      state.expandedId = state.expandedId === id ? null : id; emit();
    }
    function clearAll() {
      state.filters = { tiers: {}, sectors: {}, ownership: {}, confidence: {}, search: "" };
      state.expandedId = null; emit();
    }
    function activeCount() {
      var f = state.filters, n = f.search ? 1 : 0;
      ["tiers", "sectors", "ownership", "confidence"].forEach(function (k) {
        n += Object.keys(f[k]).length;
      });
      return n;
    }

    return {
      get: function () { return state; },
      subscribe: function (fn) { subs.push(fn); return fn; },
      toggleFilter: toggleFilter, setSearch: setSearch, setSort: setSort,
      setView: setView, toggleExpanded: toggleExpanded, clearAll: clearAll,
      activeCount: activeCount,
    };
  }

  A.createStore = createStore;
})(window.AITOP = window.AITOP || {});
