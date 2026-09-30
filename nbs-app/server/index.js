// Newborn Screening Malaysia — Tendering Cost Estimator
// Express server: serves the front-end, gates access behind a shared
// password, and proxies all data access to Supabase using the SERVICE
// ROLE key (kept server-side only — the browser never sees it).

const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieSession = require('cookie-session');
const multer = require('multer');
const archiver = require('archiver');
const { createClient } = require('@supabase/supabase-js');
const { computeAll, computeKitAll, kitLevelKeys } = require('../public/calc.js'); // same calc engine the app uses, for report consistency
const { buildExcelReport, buildPdfReport, buildKitExcelReport, buildKitPdfReport } = require('./reports.js');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }); // 20 MB cap

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  APP_SHARED_PASSWORD,
  SESSION_SECRET,
  PORT = 3000,
} = process.env;

for (const [key, val] of Object.entries({
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APP_SHARED_PASSWORD, SESSION_SECRET,
})) {
  if (!val) {
    // eslint-disable-next-line no-console
    console.error(`Missing required environment variable: ${key}`);
  }
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Supabase's newer sb_secret_ key format has a known, currently-open platform
// bug (github.com/supabase/supabase#50651): their internal gateway mints a
// short-lived token per request, and an occasional clock-skew between two of
// THEIR OWN backend components rejects it with "JWT issued at future". It's
// transient and self-clears within a couple of seconds — retrying is the
// only mitigation available until Supabase ships a fix on their end.
async function withRetry(queryFn, { retries = 2, delayMs = 1200 } = {}) {
  let lastResult;
  for (let attempt = 0; attempt <= retries; attempt++) {
    lastResult = await queryFn();
    const isTransientJwtSkew = lastResult.error
      && /jwt issued at future/i.test(lastResult.error.message || '');
    if (!lastResult.error || !isTransientJwtSkew) return lastResult;
    if (attempt < retries) await new Promise((r) => setTimeout(r, delayMs));
  }
  return lastResult;
}

const app = express();
app.set('trust proxy', true); // Render's proxy chain — trust all hops so req.secure reflects the real (HTTPS) client connection
app.set('etag', false); // belt-and-suspenders alongside Cache-Control: no-store below — API responses should never be conditionally cached/revalidated
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// API responses change frequently (site data, file lists) and must never be
// served stale from a browser cache — this stops the ETag/304 behavior that
// can otherwise make a freshly-uploaded file invisible until a hard refresh.
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.use(
  cookieSession({
    name: 'nbs_session',
    secret: SESSION_SECRET,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })
);

function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

// Express 4 does NOT automatically catch a rejected promise thrown inside an
// async route handler — an unhandled rejection there crashes the ENTIRE
// Node process (every user, every site), not just the one request. Every
// async route below is wrapped with this so a thrown/rejected error is
// routed to Express's own error-handling middleware instead of escaping.
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ---------- Auth ----------
app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (typeof password === 'string' && password === APP_SHARED_PASSWORD) {
    req.session.authed = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'Incorrect password' });
});

app.post('/api/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get('/api/session', (req, res) => {
  res.json({ authed: !!(req.session && req.session.authed) });
});

// ---------- Sites ----------
app.get('/api/sites', requireAuth, asyncHandler(async (req, res) => {
  const { data, error } = await withRetry(() => supabase
    .from('sites')
    .select('id, name, created_at, updated_at')
    .order('created_at', { ascending: true }));
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}));

app.post('/api/sites', requireAuth, asyncHandler(async (req, res) => {
  const { name, data: initialData } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Site name is required' });
  const { data, error } = await withRetry(() => supabase
    .from('sites')
    .insert({ name: name.trim(), data: initialData || {} })
    .select()
    .single());
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}));

app.get('/api/sites/:id', requireAuth, asyncHandler(async (req, res) => {
  const { data, error } = await withRetry(() => supabase
    .from('sites')
    .select('*')
    .eq('id', req.params.id)
    .single());
  if (error) return res.status(404).json({ error: error.message });
  res.json(data);
}));

app.put('/api/sites/:id', requireAuth, asyncHandler(async (req, res) => {
  const { name, data: newData } = req.body || {};
  const patch = {};
  if (typeof name === 'string' && name.trim()) patch.name = name.trim();
  if (newData !== undefined) patch.data = newData;
  const { data, error } = await withRetry(() => supabase
    .from('sites')
    .update(patch)
    .eq('id', req.params.id)
    .select()
    .single());
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}));

