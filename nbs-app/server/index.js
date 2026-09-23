// Newborn Screening Malaysia — Tendering Cost Estimator
// Express server: serves the front-end, gates access behind a shared
// password, and proxies all data access to Supabase using the SERVICE
// ROLE key (kept server-side only — the browser never sees it).

const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieSession = require('cookie-session');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { computeAll } = require('../public/calc.js'); // same calc engine the app uses, for report consistency
const { buildExcelReport, buildPdfReport } = require('./reports.js');

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
app.get('/api/sites', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('sites')
    .select('id, name, created_at, updated_at')
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/sites', requireAuth, async (req, res) => {
  const { name, data: initialData } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Site name is required' });
  const { data, error } = await supabase
    .from('sites')
    .insert({ name: name.trim(), data: initialData || {} })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/api/sites/:id', requireAuth, async (req, res) => {
  const { data, error } = await withRetry(() => supabase
    .from('sites')
    .select('*')
    .eq('id', req.params.id)
    .single());
  if (error) return res.status(404).json({ error: error.message });
  res.json(data);
});

app.put('/api/sites/:id', requireAuth, async (req, res) => {
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
});

app.delete('/api/sites/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('sites').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ---------- Discussion ----------
app.get('/api/sites/:id/discussion', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('discussion_messages')
    .select('*')
    .eq('site_id', req.params.id)
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/sites/:id/discussion', requireAuth, async (req, res) => {
  const { author, message } = req.body || {};
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message is required' });
  const { data, error } = await supabase
    .from('discussion_messages')
    .insert({
      site_id: req.params.id,
      author: (author && author.trim()) || 'Team',
      message: message.trim(),
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/sites/:siteId/discussion/:msgId', requireAuth, async (req, res) => {
  const { error } = await supabase
    .from('discussion_messages')
    .delete()
    .eq('id', req.params.msgId)
    .eq('site_id', req.params.siteId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ---------- Files: Tender Spec docs, Images, and Supporting Info docs ----------
// All share one table, distinguished by "category". Stored as base64 in
// Postgres (simplest option for a modest number of tender documents/images —
// no Supabase Storage bucket needed). List endpoint omits the file bytes to
// keep the payload small; download endpoint streams them back.
const VALID_CATEGORIES = ['tender_spec', 'image', 'supporting_doc', 'supporting_picture', 'supporting_quotation'];
const IMAGE_ONLY_CATEGORIES = ['image', 'supporting_picture'];

app.get('/api/sites/:siteId/files', requireAuth, async (req, res) => {
  const category = req.query.category;
  let query = supabase
    .from('supporting_files')
    .select('id, filename, mime_type, file_size, category, uploaded_at')
    .eq('site_id', req.params.siteId)
    .order('uploaded_at', { ascending: false });
  if (category) query = query.eq('category', category);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/sites/:siteId/files', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const category = VALID_CATEGORIES.includes(req.body.category) ? req.body.category : 'supporting_doc';
  if (IMAGE_ONLY_CATEGORIES.includes(category) && !req.file.mimetype.startsWith('image/')) {
    return res.status(400).json({ error: 'Only image files are allowed here' });
  }
  const { error } = await supabase.from('supporting_files').insert({
    site_id: req.params.siteId,
    category,
    filename: req.file.originalname,
    mime_type: req.file.mimetype,
    file_size: req.file.size,
    file_data: req.file.buffer.toString('base64'),
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.get('/api/sites/:siteId/files/:fileId', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('supporting_files')
    .select('filename, mime_type, file_data')
    .eq('id', req.params.fileId)
    .eq('site_id', req.params.siteId)
    .single();
  if (error || !data) return res.status(404).json({ error: 'File not found' });
  res.set('Content-Type', data.mime_type);
  res.set('Content-Disposition', `inline; filename="${encodeURIComponent(data.filename)}"`);
  res.send(Buffer.from(data.file_data, 'base64'));
});

app.delete('/api/sites/:siteId/files/:fileId', requireAuth, async (req, res) => {
  const { error } = await supabase
    .from('supporting_files')
    .delete()
    .eq('id', req.params.fileId)
    .eq('site_id', req.params.siteId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ---------- Version history ----------
// Saves a full, named snapshot of a site's data at a point in time. Restoring
// overwrites the site's current data with that snapshot (the site itself,
// discussion, and version list are untouched).
app.get('/api/sites/:siteId/versions', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('site_versions')
    .select('id, label, created_at')
    .eq('site_id', req.params.siteId)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/sites/:siteId/versions', requireAuth, async (req, res) => {
  const { label } = req.body || {};
  if (!label || !label.trim()) return res.status(400).json({ error: 'A version label is required' });
  const { data: site, error: siteErr } = await supabase
    .from('sites')
    .select('data')
    .eq('id', req.params.siteId)
    .single();
  if (siteErr || !site) return res.status(404).json({ error: 'Site not found' });
  const { error } = await supabase.from('site_versions').insert({
    site_id: req.params.siteId,
    label: label.trim(),
    data: site.data,
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.post('/api/sites/:siteId/versions/:versionId/restore', requireAuth, async (req, res) => {
  const { data: version, error: verErr } = await supabase
    .from('site_versions')
    .select('data')
    .eq('id', req.params.versionId)
    .eq('site_id', req.params.siteId)
    .single();
  if (verErr || !version) return res.status(404).json({ error: 'Version not found' });
  const { data: updated, error } = await supabase
    .from('sites')
    .update({ data: version.data })
    .eq('id', req.params.siteId)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(updated);
});

app.delete('/api/sites/:siteId/versions/:versionId', requireAuth, async (req, res) => {
  const { error } = await supabase
    .from('site_versions')
    .delete()
    .eq('id', req.params.versionId)
    .eq('site_id', req.params.siteId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ---------- Report export (Excel & PDF) ----------
app.get('/api/sites/:id/export/excel', requireAuth, async (req, res) => {
  const { data: site, error } = await withRetry(() => supabase.from('sites').select('*').eq('id', req.params.id).single());
  if (error || !site) return res.status(404).json({ error: 'Site not found' });
  const computed = computeAll(site.data);
  const buffer = await buildExcelReport(site, computed);
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(site.name)}-tender-report.xlsx"`);
  res.send(Buffer.from(buffer));
});

app.get('/api/sites/:id/export/pdf', requireAuth, async (req, res) => {
  const { data: site, error } = await withRetry(() => supabase.from('sites').select('*').eq('id', req.params.id).single());
  if (error || !site) return res.status(404).json({ error: 'Site not found' });
  const computed = computeAll(site.data);
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(site.name)}-tender-report.pdf"`);
  buildPdfReport(site, computed, res);
});

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
  const status = err.status || (err.name === 'MulterError' ? 400 : 500);
  res.status(status).json({ error: err.message || 'Something went wrong' });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Newborn Screening Malaysia tender app listening on port ${PORT}`);
});
