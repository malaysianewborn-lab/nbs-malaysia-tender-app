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

const app = express();
app.set('trust proxy', true); // Render's proxy chain — trust all hops so req.secure reflects the real (HTTPS) client connection
app.use(cors());
app.use(express.json({ limit: '2mb' }));
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
  const { data, error } = await supabase
    .from('sites')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(404).json({ error: error.message });
  res.json(data);
});

app.put('/api/sites/:id', requireAuth, async (req, res) => {
  const { name, data: newData } = req.body || {};
  const patch = {};
  if (typeof name === 'string' && name.trim()) patch.name = name.trim();
  if (newData !== undefined) patch.data = newData;
  const { data, error } = await supabase
    .from('sites')
    .update(patch)
    .eq('id', req.params.id)
    .select()
    .single();
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
const VALID_CATEGORIES = ['tender_spec', 'image', 'supporting_doc'];

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
  if (category === 'image' && !req.file.mimetype.startsWith('image/')) {
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
