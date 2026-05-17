/* Hand-rolled inline-SVG horizontal stacked bar: distribution sector x AI
   maturity tier. No chart library (CDNs blocked). Fluid via viewBox. */
(function (A) {
  "use strict";
  var esc = A.format.esc;
  var VW = 1000, GUT = 220, X0 = GUT, X1 = 980, TOP = 46, BARH = 26, GAP = 12;

  function buildSeries(companies, tierMeta) {
    var tiers = Object.keys(tierMeta).sort(); // "1".."5"
    var map = {};
    companies.forEach(function (c) {
      if (!c.tier) return; // unrated excluded from stacks (see caption)
      var k = c.sectorBucket;
      (map[k] = map[k] || {}).total = (map[k] || {}).total || 0;
      map[k][c.tier] = (map[k][c.tier] || 0) + 1;
      map[k].total += 1;
    });
    var rows = Object.keys(map).map(function (s) {
      return { sector: s, total: map[s].total, byTier: map[s] };
    }).sort(function (a, b) {
      return b.total - a.total || a.sector.localeCompare(b.sector);
    });
    return { rows: rows, tiers: tiers };
  }

  function ticks(max) {
    var step = max <= 5 ? 1 : max <= 10 ? 2 : max <= 20 ? 5 : 10, t = [];
    for (var v = 0; v <= max; v += step) t.push(v);
    if (t[t.length - 1] !== max) t.push(max);
    return t;
  }

  function render(container, companies, tierMeta, title) {
    var s = buildSeries(companies, tierMeta);
    if (!s.rows.length) {
      container.innerHTML = '<p class="chart-empty">No rated companies for the '
        + 'current filters.</p>';
      return;
    }
    var maxV = Math.max.apply(null, s.rows.map(function (r) { return r.total; }));
    var scale = (X1 - X0) / maxV;
    var H = TOP + s.rows.length * (BARH + GAP) + 34;
    var p = [];

    p.push('<svg viewBox="0 0 ' + VW + ' ' + H + '" class="chart-svg" '
      + 'role="img" aria-label="' + esc(title) + '" preserveAspectRatio="xMinYMin meet">');
    p.push('<text x="0" y="24" class="c-title">' + esc(title) + "</text>");

    ticks(maxV).forEach(function (v) {
      var x = X0 + v * scale;
      p.push('<line x1="' + x + '" y1="' + TOP + '" x2="' + x + '" y2="'
        + (H - 34) + '" class="c-grid"/>');
      p.push('<text x="' + x + '" y="' + (H - 14) + '" class="c-axis" '
        + 'text-anchor="middle">' + v + "</text>");
    });

    s.rows.forEach(function (r, i) {
      var y = TOP + i * (BARH + GAP), x = X0;
      p.push('<text x="' + (GUT - 12) + '" y="' + (y + BARH / 2 + 4)
        + '" class="c-label" text-anchor="end">' + esc(r.sector) + "</text>");
      s.tiers.forEach(function (t) {
        var n = r.byTier[t] || 0;
        if (!n) return;
        var w = n * scale, m = tierMeta[t];
        p.push('<rect x="' + x + '" y="' + y + '" width="' + w + '" height="'
          + BARH + '" fill="' + esc(m.color) + '" class="c-seg" tabindex="0" '
          + 'role="img" data-tip="' + esc(r.sector + " · T" + t + " "
          + m.label + ": " + n + (n === 1 ? " company" : " companies"))
          + '" aria-label="' + esc(r.sector + ", tier " + t + " " + m.label
          + ", " + n + (n === 1 ? " company" : " companies")) + '">');
        p.push("</rect>");
        if (w > 22) {
          p.push('<text x="' + (x + w / 2) + '" y="' + (y + BARH / 2 + 4)
            + '" class="c-num" text-anchor="middle">' + n + "</text>");
        }
        x += w;
      });
      p.push('<text x="' + (x + 8) + '" y="' + (y + BARH / 2 + 4)
        + '" class="c-total">' + r.total + "</text>");
    });
    p.push("</svg>");

    var legend = '<ul class="c-legend" role="list">' + s.tiers.map(function (t) {
      var m = tierMeta[t];
      return '<li><span class="c-key" style="background:' + esc(m.color)
        + '"></span>T' + esc(t) + " · " + esc(m.label) + "</li>";
    }).join("") + "</ul>";

    container.innerHTML = legend + '<div class="chart-wrap"></div>'
      + '<p class="chart-cap">Bars show ranked companies with a determined '
      + 'maturity tier; unrated companies are excluded. Number at bar end = '
      + 'sector total.</p><div class="chart-tip" role="status" aria-live="polite"></div>';
    container.querySelector(".chart-wrap").innerHTML = p.join("");

    var tip = container.querySelector(".chart-tip");
    var wrap = container.querySelector(".chart-wrap");
    function show(seg) {
      tip.textContent = seg.getAttribute("data-tip");
      tip.classList.add("on");
    }
    function place(evt) {
      var b = wrap.getBoundingClientRect();
      tip.style.left = Math.min(evt.clientX - b.left + 12, b.width - 180) + "px";
      tip.style.top = (evt.clientY - b.top + 12) + "px";
    }
    wrap.addEventListener("mouseover", function (e) {
      if (e.target.classList.contains("c-seg")) { show(e.target); place(e); }
    });
    wrap.addEventListener("mousemove", function (e) {
      if (e.target.classList.contains("c-seg")) place(e);
    });
    wrap.addEventListener("mouseout", function () { tip.classList.remove("on"); });
    wrap.addEventListener("focusin", function (e) {
      if (!e.target.classList || !e.target.classList.contains("c-seg")) return;
      var r = e.target.getBoundingClientRect(), b = wrap.getBoundingClientRect();
      tip.textContent = e.target.getAttribute("data-tip");
      tip.style.left = Math.min(r.left - b.left, b.width - 180) + "px";
      tip.style.top = (r.bottom - b.top + 6) + "px";
      tip.classList.add("on");
    });
    wrap.addEventListener("focusout", function () { tip.classList.remove("on"); });
  }

  A.chart = { render: render };
})(window.AITOP = window.AITOP || {});
