/* Newborn Screening Malaysia — Tender Cost Estimator
   Front-end app: auth, site management, tab rendering, live recalculation.
   No build step — plain JS, talks to the Express API which proxies Supabase. */

console.log('APP.JS LOADED — TOP OF FILE, script is executing');

const state = { siteId: null, site: null, sites: [], activeTab: 'tenderSpec', activeCalcSection: 'batchSetup', saveTimer: null };

// ---------- Utilities ----------
function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
}
function fmt(value, kind) {
  if (value === undefined || value === null || Number.isNaN(value)) return '\u2014';
  switch (kind) {
    case 'int': return Math.round(value).toLocaleString();
    case 'num2': return Number(value).toFixed(2);
    case 'cur': return '$' + Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case 'pct': return (Number(value) * 100).toFixed(2) + '%';
    default: return String(value);
  }
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    cache: 'no-store', // GET responses here change frequently (site data, file lists) — never let the browser serve a stale cached copy
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

const DEFAULT_SITE_DATA = {
  batchSetup: { batches: 5, samplesPerBatch: 40, calLevels: 8, calReps: 1, qcLevels: 2, qcReps: 1, blanksPerBatch: 0 },
  lcGradient: [
    { no: 1, time: 0.00, flow: 0.600, a: 90, b: 10, shape: 'Initial' },
    { no: 2, time: 1.00, flow: 0.600, a: 80, b: 20, shape: 'Linear' },
    { no: 3, time: 3.00, flow: 0.600, a: 75, b: 25, shape: 'Linear' },
    { no: 4, time: 5.00, flow: 0.600, a: 65, b: 35, shape: 'Linear' },
    { no: 5, time: 6.00, flow: 0.600, a: 55, b: 45, shape: 'Linear' },
    { no: 6, time: 7.00, flow: 0.600, a: 30, b: 70, shape: 'Linear' },
    { no: 7, time: 7.10, flow: 0.600, a: 5, b: 95, shape: 'Linear' },
    { no: 8, time: 8.00, flow: 0.600, a: 5, b: 95, shape: 'Linear' },
    { no: 9, time: 8.01, flow: 0.600, a: 90, b: 10, shape: 'Linear' },
    { no: 10, time: 10.00, flow: 0.600, a: 90, b: 10, shape: 'Linear' },
  ],
  calibratorPrep: {
    stockDilution: [
      { level: 'S1 (neat stock)', conc: 500, vol: null, meoh: null },
      { level: 'S2', conc: 400, vol: 160, meoh: 40 },
      { level: 'S3', conc: 200, vol: 100, meoh: 100 },
      { level: 'S4', conc: 100, vol: 100, meoh: 100 },
      { level: 'S5', conc: 50, vol: 100, meoh: 100 },
      { level: 'S6', conc: 25, vol: 100, meoh: 100 },
      { level: 'S7', conc: 12.5, vol: 100, meoh: 100 },
      { level: 'S8', conc: 6.25, vol: 100, meoh: 100 },
    ],
    workingPrep: [
      { level: 'P1', source: 'S1 (neat stock)', vol: 15, isVol: 100 },
      { level: 'P2', source: 'S2', vol: 15, isVol: 100 },
      { level: 'P3', source: 'S3', vol: 15, isVol: 100 },
      { level: 'P4', source: 'S4', vol: 15, isVol: 100 },
      { level: 'P5', source: 'S5', vol: 15, isVol: 100 },
      { level: 'P6', source: 'S6', vol: 15, isVol: 100 },
      { level: 'P7', source: 'S7', vol: 15, isVol: 100 },
      { level: 'P8', source: 'S8', vol: 15, isVol: 100 },
    ],
    qcPrep: [
      { level: 'QC1', vol: 15, isVol: 100 },
      { level: 'QC2', vol: 15, isVol: 100 },
    ],
    standard: { vialSize: 1000, dead: 50, costPerVial: 400 },
  },
  reagents: {
    is: { volPerUse: 100, vialSize: 1500, dead: 100, costPerVial: 350 },
    qc: { volPerUse: 15, vialSize: 500, dead: 50, costPerVial: 220 },
  },
  column: {
    analytical: { label: 'Analytical column', cost: 650, lifetime: 500 },
    guard: { label: 'Guard column', cost: 120, lifetime: 100 },
  },
  solvents: {
    pfheptaConc: 0.001,
    water: { bottleSize: 4000, dead: 30, costPerBottle: 10 },
    acn: { bottleSize: 4000, dead: 30, costPerBottle: 55 },
    pfhepta: { bottleSize: 100, dead: 3, costPerBottle: 180 },
    calibratorMethanol: { bottleSize: 4000, dead: 30, costPerBottle: 45 },
    generalSolvents: [
      { name: 'Methanol (flush solvent / needle wash, general use)', qty: 6, costPerUnit: 45 },
      { name: 'Isopropanol (IPA, general instrument maintenance)', qty: 4, costPerUnit: 40 },
    ],
  },
  freightTax: {
    freightItems: [],
    taxRate: 0.06,
    applyTaxToFreight: true,
  },
  tenderSpec: {
    notes: '',
    links: [],
  },
  supportingInfo: {
    links: [],
    notes: '',
  },
};

// ---------- Auth ----------
async function checkSession() {
  const { authed } = await api('/api/session');
  if (authed) showApp(); else showLogin();
}
function showLogin() {
  document.getElementById('login-screen').hidden = false;
  document.getElementById('app-screen').hidden = true;
}
function showApp() {
  document.getElementById('login-screen').hidden = true;
  document.getElementById('app-screen').hidden = false;
  loadSites();
}
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = document.getElementById('password').value;
  const errEl = document.getElementById('login-error');
  errEl.hidden = true;
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ password }) });
    showApp();
  } catch (err) {
    errEl.hidden = false;
  }
});
document.getElementById('logout-btn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  state.siteId = null; state.site = null;
  showLogin();
});

// ---------- Site management ----------
async function loadSites() {
  state.sites = await api('/api/sites');
  const select = document.getElementById('site-select');
  select.innerHTML = state.sites.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  if (state.sites.length === 0) {
    document.getElementById('tab-content').innerHTML = '<div class="card"><p>No sites yet. Click \u201c+ New Site\u201d to create your first one.</p></div>';
    return;
  }
  const toSelect = state.siteId && state.sites.some((s) => s.id === state.siteId) ? state.siteId : state.sites[0].id;
  select.value = toSelect;
  await loadSite(toSelect);
}
async function loadSite(id) {
  state.siteId = id;
  document.getElementById('site-select').value = id;
  state.site = await api(`/api/sites/${id}`);
  renderActiveTab();
}
document.getElementById('site-select').addEventListener('change', (e) => loadSite(e.target.value));

