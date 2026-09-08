/* Newborn Screening Malaysia — Tender Cost Estimator
   Front-end app: auth, site management, tab rendering, live recalculation.
   No build step — plain JS, talks to the Express API which proxies Supabase. */
console.log('APP.JS LOADED — TOP OF FILE, script is executing');
const state = { siteId: null, site: null, sites: [], activeTab: 'batchSetup', saveTimer: null };

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
    methanol: { bottleSize: 4000, dead: 30, costPerBottle: 45 },
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
    batchSetup: renderBatchSetup, lcGradient: renderGradient, calibratorPrep: renderCalibratorPrep,
    reagents: renderReagents, column: renderColumn, solvents: renderSolvents,
    summary: renderSummary, discussion: renderDiscussion,
  };
  container.innerHTML = '';
  renderers[state.activeTab](container, state.site.data);
  if (state.activeTab !== 'discussion') refreshComputed();
}

// Delegated input handler: updates the model, recomputes, saves — never rebuilds DOM.
document.getElementById('tab-content').addEventListener('input', (e) => {
  const el = e.target;
  if (!el.dataset.path) return;
  let value = el.value;
  if (el.dataset.type === 'number') value = value === '' ? 0 : parseFloat(value);
  if (el.dataset.type === 'pct') value = value === '' ? 0 : parseFloat(value) / 100;
  setPath(state.site.data, el.dataset.path, value);
  refreshComputed();
  scheduleSave();
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
        <thead><tr><th>Material</th><th>Vial/bottle size</th><th>Dead/waste vol.</th><th>Usable volume</th><th>Units needed</th><th>Cost per unit ($)</th><th>Total cost ($)</th><th>Cost/batch ($)</th></tr></thead>
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
          <tr>
            <td class="label-cell">Methanol (calibrator dilution, mL)</td>
            <td><input type="number" step="any" data-path="calibratorPrep.methanol.bottleSize" data-type="number" value="${cp.methanol.bottleSize}" /></td>
            <td><input type="number" step="any" data-path="calibratorPrep.methanol.dead" data-type="number" value="${cp.methanol.dead}" /></td>
            <td class="computed" data-out="calPrepCalc.meohUsable" data-fmt="num2">\u2014</td>
            <td class="computed" data-out="calPrepCalc.meohBottlesNeeded" data-fmt="int">\u2014</td>
            <td><input type="number" step="any" data-path="calibratorPrep.methanol.costPerBottle" data-type="number" value="${cp.methanol.costPerBottle}" /></td>
            <td class="computed" data-out="calPrepCalc.meohTotalCost" data-fmt="cur">\u2014</td>
            <td class="computed" data-out="calPrepCalc.meohTotalCost" data-fmt="cur">\u2014</td>
          </tr>
          <tr class="total-row"><td colspan="6">TOTAL</td><td colspan="2" class="computed" data-out="calPrepCalc.calPrepTotalCost" data-fmt="cur">\u2014</td></tr>
        </tbody>
      </table>
      <p class="note">One serial dilution series is prepared per batch and supplies all calibrator levels \u2014 raw standard is consumed only where actually drawn (to make S2, plus directly for P1), not per calibration level.</p>
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
          <tr class="total-row"><td colspan="9">TOTAL</td><td colspan="2" class="computed" data-out="solventsCalc.totalCost" data-fmt="cur">\u2014</td></tr>
        </tbody>
      </table>
      <p class="note">Water and ACN volumes are linked live from the LC Gradient tab. PFHeptA/TDHFA volume is derived automatically from the % v/v set above times the combined Water+ACN volume. Methanol used for calibrator dilution is costed on the Calibrator &amp; QC Prep tab, not here.</p>
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
      <div class="summary-box grand"><div class="label">GRAND TOTAL</div><div class="amount" data-out="summary.grandTotal" data-fmt="cur">\u2014</div></div>
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
    <p class="note" style="padding:0 4px;">Instrument purchase/depreciation cost is excluded, per scope. All figures are estimates based on the inputs across the other tabs.</p>`;
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

// ---------- Init ----------
checkSession();
