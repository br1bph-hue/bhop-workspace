/* Pure formatting/escaping helpers. Every dynamic value rendered by render.js
   passes through esc() — XSS-safe by construction. */
(function (A) {
  "use strict";
  var FALLBACK = "Limited public evidence";

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function truncate(text, n) {
    var t = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
    n = n || 120;
    if (t.length <= n) return t;
    var cut = t.slice(0, n).replace(/\s+\S*$/, "").replace(/[,.;:—-]+$/, "");
    return (cut || t.slice(0, n)) + "…";
  }

  // Marks the never-blank fallback so the UI can italicise it. Returns
  // {html, thin}. `value` is already the converter's resolved string.
  function fieldOrFallback(value) {
    var v = value == null ? "" : String(value);
    var thin = (v === "" || v === FALLBACK);
    return { html: esc(thin ? FALLBACK : v), thin: thin };
  }

  function ownershipBadge(ownership) {
    var o = String(ownership || "").trim();
    if (!o) return "";
    var cls = /employee/i.test(o) ? "own-emp"
            : /private|family|subsidiary|backed/i.test(o) ? "own-priv"
            : /public/i.test(o) ? "own-pub" : "own-other";
    return '<span class="own ' + cls + '">' + esc(o) + "</span>";
  }

  function tierBadge(tier, meta) {
    if (!tier || !meta) {
      return '<span class="tier tier-na" title="Maturity tier not determined">'
        + 'Unrated</span>';
    }
    var m = meta[String(tier)] || {};
    return '<span class="tier" style="background:' + esc(m.color || "#888")
      + '" title="' + esc((m.label || "") + " — " + (m.def || "")) + '">'
      + "T" + esc(tier) + " · " + esc(m.label || "") + "</span>";
  }

  function pct(part, whole) {
    return whole ? Math.round((part / whole) * 100) : 0;
  }

  A.format = { esc: esc, truncate: truncate, fieldOrFallback: fieldOrFallback,
               ownershipBadge: ownershipBadge, tierBadge: tierBadge, pct: pct,
               FALLBACK: FALLBACK };
})(window.AITOP = window.AITOP || {});