document.getElementById('new-site-btn').addEventListener('click', async () => {
  const name = prompt('Name this site (e.g. "Hospital Kuala Lumpur", "Site 2 - Penang"):', `Site ${state.sites.length + 1}`);
  if (!name || !name.trim()) return;
  const site = await api('/api/sites', { method: 'POST', body: JSON.stringify({ name: name.trim(), data: DEFAULT_SITE_DATA }) });
  await loadSites();
  await loadSite(site.id);
});
document.getElementById('rename-site-btn').addEventListener('click', async () => {
  if (!state.site) return;
  const name = prompt('Rename this site:', state.site.name);
  if (!name || !name.trim() || name.trim() === state.site.name) return;
  await api(`/api/sites/${state.siteId}`, { method: 'PUT', body: JSON.stringify({ name: name.trim() }) });
  await loadSites();
});
document.getElementById('delete-site-btn').addEventListener('click', async () => {
  if (!state.site) return;
  if (!confirm(`Delete "${state.site.name}"? This cannot be undone.`)) return;
  await api(`/api/sites/${state.siteId}`, { method: 'DELETE' });
  state.siteId = null;
  await loadSites();
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Save (debounced) ----------
function scheduleSave() {
  const statusEl = document.getElementById('save-status');
  statusEl.textContent = 'Saving\u2026';
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(async () => {
    try {
      await api(`/api/sites/${state.siteId}`, { method: 'PUT', body: JSON.stringify({ data: state.site.data }) });
      statusEl.textContent = 'All changes saved';
      setTimeout(() => { if (statusEl.textContent === 'All changes saved') statusEl.textContent = ''; }, 2000);
    } catch (err) {
      statusEl.textContent = 'Save failed \u2014 retrying\u2026';
      scheduleSave();
    }
  }, 700);
}

// ---------- Tabs ----------
document.getElementById('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  state.activeTab = btn.dataset.tab;
  renderActiveTab();
});

function renderActiveTab() {
  const container = document.getElementById('tab-content');
  if (!state.site) { container.innerHTML = ''; return; }
  const renderers = {
    tenderSpec: renderTenderSpec, calculator: renderCalculator,
    supportingInfo: renderSupportingInfo, discussion: renderDiscussion,
  };
  container.innerHTML = '';
  renderers[state.activeTab](container, state.site.data);
}

// The Calculator tab has its own sub-navigation across all 8 cost sections.
const CALC_SECTIONS = [
  { key: 'batchSetup', label: 'Batch Setup', render: renderBatchSetup },
  { key: 'lcGradient', label: 'LC Gradient', render: renderGradient },
  { key: 'calibratorPrep', label: 'Calibrator & QC Prep', render: renderCalibratorPrep },
  { key: 'reagents', label: 'Reagents', render: renderReagents },
  { key: 'column', label: 'Column', render: renderColumn },
  { key: 'solvents', label: 'Solvents & Acid', render: renderSolvents },
  { key: 'summary', label: 'Summary', render: renderSummary },
  { key: 'freightTax', label: 'Freight & Tax', render: renderFreightTax },
];
function renderCalculator(container, data) {
  container.innerHTML = `
    <nav class="subtabs" id="calc-subtabs">
      ${CALC_SECTIONS.map((s) => `<button type="button" data-calcsection="${s.key}" class="subtab-btn ${state.activeCalcSection === s.key ? 'active' : ''}">${s.label}</button>`).join('')}
    </nav>
    <div id="calc-section-content"></div>`;
  renderCalcSection(data);
}
function renderCalcSection(data) {
  const sectionContainer = document.getElementById('calc-section-content');
  if (!sectionContainer) return;
  const section = CALC_SECTIONS.find((s) => s.key === state.activeCalcSection) || CALC_SECTIONS[0];
  section.render(sectionContainer, data);
  refreshComputed();
}

// Delegated input handler: updates the model, recomputes, saves — never rebuilds DOM.
function handleFieldChange(e) {
  const el = e.target;
  if (!el.dataset.path) return;
  let value = el.value;
  if (el.dataset.type === 'number') value = value === '' ? 0 : parseFloat(value);
  if (el.dataset.type === 'pct') value = value === '' ? 0 : parseFloat(value) / 100;
  if (el.dataset.type === 'bool') value = value === 'true';
  setPath(state.site.data, el.dataset.path, value);
  refreshComputed();
  scheduleSave();
}
document.getElementById('tab-content').addEventListener('input', handleFieldChange);
document.getElementById('tab-content').addEventListener('change', (e) => {
  if (e.target.tagName === 'SELECT') handleFieldChange(e);
});

// Delegated click handler for calculator sub-tabs and dynamic list rows (add/remove
// general solvents, freight items, links)
document.getElementById('tab-content').addEventListener('click', (e) => {
  const subtabBtn = e.target.closest('.subtab-btn');
  if (subtabBtn) {
    state.activeCalcSection = subtabBtn.dataset.calcsection;
    document.querySelectorAll('.subtab-btn').forEach((b) => b.classList.remove('active'));
    subtabBtn.classList.add('active');
    renderCalcSection(state.site.data);
    return;
  }
  const addSolvent = e.target.closest('#add-general-solvent-btn');
  if (addSolvent) {
    state.site.data.solvents.generalSolvents = state.site.data.solvents.generalSolvents || [];
    state.site.data.solvents.generalSolvents.push({ name: '', qty: 0, costPerUnit: 0 });
    renderActiveTab();
    scheduleSave();
    return;
  }
  const removeSolvent = e.target.closest('[data-remove-general-solvent]');
  if (removeSolvent) {
    const i = parseInt(removeSolvent.dataset.removeGeneralSolvent, 10);
    state.site.data.solvents.generalSolvents.splice(i, 1);
    renderActiveTab();
    scheduleSave();
    return;
  }
  const addFreight = e.target.closest('#add-freight-btn');
  if (addFreight) {
    state.site.data.freightTax = state.site.data.freightTax || { freightItems: [], taxRate: 0, applyTaxToFreight: true };
    state.site.data.freightTax.freightItems = state.site.data.freightTax.freightItems || [];
    state.site.data.freightTax.freightItems.push({ description: '', amount: 0 });
    renderActiveTab();
    scheduleSave();
    return;
  }
  const removeFreight = e.target.closest('[data-remove-freight]');
  if (removeFreight) {
    const i = parseInt(removeFreight.dataset.removeFreight, 10);
    state.site.data.freightTax.freightItems.splice(i, 1);
    renderActiveTab();
    scheduleSave();
    return;
  }
  const addLink = e.target.closest('[data-add-link]');
  if (addLink) {
    const linksPath = addLink.dataset.addLink; // e.g. "tenderSpec.links" or "supportingInfo.links"
    let links = getPath(state.site.data, linksPath);
    if (!links) { links = []; setPath(state.site.data, linksPath, links); }
    links.push({ label: '', url: '' });
    renderActiveTab();
    scheduleSave();
    return;
  }
  const removeLink = e.target.closest('[data-remove-link]');
  if (removeLink) {
    const linksPath = removeLink.dataset.linksPath;
    const i = parseInt(removeLink.dataset.removeLink, 10);
    getPath(state.site.data, linksPath).splice(i, 1);
    renderActiveTab();
    scheduleSave();
    return;
  }
});

function refreshComputed() {
  const computed = computeAll(state.site.data);
  document.querySelectorAll('[data-out]').forEach((el) => {
    const val = el.dataset.out === '__batches' ? state.site.data.batchSetup.batches : getPath(computed, el.dataset.out);
    el.textContent = fmt(val, el.dataset.fmt);
    if (el.dataset.warnNegative && val < 0) el.classList.add('warn'); else el.classList.remove('warn');
  });
  const wellsCell = document.getElementById('wellsRemainingCell');
  if (wellsCell) {
    const negative = computed.batchCalc.wellsRemaining < 0;
    wellsCell.style.background = negative ? '#ffc7ce' : '';
    wellsCell.style.color = negative ? '#9c0006' : '';
    wellsCell.style.fontWeight = negative ? 'bold' : '';
  }
  renderSummaryChartIfActive(computed);
  return computed;
}

// ---------- Batch Setup ----------
function renderBatchSetup(container, data) {
  const bs = data.batchSetup;
  container.innerHTML = `
    <div class="card">
      <h2>Batch &amp; Sample Design</h2>
      ${inputRow('Number of batches to run', 'batchSetup.batches', bs.batches, 'How many analytical batches/runs you are costing out')}
      ${inputRow('Study (patient) samples per batch', 'batchSetup.samplesPerBatch', bs.samplesPerBatch, 'Excludes calibrators, QCs & blanks')}
      ${inputRow('Calibrator levels per batch', 'batchSetup.calLevels', bs.calLevels, 'e.g. P1\u2013P8 = 8 levels')}
      ${inputRow('Calibrator replicates per level', 'batchSetup.calReps', bs.calReps, '')}
      ${inputRow('QC levels per batch', 'batchSetup.qcLevels', bs.qcLevels, 'e.g. QC1 & QC2 = 2 levels')}
      ${inputRow('QC replicates per level', 'batchSetup.qcReps', bs.qcReps, '')}
      ${inputRow('Blanks per batch (spiked with IS)', 'batchSetup.blanksPerBatch', bs.blanksPerBatch, 'Set 0 if your SOP does not run a blank')}
    </div>
    <div class="card">
      <h2>Calculated Values</h2>
      ${outRow('Total calibrators per batch', 'batchCalc.totalCalPerBatch', 'int')}
      ${outRow('Total QCs per batch', 'batchCalc.totalQCPerBatch', 'int')}
      ${outRow('Total samples run per batch (study + cal + QC + blanks)', 'batchCalc.totalSamplesRunPerBatch', 'int')}
      ${outRow('Total wells used per batch (96-well plate)', 'batchCalc.totalWellsUsedPerBatch', 'int', 'wellsUsedCell')}
      ${outRow('Wells remaining on 96-well plate', 'batchCalc.wellsRemaining', 'int', 'wellsRemainingCell')}
      ${outRow('Total samples run \u2014 all batches', 'batchCalc.totalSamplesRunAllBatches', 'int')}
      ${outRow('Total study samples \u2014 all batches', 'batchCalc.totalStudySamplesAllBatches', 'int')}
      ${outRow('Total calibrators \u2014 all batches', 'batchCalc.totalCalAllBatches', 'int')}
      ${outRow('Total QCs \u2014 all batches', 'batchCalc.totalQCAllBatches', 'int')}
      ${outRow('Total blanks \u2014 all batches', 'batchCalc.totalBlanksAllBatches', 'int')}
    </div>`;
}
function inputRow(label, path, value, hint) {
  return `<div class="field-row"><label>${label}</label>
    <input type="number" step="any" data-path="${path}" data-type="number" value="${value ?? ''}" />
    ${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
}
function outRow(label, outPath, fmtKind, id) {
  return `<div class="field-row"><label>${label}</label>
    <span ${id ? `id="${id}"` : ''} data-out="${outPath}" data-fmt="${fmtKind}" style="font-weight:600;min-width:100px;text-align:right;">\u2014</span></div>`;
}

// ---------- LC Gradient ----------
function renderGradient(container, data) {
  const rows = data.lcGradient;
  container.innerHTML = `
    <div class="card">
      <h2>LC Gradient Method</h2>
      <table class="calc-table">
        <thead><tr><th>No</th><th>Time (min)</th><th>Flow (mL/min)</th><th>%A</th><th>%B</th><th>Shape</th></tr></thead>
        <tbody>
          ${rows.map((r, i) => `<tr>
            <td>${r.no}</td>
            <td><input type="number" step="any" data-path="lcGradient.${i}.time" data-type="number" value="${r.time}" /></td>
            <td><input type="number" step="any" data-path="lcGradient.${i}.flow" data-type="number" value="${r.flow}" /></td>
            <td><input type="number" step="any" data-path="lcGradient.${i}.a" data-type="number" value="${r.a}" /></td>
            <td><input type="number" step="any" data-path="lcGradient.${i}.b" data-type="number" value="${r.b}" /></td>
            <td><input type="text" data-path="lcGradient.${i}.shape" value="${escapeHtml(r.shape)}" /></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="card">
      <h2>Segment-by-Segment Volume (trapezoidal integration)</h2>
      <table class="calc-table">
        <thead><tr><th>Segment</th><th>From (min)</th><th>To (min)</th><th>\u0394t</th><th>Avg Flow</th><th>Avg %A</th><th>Avg %B</th><th>Seg. Volume (mL)</th><th>Seg. Vol A (mL)</th><th>Seg. Vol B (mL)</th></tr></thead>
        <tbody>
          ${rows.slice(0, -1).map((_, i) => `<tr>
            <td>${i + 1}</td>
            <td class="computed" data-out="gradientCalc.segments.${i}.from" data-fmt="num2">\u2014</td>
            <td class="computed" data-out="gradientCalc.segments.${i}.to" data-fmt="num2">\u2014</td>
            <td class="computed" data-out="gradientCalc.segments.${i}.dt" data-fmt="num2">\u2014</td>
            <td class="computed" data-out="gradientCalc.segments.${i}.avgFlow" data-fmt="num2">\u2014</td>
            <td class="computed" data-out="gradientCalc.segments.${i}.avgA" data-fmt="num2">\u2014</td>
            <td class="computed" data-out="gradientCalc.segments.${i}.avgB" data-fmt="num2">\u2014</td>
            <td class="computed" data-out="gradientCalc.segments.${i}.segVol" data-fmt="num2">\u2014</td>
            <td class="computed" data-out="gradientCalc.segments.${i}.segVolA" data-fmt="num2">\u2014</td>
            <td class="computed" data-out="gradientCalc.segments.${i}.segVolB" data-fmt="num2">\u2014</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div class="two-col">
        <div>${outRow('Mobile Phase A volume per sample (mL) \u2014 assumed Water', 'gradientCalc.volA', 'num2')}</div>
        <div>${outRow('Mobile Phase B volume per sample (mL) \u2014 assumed ACN', 'gradientCalc.volB', 'num2')}</div>
      </div>
      ${outRow('Total mobile phase volume per sample (mL)', 'gradientCalc.totalVol', 'num2')}
      <p class="note">Assumes flow is constant or ramps linearly between timepoints. Mobile Phase A = Water, Mobile Phase B = ACN (standard reversed-phase convention: run starts mostly aqueous, ramps toward organic). These volumes feed directly into the Solvents &amp; Acid tab.</p>
    </div>`;
}

// ---------- Calibrator & QC Prep ----------
function renderCalibratorPrep(container, data) {
  const cp = data.calibratorPrep;
  container.innerHTML = `
    <div class="card">
      <h2>Standard Stock Serial Dilution (prepared once per batch)</h2>
      <table class="calc-table">
        <thead><tr><th>Level</th><th>Concentration (\u00b5M)</th><th>Volume taken from previous (\u00b5L)</th><th>Methanol added (\u00b5L)</th><th>Resulting volume (\u00b5L)</th></tr></thead>
        <tbody>
          ${cp.stockDilution.map((r, i) => `<tr>
            <td class="label-cell">${r.level}</td>
            <td><input type="number" step="any" data-path="calibratorPrep.stockDilution.${i}.conc" data-type="number" value="${r.conc}" /></td>
            <td>${r.vol === null ? '<span class="na">\u2014</span>' : `<input type="number" step="any" data-path="calibratorPrep.stockDilution.${i}.vol" data-type="number" value="${r.vol}" />`}</td>
            <td>${r.meoh === null ? '<span class="na">\u2014</span>' : `<input type="number" step="any" data-path="calibratorPrep.stockDilution.${i}.meoh" data-type="number" value="${r.meoh}" />`}</td>
            <td class="computed">${r.vol === null ? '<span class="na">\u2014</span>' : (r.vol + (r.meoh || 0))}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="card">
      <h2>Standard Working Preparation (calibrators, per batch)</h2>
      <table class="calc-table">
        <thead><tr><th>Level</th><th>Source</th><th>Volume from stock (\u00b5L)</th><th>IS solution (\u00b5L)</th></tr></thead>
        <tbody>
          ${cp.workingPrep.map((r, i) => `<tr>
            <td class="label-cell">${r.level}</td>
            <td>${r.source}</td>
            <td><input type="number" step="any" data-path="calibratorPrep.workingPrep.${i}.vol" data-type="number" value="${r.vol}" /></td>
            <td><input type="number" step="any" data-path="calibratorPrep.workingPrep.${i}.isVol" data-type="number" value="${r.isVol}" /></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="card">
      <h2>QC Preparation (per batch) \u2014 reference only; costed on the Reagents tab</h2>
      <table class="calc-table">
        <thead><tr><th>QC Level</th><th>Volume (\u00b5L)</th><th>IS solution (\u00b5L)</th></tr></thead>
        <tbody>
          ${cp.qcPrep.map((r, i) => `<tr>
            <td class="label-cell">${r.level}</td>
            <td><input type="number" step="any" data-path="calibratorPrep.qcPrep.${i}.vol" data-type="number" value="${r.vol}" /></td>
            <td><input type="number" step="any" data-path="calibratorPrep.qcPrep.${i}.isVol" data-type="number" value="${r.isVol}" /></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="card">
      <h2>Derived Totals (per batch)</h2>
      ${outRow('Total methanol used for stock dilution (\u00b5L/batch)', 'calPrepCalc.totalMethanolPerBatchUL', 'int')}
      ${outRow('Total raw Amino Acid Standard (S1) needed (\u00b5L/batch)', 'calPrepCalc.totalStdPerBatchUL', 'int')}
      ${outRow('Total IS solution for calibrators (\u00b5L/batch) \u2014 cross-check', 'calPrepCalc.totalISForCalPerBatch', 'int')}
    </div>
    <div class="card">
      <h2>Cost of Calibration Consumables</h2>
      <table class="calc-table">
        <thead><tr><th>Material</th><th>Vial/bottle size (\u00b5L)</th><th>Dead/waste vol. (\u00b5L)</th><th>Usable volume</th><th>Units needed</th><th>Cost per unit ($)</th><th>Total cost ($)</th><th>Cost/batch ($)</th></tr></thead>
        <tbody>
          <tr>
            <td class="label-cell">Amino Acid Standard (raw stock, \u00b5L)</td>
            <td><input type="number" step="any" data-path="calibratorPrep.standard.vialSize" data-type="number" value="${cp.standard.vialSize}" /></td>
            <td><input type="number" step="any" data-path="calibratorPrep.standard.dead" data-type="number" value="${cp.standard.dead}" /></td>
            <td class="computed" data-out="calPrepCalc.stdUsable" data-fmt="int">\u2014</td>
            <td class="computed" data-out="calPrepCalc.stdVialsNeeded" data-fmt="int">\u2014</td>
            <td><input type="number" step="any" data-path="calibratorPrep.standard.costPerVial" data-type="number" value="${cp.standard.costPerVial}" /></td>
            <td class="computed" data-out="calPrepCalc.stdTotalCost" data-fmt="cur">\u2014</td>
            <td class="computed" data-out="calPrepCalc.stdTotalCost" data-fmt="cur">\u2014</td>
          </tr>
          <tr class="total-row"><td colspan="6">TOTAL</td><td colspan="2" class="computed" data-out="calPrepCalc.calPrepTotalCost" data-fmt="cur">\u2014</td></tr>
        </tbody>
      </table>
      <p class="note">One serial dilution series is prepared per batch and supplies all calibrator levels \u2014 raw standard is consumed only where actually drawn (to make S2, plus directly for P1), not per calibration level. The methanol used to build this dilution series is costed on the Solvents &amp; Acid tab instead (it's a solvent, not a standard) \u2014 the per-batch volume calculated above still feeds that tab automatically.</p>
    </div>`;
}

// ---------- Reagents ----------
function renderReagents(container, data) {
  const r = data.reagents;
  container.innerHTML = `
    <div class="card">
      <h2>Reagent Cost Build-Up \u2014 Internal Standard &amp; QC Material</h2>
      <table class="calc-table">
        <thead><tr><th>Component</th><th>Vol/use (\u00b5L)</th><th>Uses/batch</th><th>Vial size (\u00b5L)</th><th>Dead vol. (\u00b5L)</th><th>Usable vol.</th><th>Vials needed</th><th>Cost/vial ($)</th><th>Total cost ($)</th><th>Cost/sample ($)</th></tr></thead>
        <tbody>
          <tr>
            <td class="label-cell">Internal Standard (IS)</td>
            <td><input type="number" step="any" data-path="reagents.is.volPerUse" data-type="number" value="${r.is.volPerUse}" /></td>
            <td class="linked" data-out="batchCalc.totalSamplesRunPerBatch" data-fmt="int">\u2014</td>
            <td><input type="number" step="any" data-path="reagents.is.vialSize" data-type="number" value="${r.is.vialSize}" /></td>
            <td><input type="number" step="any" data-path="reagents.is.dead" data-type="number" value="${r.is.dead}" /></td>
            <td class="computed" data-out="reagentsCalc.is.usableVol" data-fmt="int">\u2014</td>
            <td class="computed" data-out="reagentsCalc.is.vialsNeeded" data-fmt="int">\u2014</td>
            <td><input type="number" step="any" data-path="reagents.is.costPerVial" data-type="number" value="${r.is.costPerVial}" /></td>
            <td class="computed" data-out="reagentsCalc.is.totalCost" data-fmt="cur">\u2014</td>
            <td class="computed" data-out="reagentsCalc.is.costPerSample" data-fmt="cur">\u2014</td>
          </tr>
          <tr>
            <td class="label-cell">Quality Control (QC) material</td>
            <td><input type="number" step="any" data-path="reagents.qc.volPerUse" data-type="number" value="${r.qc.volPerUse}" /></td>
            <td class="linked" data-out="batchCalc.totalQCPerBatch" data-fmt="int">\u2014</td>
            <td><input type="number" step="any" data-path="reagents.qc.vialSize" data-type="number" value="${r.qc.vialSize}" /></td>
            <td><input type="number" step="any" data-path="reagents.qc.dead" data-type="number" value="${r.qc.dead}" /></td>
            <td class="computed" data-out="reagentsCalc.qc.usableVol" data-fmt="int">\u2014</td>
            <td class="computed" data-out="reagentsCalc.qc.vialsNeeded" data-fmt="int">\u2014</td>
            <td><input type="number" step="any" data-path="reagents.qc.costPerVial" data-type="number" value="${r.qc.costPerVial}" /></td>
            <td class="computed" data-out="reagentsCalc.qc.totalCost" data-fmt="cur">\u2014</td>
            <td class="computed" data-out="reagentsCalc.qc.costPerSample" data-fmt="cur">\u2014</td>
          </tr>
          <tr class="total-row"><td colspan="8">TOTAL</td><td colspan="2" class="computed" data-out="reagentsCalc.totalCost" data-fmt="cur">\u2014</td></tr>
        </tbody>
      </table>
      <p class="note">IS is added uniformly to every calibrator, QC, patient sample, and blank. QC material is used only for QC preparations. The Calibrator standard itself is costed on the Calibrator &amp; QC Prep tab (serial dilution, not 1:1 per level).</p>
    </div>`;
}

// ---------- Column ----------
function renderColumn(container, data) {
  const c = data.column;
  container.innerHTML = `
    <div class="card">
      <h2>Analytical Column &amp; Guard Column Cost</h2>
      <table class="calc-table">
        <thead><tr><th>Component</th><th>Cost/unit ($)</th><th>Rated lifetime (samples)</th><th>Total samples needed</th><th>Units needed</th><th>Total cost ($)</th><th>Cost/sample ($)</th></tr></thead>
        <tbody>
          <tr>
            <td class="label-cell"><input type="text" data-path="column.analytical.label" value="${escapeHtml(c.analytical.label)}" style="text-align:left;width:100%;" /></td>
            <td><input type="number" step="any" data-path="column.analytical.cost" data-type="number" value="${c.analytical.cost}" /></td>
            <td><input type="number" step="any" data-path="column.analytical.lifetime" data-type="number" value="${c.analytical.lifetime}" /></td>
            <td class="linked" data-out="batchCalc.totalSamplesRunAllBatches" data-fmt="int">\u2014</td>
            <td class="computed" data-out="columnCalc.analytical.unitsNeeded" data-fmt="int">\u2014</td>
            <td class="computed" data-out="columnCalc.analytical.totalCost" data-fmt="cur">\u2014</td>
            <td class="computed" data-out="columnCalc.analytical.costPerSample" data-fmt="cur">\u2014</td>
          </tr>
          <tr>
            <td class="label-cell"><input type="text" data-path="column.guard.label" value="${escapeHtml(c.guard.label)}" style="text-align:left;width:100%;" /></td>
            <td><input type="number" step="any" data-path="column.guard.cost" data-type="number" value="${c.guard.cost}" /></td>
            <td><input type="number" step="any" data-path="column.guard.lifetime" data-type="number" value="${c.guard.lifetime}" /></td>
            <td class="linked" data-out="batchCalc.totalSamplesRunAllBatches" data-fmt="int">\u2014</td>
            <td class="computed" data-out="columnCalc.guard.unitsNeeded" data-fmt="int">\u2014</td>
            <td class="computed" data-out="columnCalc.guard.totalCost" data-fmt="cur">\u2014</td>
            <td class="computed" data-out="columnCalc.guard.costPerSample" data-fmt="cur">\u2014</td>
          </tr>
          <tr class="total-row"><td colspan="5">TOTAL</td><td colspan="2" class="computed" data-out="columnCalc.totalCost" data-fmt="cur">\u2014</td></tr>
        </tbody>
      </table>
      <p class="note">Column and guard column life is consumed by every sample run (study samples + calibrators + QCs + blanks).</p>
    </div>`;
}

// ---------- Solvents & Acid ----------
function renderSolvents(container, data) {
  const s = data.solvents;
  s.calibratorMethanol = s.calibratorMethanol || { bottleSize: 4000, dead: 30, costPerBottle: 45 };
  s.generalSolvents = s.generalSolvents || [];
  container.innerHTML = `
    <div class="card">
      <h2>Mobile Phase Solvents &amp; Acid Modifier Cost</h2>
      <div class="legend-box">
        PFHeptA/TDHFA concentration added to EACH mobile phase (aqueous &amp; organic), % v/v:
        <input type="number" step="any" style="width:70px" data-path="solvents.pfheptaConc" data-type="pct" value="${(s.pfheptaConc * 100).toFixed(3)}" /> %
      </div>
      <table class="calc-table">
        <thead><tr><th>Component</th><th>Vol/sample (mL)</th><th>Total samples</th><th>Vol required (mL)</th><th>Bottle size (mL)</th><th>Dead vol. (mL)</th><th>Usable vol.</th><th>Bottles needed</th><th>Cost/bottle ($)</th><th>Total cost ($)</th><th>Cost/sample ($)</th></tr></thead>
        <tbody>
          <tr>
            <td class="label-cell">Water (Mobile Phase A2)</td>
            <td class="linked" data-out="gradientCalc.volA" data-fmt="num2">\u2014</td>
            <td class="linked" data-out="batchCalc.totalSamplesRunAllBatches" data-fmt="int">\u2014</td>
            <td class="computed" data-out="solventsCalc.water.volRequired" data-fmt="num2">\u2014</td>
            <td><input type="number" step="any" data-path="solvents.water.bottleSize" data-type="number" value="${s.water.bottleSize}" /></td>
            <td><input type="number" step="any" data-path="solvents.water.dead" data-type="number" value="${s.water.dead}" /></td>
            <td class="computed" data-out="solventsCalc.water.usable" data-fmt="num2">\u2014</td>
            <td class="computed" data-out="solventsCalc.water.bottlesNeeded" data-fmt="int">\u2014</td>
            <td><input type="number" step="any" data-path="solvents.water.costPerBottle" data-type="number" value="${s.water.costPerBottle}" /></td>
            <td class="computed" data-out="solventsCalc.water.totalCost" data-fmt="cur">\u2014</td>
            <td class="computed" data-out="solventsCalc.water.costPerSample" data-fmt="cur">\u2014</td>
          </tr>
          <tr>
            <td class="label-cell">Acetonitrile (ACN, Mobile Phase B2)</td>
            <td class="linked" data-out="gradientCalc.volB" data-fmt="num2">\u2014</td>
            <td class="linked" data-out="batchCalc.totalSamplesRunAllBatches" data-fmt="int">\u2014</td>
            <td class="computed" data-out="solventsCalc.acn.volRequired" data-fmt="num2">\u2014</td>
            <td><input type="number" step="any" data-path="solvents.acn.bottleSize" data-type="number" value="${s.acn.bottleSize}" /></td>
            <td><input type="number" step="any" data-path="solvents.acn.dead" data-type="number" value="${s.acn.dead}" /></td>
            <td class="computed" data-out="solventsCalc.acn.usable" data-fmt="num2">\u2014</td>
            <td class="computed" data-out="solventsCalc.acn.bottlesNeeded" data-fmt="int">\u2014</td>
            <td><input type="number" step="any" data-path="solvents.acn.costPerBottle" data-type="number" value="${s.acn.costPerBottle}" /></td>
            <td class="computed" data-out="solventsCalc.acn.totalCost" data-fmt="cur">\u2014</td>
            <td class="computed" data-out="solventsCalc.acn.costPerSample" data-fmt="cur">\u2014</td>
          </tr>
          <tr>
            <td class="label-cell">Perfluoroheptanoic acid (PFHeptA/TDHFA)</td>
            <td class="computed" data-out="solventsCalc.pfhepta.volPerSample" data-fmt="num2">\u2014</td>
            <td class="linked" data-out="batchCalc.totalSamplesRunAllBatches" data-fmt="int">\u2014</td>
            <td class="computed" data-out="solventsCalc.pfhepta.volRequired" data-fmt="num2">\u2014</td>
            <td><input type="number" step="any" data-path="solvents.pfhepta.bottleSize" data-type="number" value="${s.pfhepta.bottleSize}" /></td>
            <td><input type="number" step="any" data-path="solvents.pfhepta.dead" data-type="number" value="${s.pfhepta.dead}" /></td>
            <td class="computed" data-out="solventsCalc.pfhepta.usable" data-fmt="num2">\u2014</td>
            <td class="computed" data-out="solventsCalc.pfhepta.bottlesNeeded" data-fmt="int">\u2014</td>
            <td><input type="number" step="any" data-path="solvents.pfhepta.costPerBottle" data-type="number" value="${s.pfhepta.costPerBottle}" /></td>
            <td class="computed" data-out="solventsCalc.pfhepta.totalCost" data-fmt="cur">\u2014</td>
            <td class="computed" data-out="solventsCalc.pfhepta.costPerSample" data-fmt="cur">\u2014</td>
          </tr>
          <tr class="total-row"><td colspan="9">TOTAL (mobile phase)</td><td colspan="2" class="computed" data-out="solventsCalc.mobilePhaseTotal" data-fmt="cur">\u2014</td></tr>
        </tbody>
      </table>
      <p class="note">Water and ACN volumes are linked live from the LC Gradient tab. PFHeptA/TDHFA volume is derived automatically from the % v/v set above times the combined Water+ACN volume.</p>
    </div>

    <div class="card">
      <h2>Calibrator Dilution Methanol <span style="font-weight:normal;font-size:12px;">(per-batch consumable, linked from Calibrator &amp; QC Prep tab)</span></h2>
      <table class="calc-table">
        <thead><tr><th>Component</th><th>Vol/batch (mL)</th><th>Batches</th><th>Vol required (mL)</th><th>Bottle size (mL)</th><th>Dead vol. (mL)</th><th>Usable vol.</th><th>Bottles needed</th><th>Cost/bottle ($)</th><th>Total cost ($)</th><th>Cost/batch ($)</th></tr></thead>
        <tbody>
          <tr>
            <td class="label-cell">Methanol (calibrator serial dilution diluent)</td>
            <td class="linked" data-out="solventsCalc.calibratorMethanol.volPerBatchML" data-fmt="num2">\u2014</td>
            <td class="linked" data-out="__batches" data-fmt="int">\u2014</td>
            <td class="computed" data-out="solventsCalc.calibratorMethanol.totalVolML" data-fmt="num2">\u2014</td>
            <td><input type="number" step="any" data-path="solvents.calibratorMethanol.bottleSize" data-type="number" value="${s.calibratorMethanol.bottleSize}" /></td>
            <td><input type="number" step="any" data-path="solvents.calibratorMethanol.dead" data-type="number" value="${s.calibratorMethanol.dead}" /></td>
            <td class="computed" data-out="solventsCalc.calibratorMethanol.usable" data-fmt="num2">\u2014</td>
            <td class="computed" data-out="solventsCalc.calibratorMethanol.bottlesNeeded" data-fmt="int">\u2014</td>
            <td><input type="number" step="any" data-path="solvents.calibratorMethanol.costPerBottle" data-type="number" value="${s.calibratorMethanol.costPerBottle}" /></td>
            <td class="computed" data-out="solventsCalc.calibratorMethanol.totalCost" data-fmt="cur">\u2014</td>
            <td class="computed" data-out="solventsCalc.calibratorMethanol.costPerBatch" data-fmt="cur">\u2014</td>
          </tr>
        </tbody>
      </table>
      <p class="note">This volume is tiny (a few hundred mL across a whole project) \u2014 it's the diluent used only to build the calibration curve's serial dilution series, not general lab methanol.</p>
    </div>

    <div class="card">
      <h2>General Lab &amp; Maintenance Solvents <span style="font-weight:normal;font-size:12px;">(enter bottles/units directly, not formula-driven)</span></h2>
      <table class="calc-table">
        <thead><tr><th>Component</th><th>Bottles/units needed</th><th>Cost per bottle/unit ($)</th><th>Total cost ($)</th><th></th></tr></thead>
        <tbody id="general-solvents-tbody">
          ${(s.generalSolvents || []).map((g, i) => `<tr>
            <td class="label-cell"><input type="text" data-path="solvents.generalSolvents.${i}.name" value="${escapeHtml(g.name)}" style="text-align:left;width:100%;" /></td>
            <td><input type="number" step="any" data-path="solvents.generalSolvents.${i}.qty" data-type="number" value="${g.qty}" /></td>
            <td><input type="number" step="any" data-path="solvents.generalSolvents.${i}.costPerUnit" data-type="number" value="${g.costPerUnit}" /></td>
            <td class="computed" data-out="solventsCalc.generalSolvents.${i}.totalCost" data-fmt="cur">\u2014</td>
            <td><button type="button" class="btn-remove-row" data-remove-general-solvent="${i}" title="Remove">\u2715</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
      <button type="button" id="add-general-solvent-btn" class="btn-add-row">+ Add solvent</button>
      <div class="field-row" style="margin-top:10px;"><label>General lab solvents subtotal</label>
        <span data-out="solventsCalc.generalSolventsTotal" data-fmt="cur" style="font-weight:600;min-width:100px;text-align:right;">\u2014</span></div>
      <p class="note">Add rows for anything else general-purpose (hexane, ethyl acetate, etc.) \u2014 just estimate bottles/units needed for the whole project. Not tied to sample count since usage varies by maintenance schedule.</p>
    </div>
    <div class="card">
      <div class="field-row"><label style="font-weight:700;">SOLVENTS &amp; ACID TAB TOTAL</label>
        <span data-out="solventsCalc.totalCost" data-fmt="cur" style="font-weight:700;font-size:16px;color:var(--navy);min-width:100px;text-align:right;">\u2014</span></div>
    </div>`;
}

// ---------- Summary ----------
let lastComputedForChart = null;
function renderSummary(container) {
  container.innerHTML = `
    <div class="summary-grid">
      <div class="summary-box"><div class="label">Reagents (IS, QC)</div><div class="amount" data-out="summary.reagentsTotal" data-fmt="cur">\u2014</div></div>
      <div class="summary-box"><div class="label">Calibrator &amp; QC Prep</div><div class="amount" data-out="summary.calPrepTotal" data-fmt="cur">\u2014</div></div>
      <div class="summary-box"><div class="label">Column &amp; Guard</div><div class="amount" data-out="summary.columnTotal" data-fmt="cur">\u2014</div></div>
      <div class="summary-box"><div class="label">Solvents &amp; Acid</div><div class="amount" data-out="summary.solventsTotal" data-fmt="cur">\u2014</div></div>
      <div class="summary-box grand"><div class="label">SUBTOTAL (before freight &amp; tax)</div><div class="amount" data-out="summary.grandTotal" data-fmt="cur">\u2014</div></div>
    </div>
    <div class="card">
      <h2>Cost Breakdown</h2>
      <div id="summary-chart" class="chart-bar-wrap"></div>
    </div>
    <div class="summary-grid">
      <div class="summary-box"><div class="label">Total batches</div><div class="amount" data-out="__batches" data-fmt="int">\u2014</div></div>
      <div class="summary-box"><div class="label">Total study samples (all batches)</div><div class="amount" data-out="batchCalc.totalStudySamplesAllBatches" data-fmt="int">\u2014</div></div>
      <div class="summary-box"><div class="label">Cost per batch</div><div class="amount" data-out="summary.costPerBatch" data-fmt="cur">\u2014</div></div>
      <div class="summary-box"><div class="label">Cost per study sample</div><div class="amount" data-out="summary.costPerStudySample" data-fmt="cur">\u2014</div></div>
    </div>
    <p class="note" style="padding:0 4px;">Instrument purchase/depreciation cost is excluded, per scope. See the Freight &amp; Tax tab for the final landed cost including shipping and tax.</p>`;
}
function renderSummaryChartIfActive(computed) {
  lastComputedForChart = computed;
  const chartEl = document.getElementById('summary-chart');
  if (!chartEl) return;
  const cats = [
    { label: 'Reagents', value: computed.summary.reagentsTotal },
    { label: 'Calibrator Prep', value: computed.summary.calPrepTotal },
    { label: 'Column', value: computed.summary.columnTotal },
    { label: 'Solvents', value: computed.summary.solventsTotal },
  ];
  const max = Math.max(...cats.map((c) => c.value), 1);
  chartEl.innerHTML = cats.map((c) => `
    <div class="chart-bar">
      <div class="bar-value">${fmt(c.value, 'cur')}</div>
      <div class="bar" style="height:${Math.max(4, (c.value / max) * 160)}px;"></div>
      <div class="bar-label">${c.label}</div>
    </div>`).join('');
}

// ---------- Freight & Tax ----------
function renderFreightTax(container, data) {
  data.freightTax = data.freightTax || { freightItems: [], taxRate: 0, applyTaxToFreight: true };
  const ft = data.freightTax;
  ft.freightItems = ft.freightItems || [];
  container.innerHTML = `
    <div class="card">
      <div class="field-row"><label>Subtotal (from Summary tab)</label>
        <span data-out="summary.grandTotal" data-fmt="cur" style="font-weight:600;min-width:100px;text-align:right;">\u2014</span></div>
    </div>
    <div class="card">
      <h2>Freight Charges <span style="font-weight:normal;font-size:12px;">(add a row whenever you get a quote \u2014 leave empty until then)</span></h2>
      <table class="calc-table">
        <thead><tr><th>Description</th><th>Amount ($)</th><th></th></tr></thead>
        <tbody id="freight-tbody">
          ${(ft.freightItems || []).map((f, i) => `<tr>
            <td class="label-cell"><input type="text" data-path="freightTax.freightItems.${i}.description" value="${escapeHtml(f.description)}" style="text-align:left;width:100%;" placeholder="e.g. International courier, customs clearance..." /></td>
            <td><input type="number" step="any" data-path="freightTax.freightItems.${i}.amount" data-type="number" value="${f.amount}" /></td>
            <td><button type="button" class="btn-remove-row" data-remove-freight="${i}" title="Remove">\u2715</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
      <button type="button" id="add-freight-btn" class="btn-add-row">+ Add freight charge</button>
      <div class="field-row" style="margin-top:10px;"><label>TOTAL FREIGHT</label>
        <span data-out="freightTaxCalc.freightTotal" data-fmt="cur" style="font-weight:600;min-width:100px;text-align:right;">\u2014</span></div>
      <p class="note">Freight is entirely optional \u2014 leave it empty until you have real quotes, and the final total will simply equal the subtotal plus tax.</p>
    </div>
    <div class="card">
      <h2>Tax</h2>
      <div class="field-row"><label>Tax rate (%)</label>
        <input type="number" step="any" style="width:100px" data-path="freightTax.taxRate" data-type="pct" value="${(ft.taxRate * 100).toFixed(2)}" />
        <span class="hint">e.g. Malaysia SST/GST \u2014 replace with the applicable rate</span></div>
      <div class="field-row"><label>Apply tax to freight too?</label>
        <select data-path="freightTax.applyTaxToFreight" data-type="bool" style="width:100px">
          <option value="true" ${ft.applyTaxToFreight ? 'selected' : ''}>Yes</option>
          <option value="false" ${!ft.applyTaxToFreight ? 'selected' : ''}>No</option>
        </select>
        <span class="hint">Many customs/import taxes are charged on goods value + freight (CIF)</span></div>
      <div class="field-row"><label>Taxable base ($)</label>
        <span data-out="freightTaxCalc.taxableBase" data-fmt="cur" style="font-weight:600;min-width:100px;text-align:right;">\u2014</span></div>
      <div class="field-row"><label>Tax amount ($)</label>
        <span data-out="freightTaxCalc.taxAmount" data-fmt="cur" style="font-weight:600;min-width:100px;text-align:right;">\u2014</span></div>
    </div>
    <div class="summary-grid">
      <div class="summary-box"><div class="label">Subtotal</div><div class="amount" data-out="summary.grandTotal" data-fmt="cur">\u2014</div></div>
      <div class="summary-box"><div class="label">Total Freight</div><div class="amount" data-out="freightTaxCalc.freightTotal" data-fmt="cur">\u2014</div></div>
      <div class="summary-box"><div class="label">Total Tax</div><div class="amount" data-out="freightTaxCalc.taxAmount" data-fmt="cur">\u2014</div></div>
      <div class="summary-box grand"><div class="label">FINAL TOTAL</div><div class="amount" data-out="freightTaxCalc.finalTotal" data-fmt="cur">\u2014</div></div>
    </div>
    <div class="card">
      <div class="field-row"><label>Final cost per batch ($)</label>
        <span data-out="freightTaxCalc.finalCostPerBatch" data-fmt="cur" style="font-weight:600;min-width:100px;text-align:right;">\u2014</span></div>
      <div class="field-row"><label>Final cost per study sample ($)</label>
        <span data-out="freightTaxCalc.finalCostPerSample" data-fmt="cur" style="font-weight:600;min-width:100px;text-align:right;">\u2014</span></div>
    </div>`;
}

// ---------- Generic file upload/list/delete (shared by Tender Spec, Images, Supporting Info) ----------
const MAX_FILE_MB = 20;
const IMAGE_ONLY_CATEGORIES = ['image', 'supporting_picture'];
async function initFileSection(key, category, { imageGrid }) {
  await loadFileList(key, category, imageGrid);
  const form = document.getElementById(`upload-form-${key}`);
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fileInput = form.querySelector('input[type="file"]');
    const statusEl = form.querySelector('.upload-status');
    if (!fileInput.files.length) return;
    const file = fileInput.files[0];
    if (file.size > MAX_FILE_MB * 1024 * 1024) { statusEl.textContent = `File is too large (max ${MAX_FILE_MB} MB).`; return; }
    if (IMAGE_ONLY_CATEGORIES.includes(category) && !file.type.startsWith('image/')) { statusEl.textContent = 'Only image files are allowed here.'; return; }
    statusEl.textContent = 'Uploading\u2026';
    const formData = new FormData();
    formData.append('category', category); // must be appended before 'file' for the server to see it in time
    formData.append('file', file);
    try {
      const res = await fetch(`/api/sites/${state.siteId}/files`, { method: 'POST', credentials: 'include', cache: 'no-store', body: formData });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Upload failed');
      fileInput.value = '';
      statusEl.textContent = '';
      await loadFileList(key, category, imageGrid);
    } catch (err) {
      statusEl.textContent = err.message;
    }
  });
}
async function loadFileList(key, category, imageGrid) {
  const listEl = document.getElementById(`file-list-${key}`);
  if (!listEl) return;
  try {
    const files = await api(`/api/sites/${state.siteId}/files?category=${encodeURIComponent(category)}`);
    if (files.length === 0) {
      listEl.innerHTML = '<p class="note">No files uploaded yet.</p>';
      return;
    }
    if (imageGrid) {
      listEl.innerHTML = files.map((f) => `
        <div class="image-tile">
          <img src="/api/sites/${state.siteId}/files/${f.id}" alt="${escapeHtml(f.filename)}" loading="lazy"
               data-lightbox-src="/api/sites/${state.siteId}/files/${f.id}" />
          <div class="image-tile-meta">
            <span title="${escapeHtml(f.filename)}">${escapeHtml(f.filename)}</span>
            <button type="button" class="btn-remove-row" data-delete-file="${f.id}" data-file-key="${key}" data-file-category="${category}" title="Delete">\u2715</button>
          </div>
        </div>`).join('');
    } else {
      listEl.innerHTML = files.map((f) => {
        const isImage = (f.mime_type || '').startsWith('image/');
        const thumb = isImage
          ? `<img src="/api/sites/${state.siteId}/files/${f.id}" alt="${escapeHtml(f.filename)}" class="inline-thumb" loading="lazy"
                  data-lightbox-src="/api/sites/${state.siteId}/files/${f.id}" />`
          : '';
        return `
        <div class="discussion-msg" style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
          <div style="display:flex;align-items:center;gap:10px;min-width:0;">
            ${thumb}
            <div style="min-width:0;">
              <a href="/api/sites/${state.siteId}/files/${f.id}" target="_blank" rel="noopener noreferrer">${escapeHtml(f.filename)}</a>
              <div class="meta">${(f.file_size / 1024).toFixed(0)} KB \u2014 uploaded ${new Date(f.uploaded_at).toLocaleString()}</div>
            </div>
          </div>
          <button type="button" class="btn-remove-row" data-delete-file="${f.id}" data-file-key="${key}" data-file-category="${category}" title="Delete">\u2715</button>
        </div>`;
      }).join('');
    }
    listEl.querySelectorAll('[data-delete-file]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this file?')) return;
        await api(`/api/sites/${state.siteId}/files/${btn.dataset.deleteFile}`, { method: 'DELETE' });
        await loadFileList(btn.dataset.fileKey, btn.dataset.fileCategory, imageGrid);
      });
    });
  } catch (err) {
    listEl.innerHTML = `<p class="note">Could not load files: ${escapeHtml(err.message)}</p>`;
  }
}

// ---------- Reusable "Website Links" section (used by Tender Spec & Supporting Info) ----------
function renderLinksSectionHtml(links, pathPrefix) {
  return `
    <div class="card">
      <h2>Website Links</h2>
      <table class="calc-table">
        <thead><tr><th>Label</th><th>URL</th><th></th></tr></thead>
        <tbody>
          ${links.map((l, i) => `<tr>
            <td class="label-cell"><input type="text" data-path="${pathPrefix}.links.${i}.label" value="${escapeHtml(l.label)}" style="text-align:left;width:100%;" placeholder="e.g. Vendor quote page" /></td>
            <td><input type="text" data-path="${pathPrefix}.links.${i}.url" value="${escapeHtml(l.url)}" style="text-align:left;width:100%;" placeholder="https://..." /></td>
            <td><button type="button" class="btn-remove-row" data-remove-link="${i}" data-links-path="${pathPrefix}.links" title="Remove">\u2715</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
      <button type="button" class="btn-add-row" data-add-link="${pathPrefix}.links">+ Add link</button>
      ${links.length > 0 ? `<div style="margin-top:14px;">${links.filter(l => l.url).map(l => `<div style="margin-bottom:6px;"><a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.label || l.url)}</a></div>`).join('')}</div>` : ''}
    </div>`;
}

// ---------- Tender Spec Document ----------
async function renderTenderSpec(container, data) {
  data.tenderSpec = data.tenderSpec || { notes: '', links: [] };
  data.tenderSpec.links = data.tenderSpec.links || [];
  container.innerHTML = `
    <div class="card">
      <h2>Tender Specification Notes</h2>
      <textarea data-path="tenderSpec.notes" class="notes-textarea" placeholder="Reference number, closing date, key requirements, scope of work, etc.">${escapeHtml(data.tenderSpec.notes || '')}</textarea>
    </div>
    ${renderLinksSectionHtml(data.tenderSpec.links, 'tenderSpec')}
    <div class="card">
      <h2>Tender Spec Documents</h2>
      <div id="file-list-tenderSpec"><p class="note">Loading\u2026</p></div>
      <form id="upload-form-tenderSpec" class="upload-form">
        <input type="file" required />
        <button type="submit" class="btn-add-row">Upload</button>
        <span class="upload-status hint"></span>
      </form>
      <p class="note">Any file type accepted (PDF, Word, Excel, etc). Max ${MAX_FILE_MB} MB per file.</p>
    </div>`;
  await initFileSection('tenderSpec', 'tender_spec', { imageGrid: false });
}

// ---------- Supporting Information ----------
async function renderSupportingInfo(container, data) {
  data.supportingInfo = data.supportingInfo || { links: [], notes: '' };
  data.supportingInfo.links = data.supportingInfo.links || [];
  container.innerHTML = `
    <div class="card">
      <h2>Notes</h2>
      <textarea data-path="supportingInfo.notes" class="notes-textarea" placeholder="Any free-form notes for the tender team\u2026">${escapeHtml(data.supportingInfo.notes || '')}</textarea>
    </div>
    ${renderLinksSectionHtml(data.supportingInfo.links, 'supportingInfo')}
    <div class="card">
      <h2>Pictures</h2>
      <div id="file-list-supportingPictures" class="image-grid"><p class="note">Loading\u2026</p></div>
      <form id="upload-form-supportingPictures" class="upload-form">
        <input type="file" accept="image/*" required />
        <button type="submit" class="btn-add-row">Upload Picture</button>
        <span class="upload-status hint"></span>
      </form>
      <p class="note">JPG, PNG, GIF, WebP, etc. Max ${MAX_FILE_MB} MB per file. Click a thumbnail to view it larger.</p>
    </div>
    <div class="card">
      <h2>Quotation</h2>
      <div id="file-list-supportingQuotation"><p class="note">Loading\u2026</p></div>
      <form id="upload-form-supportingQuotation" class="upload-form">
        <input type="file" required />
        <button type="submit" class="btn-add-row">Upload Quotation</button>
        <span class="upload-status hint"></span>
      </form>
      <p class="note">Any file type accepted. Max ${MAX_FILE_MB} MB per file.</p>
    </div>
    <div class="card">
      <h2>Other Documents</h2>
      <div id="file-list-supportingOther"><p class="note">Loading\u2026</p></div>
      <form id="upload-form-supportingOther" class="upload-form">
        <input type="file" required />
        <button type="submit" class="btn-add-row">Upload</button>
        <span class="upload-status hint"></span>
      </form>
      <p class="note">Anything that doesn't fit Pictures or Quotation. Max ${MAX_FILE_MB} MB per file.</p>
    </div>`;
  await initFileSection('supportingPictures', 'supporting_picture', { imageGrid: true });
  await initFileSection('supportingQuotation', 'supporting_quotation', { imageGrid: false });
  await initFileSection('supportingOther', 'supporting_doc', { imageGrid: false });
}

// ---------- Discussion ----------
async function renderDiscussion(container) {
  container.innerHTML = `
    <div class="card">
      <h2>Site Discussion \u2014 Tender Notes</h2>
      <div id="discussion-list" class="discussion-list"><p class="note">Loading\u2026</p></div>
      <form id="discussion-form" class="discussion-form">
        <input type="text" id="discussion-author" placeholder="Your name" />
        <textarea id="discussion-message" placeholder="Add a note for the team\u2026" required></textarea>
        <button type="submit">Post</button>
      </form>
    </div>`;
  await loadDiscussion();
  document.getElementById('discussion-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const author = document.getElementById('discussion-author').value;
    const message = document.getElementById('discussion-message').value;
    if (!message.trim()) return;
    await api(`/api/sites/${state.siteId}/discussion`, { method: 'POST', body: JSON.stringify({ author, message }) });
    document.getElementById('discussion-message').value = '';
    await loadDiscussion();
  });
}
async function loadDiscussion() {
  const listEl = document.getElementById('discussion-list');
  if (!listEl) return;
  const messages = await api(`/api/sites/${state.siteId}/discussion`);
  if (messages.length === 0) {
    listEl.innerHTML = '<p class="note">No notes yet \u2014 be the first to post.</p>';
    return;
  }
  listEl.innerHTML = messages.map((m) => `
    <div class="discussion-msg">
      <div class="meta"><span class="author">${escapeHtml(m.author)}</span> \u2014 ${new Date(m.created_at).toLocaleString()}</div>
      <div class="text">${escapeHtml(m.message)}</div>
    </div>`).join('');
  listEl.scrollTop = listEl.scrollHeight;
}

// Patch getPath to support the special "__batches" pseudo-path used in Summary

// ---------- Lightbox (click-to-expand images) ----------
function openLightbox(src, alt) {
  const overlay = document.getElementById('lightbox-overlay');
  const img = document.getElementById('lightbox-img');
  img.src = src;
  img.alt = alt || '';
  overlay.hidden = false;
}
function closeLightbox() {
  const overlay = document.getElementById('lightbox-overlay');
  document.getElementById('lightbox-img').src = '';
  overlay.hidden = true;
}
document.getElementById('lightbox-overlay').addEventListener('click', closeLightbox);
document.getElementById('lightbox-close').addEventListener('click', (e) => { e.stopPropagation(); closeLightbox(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });
// Delegated: any image with data-lightbox-src opens the lightbox on click, from anywhere in the app.
document.addEventListener('click', (e) => {
  const img = e.target.closest('[data-lightbox-src]');
  if (img) openLightbox(img.dataset.lightboxSrc, img.alt);
});

// ---------- Init ----------
checkSession();
