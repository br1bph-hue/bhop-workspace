// AI Top 25 Dashboard — interactive logic
(function () {
  'use strict';

  const DATA = window.AI_TOP_DATA || [];

  const SPEC_VERTICALS = [
    'Automotive Parts', 'Building Materials', 'Chemicals', 'Electrical',
    'Electronics & Technology', 'Foodservice', 'HVAC', 'Industrial',
    'Industrial Gases', 'Jan/San', 'Medical Supplies', 'Metals',
    'Plumbing', 'Pool & Outdoor',
  ];

  // ---------- State ----------
  const ALL_TIERS = [1, 2, 3, 4];
  const state = {
    tiers: new Set(ALL_TIERS),
    ownerships: new Set(['Public', 'Private', 'Employee-Owned']),
    verticals: new Set(), // empty = all
    search: '',
    sort: 'tier',
    expanded: null,
  };

  // ---------- DOM refs ----------
  const $ = (sel) => document.querySelector(sel);
  const tableBody = $('#tableBody');
  const cardGrid = $('#cardGrid');
  const resultCount = $('#resultCount');
  const emptyState = $('#emptyState');
  const filterChips = $('#filterChips');
  const verticalMenu = $('#verticalMenu');
  const verticalButton = $('#verticalButton');
  const verticalButtonLabel = $('#verticalButtonLabel');
  const searchInput = $('#searchInput');
  const sortSelect = $('#sortSelect');

  // ---------- Build vertical menu ----------
  function buildVerticalMenu() {
    const presentCounts = {};
    DATA.forEach(c => { presentCounts[c.vertical] = (presentCounts[c.vertical] || 0) + 1; });
    const allVerticals = Array.from(new Set([...SPEC_VERTICALS, ...Object.keys(presentCounts)])).sort();

    verticalMenu.innerHTML = '';
    allVerticals.forEach(v => {
      const count = presentCounts[v] || 0;
      const label = document.createElement('label');
      label.innerHTML = `
        <input type="checkbox" data-vertical="${escapeAttr(v)}" />
        <span>${escapeHtml(v)}</span>
        <span class="count">${count > 0 ? `(${count})` : '—'}</span>
      `;
      const cb = label.querySelector('input');
      cb.addEventListener('change', (e) => {
        if (e.target.checked) state.verticals.add(v);
        else state.verticals.delete(v);
        render();
      });
      if (count === 0) {
        cb.disabled = true;
        label.style.opacity = '0.4';
        label.style.cursor = 'not-allowed';
      }
      verticalMenu.appendChild(label);
    });
  }

  function updateVerticalButtonLabel() {
    if (state.verticals.size === 0) verticalButtonLabel.textContent = 'All verticals';
    else if (state.verticals.size === 1) verticalButtonLabel.textContent = Array.from(state.verticals)[0];
    else verticalButtonLabel.textContent = `${state.verticals.size} verticals`;
  }

  // ---------- Filter & sort ----------
  function getFiltered() {
    const q = state.search.trim().toLowerCase();
    return DATA.filter(c => {
      if (!state.tiers.has(c.tier)) return false;
      if (!state.ownerships.has(c.ownership)) return false;
      if (state.verticals.size > 0 && !state.verticals.has(c.vertical)) return false;
      if (q && !c.company.toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => {
      if (state.sort === 'company') return a.company.localeCompare(b.company);
      if (state.sort === 'vertical') return a.vertical.localeCompare(b.vertical) || a.rank - b.rank;
      if (state.sort === 'evidence') return b.evidence_dots - a.evidence_dots || a.rank - b.rank;
      return a.rank - b.rank;
    });
  }

  // ---------- Render ----------
  function render() {
    updateVerticalButtonLabel();
    renderTable();
    renderCards();
    renderChips();
    renderStats();
    renderChart();
  }

  function renderStats() {
    document.querySelector('[data-stat="total"]').textContent = DATA.length;
    ALL_TIERS.forEach(t => {
      const el = document.querySelector(`[data-stat="tier${t}"]`);
      if (el) el.textContent = DATA.filter(c => c.tier === t).length;
    });
    const verticalsPresent = new Set(DATA.map(c => c.vertical));
    const vEl = document.querySelector('[data-stat="verticals"]');
    if (vEl) vEl.textContent = verticalsPresent.size;
    ALL_TIERS.forEach(t => {
      const card = document.querySelector(`[data-tier-count="${t}"]`);
      if (card) card.textContent = `${DATA.filter(c => c.tier === t).length} companies`;
    });
  }

  function renderTable() {
    const rows = getFiltered();
    tableBody.innerHTML = '';
    if (rows.length === 0) {
      emptyState.hidden = false;
      resultCount.textContent = `Showing 0 of ${DATA.length} companies`;
      return;
    }
    emptyState.hidden = true;
    resultCount.textContent = `Showing ${rows.length} of ${DATA.length} companies`;

    rows.forEach(c => {
      const tr = document.createElement('tr');
      tr.className = 'company-row' + (state.expanded === c.rank ? ' expanded' : '');
      tr.dataset.rank = c.rank;
      tr.innerHTML = `
        <td class="col-tier"><span class="tier-badge tier${c.tier}">Tier ${c.tier}</span></td>
        <td class="col-company">
          <div class="company-cell">
            <div>
              <span class="company-name">${escapeHtml(c.company)}</span>${c.ticker ? `<span class="company-ticker">${escapeHtml(c.ticker)}</span>` : ''}
            </div>
            <span class="ownership-tag">${escapeHtml(c.ownership)}</span>
          </div>
        </td>
        <td class="col-vertical">${escapeHtml(c.vertical)}</td>
        <td class="col-usecase use-case-cell">${escapeHtml(truncate(c.use_case_summary, 120))}</td>
        <td class="col-evidence">
          ${evidenceDots(c.evidence_dots)}
        </td>
        <td class="col-detail"><span class="chev-cell">▶</span></td>
      `;
      tr.addEventListener('click', () => toggleExpand(c.rank));
      tableBody.appendChild(tr);

      if (state.expanded === c.rank) {
        const dr = document.createElement('tr');
        dr.className = 'detail-row';
        const td = document.createElement('td');
        td.colSpan = 6;
        td.appendChild(buildDetailPanel(c));
        dr.appendChild(td);
        tableBody.appendChild(dr);
      }
    });
  }

  function renderCards() {
    const rows = getFiltered();
    cardGrid.innerHTML = '';
    rows.forEach(c => {
      const card = document.createElement('div');
      card.className = 'company-card' + (state.expanded === c.rank ? ' expanded' : '');
      card.innerHTML = `
        <div class="card-head">
          <span class="tier-badge tier${c.tier}">Tier ${c.tier}</span>
          <span class="evidence-dots">${evidenceDots(c.evidence_dots, true)}</span>
        </div>
        <div class="company-name">${escapeHtml(c.company)}${c.ticker ? `<span class="company-ticker">${escapeHtml(c.ticker)}</span>` : ''}</div>
        <div class="card-vertical">${escapeHtml(c.vertical)} · ${escapeHtml(c.ownership)}</div>
        <div class="card-usecase">${escapeHtml(truncate(c.use_case_summary, 140))}</div>
        <div class="card-detail"></div>
      `;
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleExpand(c.rank);
      });
      if (state.expanded === c.rank) {
        card.querySelector('.card-detail').appendChild(buildDetailPanel(c));
      }
      cardGrid.appendChild(card);
    });
  }

  function buildDetailPanel(c) {
    const wrap = document.createElement('div');
    wrap.className = 'detail-panel';

    const left = document.createElement('div');
    left.innerHTML = `
      <div class="detail-section">
        <h4>Company Profile</h4>
        <div class="profile-meta">
          ${c.profile.hq ? `<div><strong>HQ:</strong>${escapeHtml(c.profile.hq)}</div>` : ''}
          ${c.profile.revenue ? `<div><strong>Revenue:</strong>${escapeHtml(c.profile.revenue)}</div>` : ''}
          ${c.profile.employees ? `<div><strong>Employees:</strong>${escapeHtml(c.profile.employees)}</div>` : ''}
          ${c.ticker ? `<div><strong>Ticker:</strong>${escapeHtml(c.ticker)}</div>` : ''}
          <div><strong>Vertical:</strong>${escapeHtml(c.vertical)}</div>
          <div><strong>Ownership:</strong>${escapeHtml(c.ownership)}</div>
        </div>
        ${c.profile.summary ? `<p class="profile-summary">${escapeHtml(c.profile.summary)}</p>` : ''}
      </div>

      <div class="detail-section">
        <h4>Deployed AI Use Cases</h4>
        <p class="usecase-text">${escapeHtml(c.use_case_full || 'Limited public evidence')}</p>
      </div>

      <div class="detail-section">
        <h4>Measurable Outcomes</h4>
        <div class="outcomes-block">${escapeHtml(c.outcomes || 'Limited public evidence')}</div>
      </div>
    `;

    const right = document.createElement('div');
    right.innerHTML = `
      <div class="detail-section">
        <h4>Technology Stack</h4>
        ${c.tech_stack && c.tech_stack.length
          ? `<div class="tech-chips">${c.tech_stack.map(t => `<span class="tech-chip">${escapeHtml(t)}</span>`).join('')}</div>`
          : `<p class="usecase-text" style="color:var(--grey);">Limited public evidence of named platforms.</p>`}
      </div>

      <div class="detail-section">
        <h4>Leadership Signals</h4>
        ${c.leadership_signal
          ? `<blockquote class="leadership-quote">${escapeHtml(c.leadership_signal)}</blockquote>`
          : `<p class="usecase-text" style="color:var(--grey);">Limited public evidence.</p>`}
      </div>

      <div class="detail-section">
        <h4>Evidence Quality</h4>
        <div class="evidence-card">
          <span class="label ${c.evidence_strength.toLowerCase()}">${escapeHtml(c.evidence_strength)}</span>
          ${evidenceRationale(c.evidence_strength)}
          <div class="confidence-meta">Research confidence: ${escapeHtml(c.confidence || 'Medium')}</div>
        </div>
      </div>

      <div class="detail-cta">
        <a href="#download">Read full profile in the AI Top 50 Report →</a>
      </div>
    `;

    wrap.appendChild(left);
    wrap.appendChild(right);
    return wrap;
  }

  function evidenceRationale(strength) {
    const s = (strength || '').toLowerCase();
    if (s === 'strong') return 'Multiple primary sources verified production AI deployments.';
    if (s === 'moderate') return 'Use cases evidenced in trade press or vendor case studies; some claims pending validation.';
    if (s === 'thin') return 'Signal-derived; awaiting first-party validation.';
    return '';
  }

  function evidenceDots(n, compact) {
    n = Number(n) || 0;
    const filled = '●'.repeat(n);
    const empty = '<span class="dim">' + '●'.repeat(3 - n) + '</span>';
    const labelText = n === 3 ? 'Strong' : n === 2 ? 'Moderate' : n === 1 ? 'Thin' : '—';
    return `<span class="evidence-dots">${filled}${empty}</span>${compact ? '' : ` <span class="evidence-label">${labelText}</span>`}`;
  }

  // ---------- Chips ----------
  function renderChips() {
    filterChips.innerHTML = '';
    const chips = [];
    // tier
    if (state.tiers.size < ALL_TIERS.length) {
      const selected = ALL_TIERS.filter(t => state.tiers.has(t));
      chips.push({
        label: selected.length === 1 ? `Tier ${selected[0]} only` : `Tiers: ${selected.join(', ')}`,
        remove: () => { state.tiers = new Set(ALL_TIERS); syncToggles(); }
      });
    }
    // ownership
    const allOwnerships = ['Public', 'Private', 'Employee-Owned'];
    const missing = allOwnerships.filter(o => !state.ownerships.has(o));
    if (missing.length > 0 && missing.length < allOwnerships.length) {
      const shown = allOwnerships.filter(o => state.ownerships.has(o)).join(', ');
      chips.push({ label: `Ownership: ${shown}`, remove: () => { state.ownerships = new Set(allOwnerships); syncToggles(); } });
    }
    // verticals
    state.verticals.forEach(v => {
      chips.push({ label: `Vertical: ${v}`, remove: () => {
        state.verticals.delete(v);
        const cb = verticalMenu.querySelector(`input[data-vertical="${cssEscape(v)}"]`);
        if (cb) cb.checked = false;
      }});
    });
    // search
    if (state.search.trim()) {
      chips.push({ label: `Search: "${state.search.trim()}"`, remove: () => { state.search = ''; searchInput.value = ''; }});
    }

    chips.forEach(c => {
      const chip = document.createElement('span');
      chip.className = 'filter-chip';
      chip.innerHTML = `${escapeHtml(c.label)} <button class="x" aria-label="Remove filter">×</button>`;
      chip.querySelector('.x').addEventListener('click', () => { c.remove(); render(); });
      filterChips.appendChild(chip);
    });

    if (chips.length > 0) {
      const clear = document.createElement('button');
      clear.className = 'clear-all';
      clear.textContent = 'Clear all';
      clear.addEventListener('click', clearAll);
      filterChips.appendChild(clear);
    }
  }

  function syncToggles() {
    document.querySelectorAll('#tierToggles .toggle').forEach(b => {
      b.classList.toggle('active', state.tiers.has(Number(b.dataset.tier)));
    });
    document.querySelectorAll('#ownershipToggles .toggle').forEach(b => {
      b.classList.toggle('active', state.ownerships.has(b.dataset.own));
    });
  }

  function clearAll() {
    state.tiers = new Set(ALL_TIERS);
    state.ownerships = new Set(['Public', 'Private', 'Employee-Owned']);
    state.verticals = new Set();
    state.search = '';
    searchInput.value = '';
    verticalMenu.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
    syncToggles();
    render();
  }

  // ---------- Chart ----------
  function renderChart() {
    const chartEl = $('#verticalChart');
    chartEl.innerHTML = '';
    const buckets = {};
    DATA.forEach(c => {
      if (!buckets[c.vertical]) buckets[c.vertical] = { 1: 0, 2: 0, 3: 0, 4: 0 };
      buckets[c.vertical][c.tier] += 1;
    });
    const rows = Object.entries(buckets)
      .map(([v, b]) => ({ vertical: v, t1: b[1], t2: b[2], t3: b[3], t4: b[4], total: b[1] + b[2] + b[3] + b[4] }))
      .sort((a, b) => b.total - a.total);
    const maxTotal = Math.max(1, ...rows.map(r => r.total));

    rows.forEach(r => {
      const row = document.createElement('div');
      row.className = 'chart-row';
      const seg = (n, klass, label) => n > 0
        ? `<div class="bar-seg ${klass}" style="width:${(n / maxTotal) * 100}%" title="${n} ${label}">${n}</div>`
        : '';
      row.innerHTML = `
        <div class="label">${escapeHtml(r.vertical)}</div>
        <div class="bar-track">
          ${seg(r.t1, 'tier1', 'Tier 1')}
          ${seg(r.t2, 'tier2', 'Tier 2')}
          ${seg(r.t3, 'tier3', 'Tier 3')}
          ${seg(r.t4, 'tier4', 'Tier 4')}
        </div>
        <div class="total">${r.total}</div>
      `;
      chartEl.appendChild(row);
    });
  }

  // ---------- Interactions ----------
  function toggleExpand(rank) {
    state.expanded = state.expanded === rank ? null : rank;
    render();
  }

  function bindControls() {
    document.querySelectorAll('#tierToggles .toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = Number(btn.dataset.tier);
        if (state.tiers.has(t)) state.tiers.delete(t); else state.tiers.add(t);
        if (state.tiers.size === 0) state.tiers.add(t); // can't have zero
        syncToggles();
        render();
      });
    });
    document.querySelectorAll('#ownershipToggles .toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const o = btn.dataset.own;
        if (state.ownerships.has(o)) state.ownerships.delete(o); else state.ownerships.add(o);
        if (state.ownerships.size === 0) state.ownerships.add(o);
        syncToggles();
        render();
      });
    });

    verticalButton.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = verticalMenu.classList.toggle('open');
      verticalButton.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (e) => {
      if (!verticalMenu.contains(e.target) && e.target !== verticalButton) {
        verticalMenu.classList.remove('open');
        verticalButton.setAttribute('aria-expanded', 'false');
      }
    });

    searchInput.addEventListener('input', (e) => {
      state.search = e.target.value;
      render();
    });
    sortSelect.addEventListener('change', (e) => {
      state.sort = e.target.value;
      render();
    });

    document.querySelectorAll('.company-table thead th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const s = th.dataset.sort;
        state.sort = s;
        sortSelect.value = s === 'evidence' ? 'tier' : s; // sort dropdown doesn't carry evidence
        render();
      });
    });

    document.getElementById('clearAllEmpty').addEventListener('click', clearAll);

    // Smooth scroll Download CTA for now (placeholder)
    document.getElementById('downloadCta').addEventListener('click', (e) => {
      // leave behavior to host integration
    });
  }

  // ---------- Utilities ----------
  function truncate(s, n) {
    if (!s) return '';
    if (s.length <= n) return s;
    return s.slice(0, n).replace(/\s+\S*$/, '') + '…';
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escapeAttr(s) { return escapeHtml(s); }
  function cssEscape(s) { return String(s).replace(/(["\\])/g, '\\$1'); }

  // ---------- Boot ----------
  buildVerticalMenu();
  bindControls();
  render();
})();
