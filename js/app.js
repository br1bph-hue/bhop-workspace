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
    $("aiAssistant").innerHTML = A.render.assistant(d);
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

    // ---- AI assistant wiring ----
    var assistantBusy = false;
    function appendAssistantHtml(html, role) {
      var log = $("aiAssistantLog");
      if (!log) return;
      var bubble = document.createElement("div");
      bubble.className = "as-bubble as-" + (role || "assistant");
      bubble.innerHTML = html;
      log.appendChild(bubble);
      bubble.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    function appendUserQ(q) {
      appendAssistantHtml('<p>' + A.format.esc(q) + '</p>', "user");
    }
    function setKeyStatus(text) {
      var s = document.getElementById("aiAssistantKeyStatus");
      if (s) s.textContent = text;
    }

    function handleAsk() {
      if (assistantBusy) return;
      var input = $("aiAssistantInput");
      if (!input) return;
      var q = input.value.trim();
      if (!q) return;
      input.value = "";
      appendUserQ(q);

      var res = A.assistant.answer(q, d);
      appendAssistantHtml(res.html, "assistant");

      if (res.kind === "unknown") {
        var key = A.assistant.getKey();
        if (!key) return;
        // Hand off to Perplexity. Show a working state.
        var loading = document.createElement("div");
        loading.className = "as-bubble as-assistant";
        loading.innerHTML = '<div class="as-loading">Searching the web with Perplexity Sonar…</div>';
        $("aiAssistantLog").appendChild(loading);
        loading.scrollIntoView({ behavior: "smooth", block: "nearest" });
        assistantBusy = true;
        A.assistant.askLLM(q, d, key).then(function (out) {
          loading.innerHTML = A.assistant.renderLLM(out.text, out.citations);
        }).catch(function (err) {
          loading.innerHTML = '<div class="as-empty">' + A.format.esc(
            (err && err.message) || "Perplexity request failed.")
            + " Check your API key in Settings.</div>";
        }).then(function () { assistantBusy = false; });
      }
    }

    var form = document.getElementById("aiAssistantForm");
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        handleAsk();
      });
    }
    $("aiAssistant").addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.id) return;
      if (t.id === "aiAssistantKeySave") {
        var input = document.getElementById("aiAssistantKeyInput");
        var v = input ? input.value.trim() : "";
        if (!v) { setKeyStatus("Paste a key first."); return; }
        if (A.assistant.setKey(v)) {
          if (input) input.value = "";
          setKeyStatus("Key set for this session.");
        } else {
          setKeyStatus("Could not save the key (storage unavailable).");
        }
      } else if (t.id === "aiAssistantKeyClear") {
        A.assistant.clearKey();
        var inp = document.getElementById("aiAssistantKeyInput");
        if (inp) inp.value = "";
        setKeyStatus("No key set.");
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
