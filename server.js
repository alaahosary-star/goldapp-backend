require('dotenv').config();
const express = require('express');
const cors = require('cors');

const goldService = require('./services/goldService');
const currencyService = require('./services/currencyService');
const newsService = require('./services/newsService');

const app = express();
app.use(cors());
app.use(express.json());

// ============ GOLD ============

app.get('/api/gold/price', async (req, res) => {
  const data = await goldService.fetchGoldPrice();
  res.status(data.success ? 200 : 502).json(data);
});

app.get('/api/gold/local', async (req, res) => {
  const currency = (req.query.currency || 'EGP').toUpperCase();
  const data = await goldService.getLocalPrices(currency);
  res.status(data.success ? 200 : 502).json(data);
});

// ============ CURRENCY ============

app.get('/api/currency/rates', async (req, res) => {
  const base = (req.query.base || 'USD').toUpperCase();
  const data = await currencyService.getRates(base);
  res.status(data.success ? 200 : 502).json(data);
});

app.post('/api/currency/convert', async (req, res) => {
  const { from, to, amount } = req.body;
  if (!from || !to || !amount) {
    return res.status(400).json({ success: false, error: 'from, to, amount required' });
  }
  const data = await currencyService.convert(from.toUpperCase(), to.toUpperCase(), parseFloat(amount));
  res.status(data.success ? 200 : 502).json(data);
});

// ============ NEWS ============

app.get('/api/news', async (req, res) => {
  const category = req.query.category || 'gold';
  const lang = req.query.lang || 'ar';
  const data = await newsService.getArticles(category, lang);
  res.status(data.success ? 200 : 502).json(data);
});

// ============ HEALTH ============

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============ START ============

const PORT = process.env.PORT || 8000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend running on http://0.0.0.0:${PORT}`);
});