app.delete('/api/sites/:id', requireAuth, asyncHandler(async (req, res) => {
  const { error } = await withRetry(() => supabase.from('sites').delete().eq('id', req.params.id));
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

// ---------- Discussion ----------
app.get('/api/sites/:id/discussion', requireAuth, asyncHandler(async (req, res) => {
  const { data, error } = await withRetry(() => supabase
    .from('discussion_messages')
    .select('*')
    .eq('site_id', req.params.id)
    .order('created_at', { ascending: true }));
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}));

app.post('/api/sites/:id/discussion', requireAuth, asyncHandler(async (req, res) => {
  const { author, message } = req.body || {};
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message is required' });
  const { data, error } = await withRetry(() => supabase
    .from('discussion_messages')
    .insert({
      site_id: req.params.id,
      author: (author && author.trim()) || 'Team',
      message: message.trim(),
    })
    .select()
    .single());
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}));

app.delete('/api/sites/:siteId/discussion/:msgId', requireAuth, asyncHandler(async (req, res) => {
  const { error } = await withRetry(() => supabase
    .from('discussion_messages')
    .delete()
    .eq('id', req.params.msgId)
    .eq('site_id', req.params.siteId));
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

// ---------- Files: Tender Spec docs, Images, and Supporting Info docs ----------
// All share one table, distinguished by "category". Stored as base64 in
// Postgres (simplest option for a modest number of tender documents/images —
// no Supabase Storage bucket needed). List endpoint omits the file bytes to
// keep the payload small; download endpoint streams them back.
const VALID_CATEGORIES = ['tender_spec', 'image', 'supporting_doc', 'supporting_picture', 'supporting_quotation'];
const IMAGE_ONLY_CATEGORIES = ['image', 'supporting_picture'];

app.get('/api/sites/:siteId/files', requireAuth, asyncHandler(async (req, res) => {
  const category = req.query.category;
  const { data, error } = await withRetry(() => {
    let query = supabase
      .from('supporting_files')
      .select('id, filename, mime_type, file_size, category, folder_id, uploaded_at')
      .eq('site_id', req.params.siteId)
      .order('uploaded_at', { ascending: false });
    if (category) query = query.eq('category', category);
    return query;
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}));

app.post('/api/sites/:siteId/files', requireAuth, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const category = VALID_CATEGORIES.includes(req.body.category) ? req.body.category : 'supporting_doc';
  if (IMAGE_ONLY_CATEGORIES.includes(category) && !req.file.mimetype.startsWith('image/')) {
    return res.status(400).json({ error: 'Only image files are allowed here' });
  }
  // folder_id is optional — an upload made while a folder is "open" lands directly in it
  const folderId = req.body.folder_id && req.body.folder_id !== 'null' ? req.body.folder_id : null;
  const { error } = await withRetry(() => supabase.from('supporting_files').insert({
    site_id: req.params.siteId,
    category,
    folder_id: folderId,
    filename: req.file.originalname,
    mime_type: req.file.mimetype,
    file_size: req.file.size,
    file_data: req.file.buffer.toString('base64'),
  }));
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

// Move a file into a folder (or back to "no folder" with folder_id: null)
app.put('/api/sites/:siteId/files/:fileId/move', requireAuth, asyncHandler(async (req, res) => {
  const { folder_id: folderId } = req.body || {};
  const { error } = await withRetry(() => supabase
    .from('supporting_files')
    .update({ folder_id: folderId || null })
    .eq('id', req.params.fileId)
    .eq('site_id', req.params.siteId));
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

// Download every file in a category (optionally narrowed to one folder) as
// a single .zip — the "Download all" button next to a folder or a file
// section. Registered ahead of the /:fileId route below so "download-zip"
// is never swallowed by it as a file id. Duplicate filenames (two files with
// the same name, in different folders or re-uploaded) are numbered so
// nothing silently overwrites another entry inside the zip.
app.get('/api/sites/:siteId/files/download-zip', requireAuth, asyncHandler(async (req, res) => {
  const category = req.query.category;
  if (!VALID_CATEGORIES.includes(category)) return res.status(400).json({ error: 'Invalid category' });
  let query = supabase
    .from('supporting_files')
    .select('filename, mime_type, file_data, folder_id')
    .eq('site_id', req.params.siteId)
    .eq('category', category);
  const { folderId } = req.query;
  if (folderId === 'unfiled') query = query.is('folder_id', null);
  else if (folderId) query = query.eq('folder_id', folderId);
  const { data: files, error } = await withRetry(() => query);
  if (error) return res.status(500).json({ error: error.message });
  if (!files || !files.length) return res.status(404).json({ error: 'No files to download' });

  let zipLabel = category.replace(/_/g, '-');
  if (folderId && folderId !== 'unfiled') {
    const { data: folder } = await withRetry(() => supabase.from('file_folders').select('name').eq('id', folderId).single());
    if (folder && folder.name) zipLabel = folder.name.replace(/[^a-z0-9\- ]+/gi, '').trim() || zipLabel;
  }
  res.set('Content-Type', 'application/zip');
  res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(zipLabel)}.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => { if (!res.headersSent) res.status(500); res.end(); console.error('zip error:', err); });
  archive.pipe(res);
  const usedNames = new Map();
  files.forEach((f) => {
    let name = f.filename || 'file';
    const count = usedNames.get(name) || 0;
    usedNames.set(name, count + 1);
    if (count > 0) {
      const dot = name.lastIndexOf('.');
      name = dot > 0 ? `${name.slice(0, dot)} (${count})${name.slice(dot)}` : `${name} (${count})`;
    }
    archive.append(Buffer.from(f.file_data, 'base64'), { name });
  });
  archive.finalize();
}));

app.get('/api/sites/:siteId/files/:fileId', requireAuth, asyncHandler(async (req, res) => {
  const { data, error } = await withRetry(() => supabase
    .from('supporting_files')
    .select('filename, mime_type, file_data')
    .eq('id', req.params.fileId)
    .eq('site_id', req.params.siteId)
    .single());
  if (error || !data) return res.status(404).json({ error: 'File not found' });
  res.set('Content-Type', data.mime_type);
  res.set('Content-Disposition', `inline; filename="${encodeURIComponent(data.filename)}"`);
  res.send(Buffer.from(data.file_data, 'base64'));
}));

app.delete('/api/sites/:siteId/files/:fileId', requireAuth, asyncHandler(async (req, res) => {
  const { error } = await withRetry(() => supabase
    .from('supporting_files')
    .delete()
    .eq('id', req.params.fileId)
    .eq('site_id', req.params.siteId));
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

// ---------- Folders (group uploaded files within a category) ----------
// Folders are scoped per site AND per category, so "Tender Spec Documents"
// and Supporting Info's "Quotation" section each keep their own folder list.
app.get('/api/sites/:siteId/folders', requireAuth, asyncHandler(async (req, res) => {
  const category = req.query.category;
  const { data, error } = await withRetry(() => {
    let query = supabase
      .from('file_folders')
      .select('id, name, category, created_at')
      .eq('site_id', req.params.siteId)
      .order('name', { ascending: true });
    if (category) query = query.eq('category', category);
    return query;
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}));

app.post('/api/sites/:siteId/folders', requireAuth, asyncHandler(async (req, res) => {
  const { name, category } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Folder name is required' });
  if (!VALID_CATEGORIES.includes(category)) return res.status(400).json({ error: 'Invalid category' });
  const { data, error } = await withRetry(() => supabase
    .from('file_folders')
    .insert({ site_id: req.params.siteId, category, name: name.trim() })
    .select()
    .single());
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}));

app.put('/api/sites/:siteId/folders/:folderId', requireAuth, asyncHandler(async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Folder name is required' });
  const { data, error } = await withRetry(() => supabase
    .from('file_folders')
    .update({ name: name.trim() })
    .eq('id', req.params.folderId)
    .eq('site_id', req.params.siteId)
    .select()
    .single());
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}));

// Deleting a folder never deletes its files — they fall back to "no folder"
// (the DB foreign key is ON DELETE SET NULL; see migration_8_folders.sql).
app.delete('/api/sites/:siteId/folders/:folderId', requireAuth, asyncHandler(async (req, res) => {
  const { error } = await withRetry(() => supabase
    .from('file_folders')
    .delete()
    .eq('id', req.params.folderId)
    .eq('site_id', req.params.siteId));
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

// ---------- Version history ----------
// Saves a full, named snapshot of a site's data at a point in time. Restoring
// overwrites the site's current data with that snapshot (the site itself,
// discussion, and version list are untouched).
app.get('/api/sites/:siteId/versions', requireAuth, asyncHandler(async (req, res) => {
  const { data, error } = await withRetry(() => supabase
    .from('site_versions')
    .select('id, label, created_at')
    .eq('site_id', req.params.siteId)
    .order('created_at', { ascending: false }));
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}));

app.post('/api/sites/:siteId/versions', requireAuth, asyncHandler(async (req, res) => {
  const { label } = req.body || {};
  if (!label || !label.trim()) return res.status(400).json({ error: 'A version label is required' });
  const { data: site, error: siteErr } = await withRetry(() => supabase
    .from('sites')
    .select('data')
    .eq('id', req.params.siteId)
    .single());
  if (siteErr || !site) return res.status(404).json({ error: 'Site not found' });
  const { error } = await withRetry(() => supabase.from('site_versions').insert({
    site_id: req.params.siteId,
    label: label.trim(),
    data: site.data,
  }));
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

app.post('/api/sites/:siteId/versions/:versionId/restore', requireAuth, asyncHandler(async (req, res) => {
  const { data: version, error: verErr } = await withRetry(() => supabase
    .from('site_versions')
    .select('data')
    .eq('id', req.params.versionId)
    .eq('site_id', req.params.siteId)
    .single());
  if (verErr || !version) return res.status(404).json({ error: 'Version not found' });
  const { data: updated, error } = await withRetry(() => supabase
    .from('sites')
    .update({ data: version.data })
    .eq('id', req.params.siteId)
    .select()
    .single());
  if (error) return res.status(500).json({ error: error.message });
  res.json(updated);
}));

app.delete('/api/sites/:siteId/versions/:versionId', requireAuth, asyncHandler(async (req, res) => {
  const { error } = await withRetry(() => supabase
    .from('site_versions')
    .delete()
    .eq('id', req.params.versionId)
    .eq('site_id', req.params.siteId));
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

// A site can hold up to two calculators (calc1/calc2), each with its own
// type ("chemistry" = SOP/gradient-based, "kit" = commercial-kit-based).
// Only the currently-ACTIVE calculator's fields live at the root of
// site.data; the other one's fields (if it has ever been used) are parked
// under data.calculators[id].data. This mirrors public/app.js's
// switchCalculator() exactly, so export always matches what the app shows
// for that calculator regardless of which one happens to be active right now.
const CALCULATOR_FIELD_KEYS_BY_TYPE = {
  chemistry: ['batchSetup', 'lcGradient', 'calibratorPrep', 'reagents', 'column', 'solvents', 'consumables', 'freightTax'],
  kit: ['batchSetup', 'lcGradient', 'kit', 'consumables', 'freightTax'],
};
function calculatorTypeOf(data, id) {
  return (data.calculators && data.calculators[id] && data.calculators[id].type) || (id === 'calc2' ? 'kit' : 'chemistry');
}
function calculatorNameOf(data, id) {
  return (data.calculators && data.calculators[id] && data.calculators[id].name) || (id === 'calc1' ? 'Calculator 1' : 'Calculator 2');
}
// Builds a data-shaped object with the requested calculator's fields at the
// root (plus site-wide fields report builders need), whether or not that
// calculator is the one currently active.
function calculatorSnapshot(data, calcId) {
  data = data || {};
  const type = calculatorTypeOf(data, calcId);
  const activeId = data.activeCalculatorId || 'calc1';
  const source = calcId === activeId ? data : ((data.calculators && data.calculators[calcId] && data.calculators[calcId].data) || {});
  const out = {};
  CALCULATOR_FIELD_KEYS_BY_TYPE[type].forEach((k) => { out[k] = source[k]; });
  out.currency = data.currency;
  out.tenderSpec = data.tenderSpec;
  out.supportingInfo = data.supportingInfo;
  if (type === 'kit') {
    migrateKitPacksPerKit(out); migrateKitReagents(out); migrateKitCalibratorSet(out);
    migrateKitControlSet(out); ensureKitLevelDefaults(out);
  }
  return { type, name: calculatorNameOf(data, calcId), data: out };
}

// Mirrors public/app.js's migrateKitCalibratorSet(): covers two earlier
// shapes of the Calibrator Set field — per-level rows (calibrators.l0,
// calibrators.l1, ..., each with its own packs/cost, meaning the one real
// purchase got entered more than once) and a flat single calibratorSet line
// (one shared volPerUseUL for every level, no per-level visibility). The
// current shape keeps the purchase (packs/kit, extra packs, pack size,
// cost) shared in ONE place, while `levels` tracks each calibrator level's
// own required volume separately. Exports read straight from the database,
// not the browser's in-memory state, so this recovery runs here too.
function migrateKitCalibratorSet(calcData) {
  if (!calcData || !calcData.kit || !calcData.kit.reagents) return;
  const rg = calcData.kit.reagents;
  if (rg.calibratorSet && rg.calibratorSet.levels) return;
  const legacyPerLevel = rg.calibrators;
  const legacyFlat = rg.calibratorSet;
  const firstLevelKey = legacyPerLevel && Object.keys(legacyPerLevel)[0];
  const source = legacyFlat || (firstLevelKey ? legacyPerLevel[firstLevelKey] : {}) || {};
  const levels = {};
  if (legacyPerLevel) {
    Object.keys(legacyPerLevel).forEach((key) => {
      levels[key] = { volPerUseUL: Number(legacyPerLevel[key].volPerUseUL) || 0 };
    });
  } else if (legacyFlat && legacyFlat.volPerUseUL !== undefined) {
    const bs = calcData.batchSetup || {};
    kitLevelKeys(bs.calLevels).forEach((key) => { levels[key] = { volPerUseUL: Number(legacyFlat.volPerUseUL) || 0 }; });
  }
  calcData.kit.reagents.calibratorSet = {
    code: source.code,
    packSizeUL: source.packSizeUL !== undefined ? Number(source.packSizeUL) || 0 : 6000,
    packsPerKit: source.packsPerKit !== undefined ? Number(source.packsPerKit) || 0 : 0,
    extraPacksPurchased: Number(source.extraPacksPurchased) || 0,
    costPerPack: Number(source.costPerPack) || 0,
    levels,
  };
  delete calcData.kit.reagents.calibrators;
}

// Mirrors public/app.js's migrateKitControlSet(): covers two earlier shapes
// of the Control Set field — per-level rows (controls.l0, controls.l1, ...,
// each with its own packs/cost, meaning the one real purchase got entered
// more than once) and a flat single controlSet line (one shared
// volPerUseUL for every level, no per-level visibility). The current shape
// keeps the purchase (packs/kit, extra packs, pack size, cost) shared in
// ONE place, while `levels` tracks each QC level's own required volume
// separately. Exports read straight from the database, not the browser's
// in-memory state, so this recovery runs here too.
function migrateKitControlSet(calcData) {
  if (!calcData || !calcData.kit || !calcData.kit.reagents) return;
  const rg = calcData.kit.reagents;
  if (rg.controlSet && rg.controlSet.levels) return;
  const legacyPerLevel = rg.controls;
  const legacyFlat = rg.controlSet;
  const firstLevelKey = legacyPerLevel && Object.keys(legacyPerLevel)[0];
  const source = legacyFlat || (firstLevelKey ? legacyPerLevel[firstLevelKey] : {}) || {};
  const levels = {};
  if (legacyPerLevel) {
    Object.keys(legacyPerLevel).forEach((key) => {
      levels[key] = { volPerUseUL: Number(legacyPerLevel[key].volPerUseUL) || 0 };
    });
  } else if (legacyFlat && legacyFlat.volPerUseUL !== undefined) {
    const bs = calcData.batchSetup || {};
    kitLevelKeys(bs.qcLevels).forEach((key) => { levels[key] = { volPerUseUL: Number(legacyFlat.volPerUseUL) || 0 }; });
  }
  calcData.kit.reagents.controlSet = {
    code: source.code,
    packSizeUL: source.packSizeUL !== undefined ? Number(source.packSizeUL) || 0 : 5000,
    packsPerKit: source.packsPerKit !== undefined ? Number(source.packsPerKit) || 0 : 0,
    extraPacksPurchased: Number(source.extraPacksPurchased) || 0,
    costPerPack: Number(source.costPerPack) || 0,
    levels,
  };
  delete calcData.kit.reagents.controls;
}

// Mirrors public/app.js's ensureKitLevelDefaults(): Batch Setup's
// calLevels/qcLevels fields are the single source of truth for how many
// calibrator levels / QC levels there are. Backfills a blank starting
// requirement (vol/use only) for any level implied by the current count
// that doesn't have one yet, inside calibratorSet.levels / controlSet.levels
// (the purchase itself stays one shared object per bundle — see
// migrateKitCalibratorSet/migrateKitControlSet above). Exports read
// straight from the database, not the browser's in-memory state, so this
// runs here too — otherwise an unedited/legacy site would export with
// missing rows instead of the correct blank ones.
function ensureKitLevelDefaults(calcData) {
  if (!calcData || !calcData.kit) return;
  calcData.kit.reagents = calcData.kit.reagents || {};
  calcData.kit.reagents.calibratorSet = calcData.kit.reagents.calibratorSet
    || { packSizeUL: 6000, packsPerKit: 0, extraPacksPurchased: 0, costPerPack: 0, levels: {} };
  calcData.kit.reagents.calibratorSet.levels = calcData.kit.reagents.calibratorSet.levels || {};
  calcData.kit.reagents.controlSet = calcData.kit.reagents.controlSet
    || { packSizeUL: 5000, packsPerKit: 0, extraPacksPurchased: 0, costPerPack: 0, levels: {} };
  calcData.kit.reagents.controlSet.levels = calcData.kit.reagents.controlSet.levels || {};
  const bs = calcData.batchSetup || {};
  kitLevelKeys(bs.calLevels).forEach((key) => {
    if (!calcData.kit.reagents.calibratorSet.levels[key]) calcData.kit.reagents.calibratorSet.levels[key] = { volPerUseUL: 15 };
  });
  kitLevelKeys(bs.qcLevels).forEach((key) => {
    if (!calcData.kit.reagents.controlSet.levels[key]) calcData.kit.reagents.controlSet.levels[key] = { volPerUseUL: 15 };
  });
}

// Mirrors public/app.js's migrateKitReagents(): sites saved before the IS &
// Calibrator Usage table existed had MS14012/MS14013/MS14082 as flat
// "Additional Items" lines. Exports read straight from the database, not
// the browser's in-memory migrated state, so this recovery runs here too.
function migrateKitReagents(calcData) {
  if (!calcData || !calcData.kit || calcData.kit.reagents) return;
  calcData.kit.reagents = {
    is: { code: 'MS14012', packSizeUL: 5000, packsPerKit: 1, extraPacksPurchased: 0, costPerPack: 0, volPerUseUL: 100 },
    calibratorSet: { code: 'MS14013', packSizeUL: 6000, packsPerKit: 1, extraPacksPurchased: 0, costPerPack: 0, levels: {} },
    controlSet: { code: 'MS14082', packSizeUL: 5000, packsPerKit: 1, extraPacksPurchased: 0, costPerPack: 0, levels: {} },
  };
  const items = calcData.kit.additionalItems || [];
  const isItem = items.find((it) => it && it.code === 'MS14012');
  if (isItem) {
    calcData.kit.reagents.is.extraPacksPurchased = Number(isItem.qty) || 0;
    calcData.kit.reagents.is.costPerPack = Number(isItem.costPerUnit) || 0;
  }
  const calItem = items.find((it) => it && it.code === 'MS14013');
  if (calItem) {
    calcData.kit.reagents.calibratorSet.extraPacksPurchased = Number(calItem.qty) || 0;
    calcData.kit.reagents.calibratorSet.costPerPack = Number(calItem.costPerUnit) || 0;
  }
  const qcItem = items.find((it) => it && it.code === 'MS14082');
  if (qcItem) {
    calcData.kit.reagents.controlSet.extraPacksPurchased = Number(qcItem.qty) || 0;
    calcData.kit.reagents.controlSet.costPerPack = Number(qcItem.costPerUnit) || 0;
  }
  calcData.kit.additionalItems = items.filter((it) => !it || (it.code !== 'MS14012' && it.code !== 'MS14013' && it.code !== 'MS14082'));
}

// One-time migration, mirroring the same helper in public/app.js: covers
// both a legacy site (packs from kit(s) was auto-computed from a hardcoded
// per-kit count, no packsPerKit field at all) and a briefly-shipped one
// (packs from kit(s) was itself free text). Exports read straight from the
// database, not the browser's in-memory migrated state, so this is applied
// here too — otherwise an unedited legacy site would export with 0 packs/kit.
const LEGACY_KIT_INCLUDED_PACKS = { washSolution: 1, mobilePhaseA: 2, mobilePhaseB: 2, precipitantP: 2 };
function migrateKitPacksPerKit(calcData) {
  if (!calcData || !calcData.kit || !calcData.kit.lcConsumables) return;
  const kitsQty = Number(calcData.kit.completeKits && calcData.kit.completeKits.qty) || 0;
  Object.keys(LEGACY_KIT_INCLUDED_PACKS).forEach((key) => {
    const cfg = calcData.kit.lcConsumables[key];
    if (!cfg || cfg.packsPerKit !== undefined) return;
    if (cfg.packsFromKits !== undefined && kitsQty > 0) {
      cfg.packsPerKit = cfg.packsFromKits / kitsQty;
    } else {
      cfg.packsPerKit = LEGACY_KIT_INCLUDED_PACKS[key];
    }
  });
}

// ---------- Report export (Excel & PDF) ----------
// ?calculator=calc1|calc2 selects which calculator to export; defaults to
// whichever one is currently active on the site.
app.get('/api/sites/:id/export/excel', requireAuth, asyncHandler(async (req, res) => {
  const { data: site, error } = await withRetry(() => supabase.from('sites').select('*').eq('id', req.params.id).single());
  if (error || !site) return res.status(404).json({ error: 'Site not found' });
  const calcId = req.query.calculator === 'calc1' || req.query.calculator === 'calc2'
    ? req.query.calculator : (site.data.activeCalculatorId || 'calc1');
  const snap = calculatorSnapshot(site.data, calcId);
  const siteForReport = { ...site, data: snap.data };
  const buffer = snap.type === 'kit'
    ? await buildKitExcelReport(siteForReport, computeKitAll(snap.data), snap.name)
    : await buildExcelReport(siteForReport, computeAll(snap.data), snap.name);
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(site.name)}-${encodeURIComponent(snap.name)}-tender-report.xlsx"`);
  res.send(Buffer.from(buffer));
}));

app.get('/api/sites/:id/export/pdf', requireAuth, asyncHandler(async (req, res) => {
  const { data: site, error } = await withRetry(() => supabase.from('sites').select('*').eq('id', req.params.id).single());
  if (error || !site) return res.status(404).json({ error: 'Site not found' });
  const calcId = req.query.calculator === 'calc1' || req.query.calculator === 'calc2'
    ? req.query.calculator : (site.data.activeCalculatorId || 'calc1');
  const snap = calculatorSnapshot(site.data, calcId);
  const siteForReport = { ...site, data: snap.data };
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(site.name)}-${encodeURIComponent(snap.name)}-tender-report.pdf"`);
  if (snap.type === 'kit') {
    buildKitPdfReport(siteForReport, computeKitAll(snap.data), res, snap.name);
  } else {
    buildPdfReport(siteForReport, computeAll(snap.data), res, snap.name);
  }
}));

// ---------- Static front-end ----------
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Catches Multer errors (e.g. file too large) and any other thrown errors,
// returning JSON instead of Express's default HTML error page.
app.use((err, req, res, next) => {
  // eslint-disable-next-line no-console
  console.error(err);
  if (res.headersSent) return next(err); // e.g. mid-stream during a PDF export — can't send a fresh JSON body now
  const status = err.status || (err.name === 'MulterError' ? 400 : 500);
  res.status(status).json({ error: err.message || 'Something went wrong' });
});

// Last-resort safety net: without this, ANY unhandled rejection or thrown
// error anywhere in the process (not just inside an Express route — a bad
// timer callback, a stray promise, a dependency's internal error) takes the
// entire Node process down, which is what caused the PDF-export 502s: the
// whole app went offline for every user/site until Render restarted it.
// This keeps the process alive and logs instead of crashing.
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('Unhandled promise rejection (recovered, process kept alive):', reason);
});
process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error('Uncaught exception (recovered, process kept alive):', err);
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Newborn Screening Malaysia tender app listening on port ${PORT}`);
});
