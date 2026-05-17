/* Bootstrap: validate data, render regions, wire delegated events, keep the
   chart + results in sync with the store. Classic script; runs from file://. */
(function (A) {
  "use strict";

  function $(id) { return document.getElementById(id); }

  function boot() {
    var d, cfg = A.config;
    try {
      d = A.data.validate(window.DASHBOARD_DATA);
    } catch (e) {
      $("explorer").innerHTML = A.render.errorPanel(
        e && e.message ? e.message : "Unknown error.");
      document.body.classList.add("data-error");
      return;
    }

    if (d.meta && d.meta.isFixture) document.body.classList.add("is-fixture");
    $("siteHeader").innerHTML = A.render.header(d);
    $("stats").innerHTML = A.render.stats(d);
    $("methodology").innerHTML = A.render.methodology(d);
    $("siteFooter").innerHTML = A.render.footer(d);
    $("chartTitle").textContent = cfg.CHART_TITLE;

    var store = A.createStore();
    var phaseCompanies = A.data.phaseCompanies(d);
    var facets = A.data.facets(phaseCompanies, d.tierMeta);
    var mq = window.matchMedia("(max-width:" + cfg.MOBILE_BREAKPOINT + "px)");

    function syncView(st) {
      var want = mq.matches ? "cards" : "table";
      if (st.viewMode !== want) st.viewMode = want;
    }

    function renderControls(st) {
      $("controls").innerHTML = A.render.controls(d, facets, st);
    }

    function renderResults(st) {
      var rows = A.filters.applySort(
        A.filters.applyFilters(phaseCompanies, st.filters), st.sort);
      var chips = A.filters.activeChips(st.filters, d.tierMeta);
      $("chips").innerHTML = A.render.chipsBar(
        chips, rows.length, phaseCompanies.length);
      $("results").innerHTML = (st.viewMode === "cards"
        ? A.render.cards : A.render.table)(rows, d, st.expandedId);
      A.chart.render($("chartBox"), rows, d.tierMeta, cfg.CHART_TITLE);
    }

    var searchTimer = null;

    store.subscribe(function (st) {
      syncView(st);
      renderControls(st);
      renderResults(st);
    });

    // ---- Delegated events (bound once on stable containers) ----
    $("controls").addEventListener("change", function (e) {
      var el = e.target;
      if (el.matches('input[type="checkbox"][data-facet]')) {
        store.toggleFilter(el.getAttribute("data-facet"), el.value);
      } else if (el.id === "sortSelect") {
        store.setSort(el.value);
      }
    });
    $("controls").addEventListener("input", function (e) {
      if (e.target.id !== "searchInput") return;
      var v = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        var st = store.get();
        st.filters.search = v;        // results-only update keeps input focus
        $("chips").innerHTML = A.render.chipsBar(
          A.filters.activeChips(st.filters, d.tierMeta),
          A.filters.applyFilters(phaseCompanies, st.filters).length,
          phaseCompanies.length);
        var rows = A.filters.applySort(
          A.filters.applyFilters(phaseCompanies, st.filters), st.sort);
        $("results").innerHTML = (st.viewMode === "cards"
          ? A.render.cards : A.render.table)(rows, d, st.expandedId);
        A.chart.render($("chartBox"), rows, d.tierMeta, cfg.CHART_TITLE);
      }, cfg.SEARCH_DEBOUNCE_MS);
    });

    function onClear(e) {
      if (e.target.id === "clearAll" || e.target.id === "clearAll2"
          || e.target.id === "clearAll3") store.clearAll();
    }
    $("chips").addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest(".chip")) {
        var b = e.target.closest(".chip");
        var f = b.getAttribute("data-chip-facet");
        if (f === "search") store.setSearch("");
        else store.toggleFilter(f, b.getAttribute("data-chip-value"));
        return;
      }
      onClear(e);
    });
    $("results").addEventListener("click", function (e) {
      onClear(e);
      var host = e.target.closest("[data-id]");
      if (host && !e.target.closest("a")) store.toggleExpanded(host.getAttribute("data-id"));
    });
    $("results").addEventListener("keydown", function (e) {
      var host = e.target.closest && e.target.closest("[data-id]");
      if (host && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        store.toggleExpanded(host.getAttribute("data-id"));
      }
    });

    mq.addEventListener("change", function () {
      var st = store.get();
      syncView(st); renderResults(st);
    });
    var rt = null;
    window.addEventListener("resize", function () {
      clearTimeout(rt);
      rt = setTimeout(function () {
        var rows = A.filters.applySort(
          A.filters.applyFilters(phaseCompanies, store.get().filters),
          store.get().sort);
        A.chart.render($("chartBox"), rows, d.tierMeta, cfg.CHART_TITLE);
      }, 150);
    });

    // Initial paint
    var st0 = store.get();
    syncView(st0);
    renderControls(st0);
    renderResults(st0);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else { boot(); }
})(window.AITOP = window.AITOP || {});
