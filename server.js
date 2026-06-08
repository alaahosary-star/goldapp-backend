require('dotenv').config();
const express = require('express');
const cors = require('cors');

const goldService = require('./services/goldService');
const currencyService = require('./services/currencyService');
const newsService = require('./services/newsService');

const app = express();

// ── CORS — restrict to the mobile app + localhost dev ────────────────────────
const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    // Mobile apps send no Origin header — allow
    if (!origin) return cb(null, true);
    if (allowedOrigins.length === 0) return cb(null, true); // no list = allow all (dev)
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('CORS blocked'));
  },
}));

app.use(express.json({ limit: '16kb' }));

// ── Simple rate limiter (per-IP, in-memory) ─────────────────────────────────
const rateLimitMap = new Map();
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT) || 120; // requests per window
const RATE_WINDOW = 60_000; // 1 minute
app.use((req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW) {
    entry = { start: now, count: 0 };
    rateLimitMap.set(ip, entry);
  }
  entry.count++;
  if (entry.count > RATE_LIMIT) {
    return res.status(429).json({ success: false, error: 'Too many requests' });
  }
  next();
});

// ── Validation helpers ──────────────────────────────────────────────────────
const VALID_CURRENCY = /^[A-Z]{3}$/;
const VALID_CATEGORY = ['gold', 'silver', 'currency', 'economy', 'business'];
const VALID_LANG = ['ar', 'en'];

// ── Route wrapper — catches unhandled errors ────────────────────────────────
const safe = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ============ GOLD ============

app.get('/api/gold/price', safe(async (req, res) => {
  const data = await goldService.fetchGoldPrice();
  res.status(data.success ? 200 : 502).json(data);
}));

app.get('/api/gold/local', safe(async (req, res) => {
  const currency = (req.query.currency || 'EGP').toUpperCase();
  if (!VALID_CURRENCY.test(currency)) {
    return res.status(400).json({ success: false, error: 'Invalid currency code' });
  }
  const data = await goldService.getLocalPrices(currency);
  res.status(data.success ? 200 : 502).json(data);
}));

app.get('/api/gold/history', safe(async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365);
  const data = await goldService.fetchGoldHistory(days);
  res.status(data.success ? 200 : 502).json(data);
}));

// ============ SILVER ============

app.get('/api/silver/price', safe(async (req, res) => {
  const data = await goldService.fetchSilverPrice();
  res.status(data.success ? 200 : 502).json(data);
}));

// ============ CURRENCY ============

app.get('/api/currency/rates', safe(async (req, res) => {
  const base = (req.query.base || 'USD').toUpperCase();
  if (!VALID_CURRENCY.test(base)) {
    return res.status(400).json({ success: false, error: 'Invalid currency code' });
  }
  const data = await currencyService.getRates(base);
  res.status(data.success ? 200 : 502).json(data);
}));

app.get('/api/currency/history', safe(async (req, res) => {
  const currency = (req.query.currency || 'EGP').toUpperCase();
  if (!VALID_CURRENCY.test(currency)) {
    return res.status(400).json({ success: false, error: 'Invalid currency code' });
  }
  const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365);
  const data = await currencyService.getHistory(currency, days);
  res.status(data.success ? 200 : 502).json(data);
}));

app.post('/api/currency/convert', safe(async (req, res) => {
  const { from, to, amount } = req.body;
  if (!from || !to || !amount) {
    return res.status(400).json({ success: false, error: 'from, to, amount required' });
  }
  const f = String(from).toUpperCase();
  const t = String(to).toUpperCase();
  const a = parseFloat(amount);
  if (!VALID_CURRENCY.test(f) || !VALID_CURRENCY.test(t) || isNaN(a) || a <= 0 || a > 1e12) {
    return res.status(400).json({ success: false, error: 'Invalid parameters' });
  }
  const data = await currencyService.convert(f, t, a);
  res.status(data.success ? 200 : 502).json(data);
}));

// ============ NEWS ============

app.get('/api/news', safe(async (req, res) => {
  const category = VALID_CATEGORY.includes(req.query.category) ? req.query.category : 'gold';
  const lang = VALID_LANG.includes(req.query.lang) ? req.query.lang : 'ar';
  const data = await newsService.getArticles(category, lang);
  res.status(data.success ? 200 : 502).json(data);
}));

// ============ HEALTH ============

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Global error handler — never leak stack traces ──────────────────────────
app.use((err, req, res, _next) => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path} — ${err.message}`);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// ============ START ============

const PORT = process.env.PORT || 8000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend running on port ${PORT}`);
});
