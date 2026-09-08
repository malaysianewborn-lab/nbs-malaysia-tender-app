// Newborn Screening Malaysia — Tendering Cost Estimator
// Express server: serves the front-end, gates access behind a shared
// password, and proxies all data access to Supabase using the SERVICE
// ROLE key (kept server-side only — the browser never sees it).

const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieSession = require('cookie-session');
const { createClient } = require('@supabase/supabase-js');

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
// TEMPORARY diagnostic route — safe to leave in briefly, remove once login is confirmed working.
// Shows exactly what Express sees re: protocol/proxy headers, with no secrets exposed.
app.get('/api/debug-proxy', (req, res) => {
  res.json({
    protocol: req.protocol,
    secure: req.secure,
    xForwardedProto: req.headers['x-forwarded-proto'] || null,
    host: req.headers['host'] || null,
    nodeEnv: process.env.NODE_ENV || null,
  });
});
// TEMPORARY diagnostic — reveals only the LENGTH and JSON-escaped char codes of the
// stored password (never the value itself), to catch invisible characters like a
// trailing newline from a copy-paste. Remove once login is confirmed working.
app.get('/api/debug-password-check', (req, res) => {
  const pw = APP_SHARED_PASSWORD || '';
  res.json({
    length: pw.length,
    charCodes: Array.from(pw).map((c) => c.charCodeAt(0)),
  });
});
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

// ---------- Static front-end ----------
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Newborn Screening Malaysia tender app listening on port ${PORT}`);
});
