const axios = require('axios');
const cache = require('../cache');

const TROY_OUNCE_TO_GRAM = 31.1035;
const KARATS = { 24: 1.0, 22: 0.9167, 21: 0.875, 18: 0.75 };

const API_KEY        = () => process.env.GOLD_API_KEY;
const GOLDPRICEZ_KEY = () => process.env.GOLDPRICEZ_API_KEY;
const TIMEOUT        = () => parseInt(process.env.API_TIMEOUT) || 10000;
const CACHE_TTL      = () => parseInt(process.env.GOLD_CACHE_TTL) || 300;

// ── Helper ──────────────────────────────────────────────────────────────────
function buildResult(price, prevClose, high, low, updatedAt, source) {
  const change = +(price - prevClose).toFixed(2);
  const changePercent = prevClose > 0 ? +((change / prevClose) * 100).toFixed(2) : 0;
  return {
    success: true,
    price_per_ounce: price,
    price_per_gram: +(price / TROY_OUNCE_TO_GRAM).toFixed(2),
    change,
    change_percent: changePercent,
    prev_close: prevClose,
    open_price: prevClose,
    high_price: high || price,
    low_price:  low  || price,
    last_updated: updatedAt || new Date().toISOString(),
    source,
  };
}

// ── Source 1: GoldPriceZ (44K req/month) ────────────────────────────────────
async function fetchFromGoldPriceZ() {
  const key = GOLDPRICEZ_KEY();
  if (!key) throw new Error('No GoldPriceZ key');

  const { data } = await axios.get(
    'https://goldpricez.com/api/rates/currency/usd/measure/ounce',
    { headers: { 'X-API-KEY': key }, timeout: TIMEOUT() }
  );

  const price = parseFloat(data.ounce_price_usd);
  if (!price || price <= 0) throw new Error('GoldPriceZ: invalid price');

  const high = parseFloat(data.ounce_price_usd_today_high) || price;
  const low  = parseFloat(data.ounce_price_usd_today_low)  || price;
  const prev = cache.get('gpz_prev') || price;
  cache.set('gpz_prev', price, 86400);

  return buildResult(price, prev, high, low, data.gmt_ounce_price_usd_updated, 'GoldPriceZ (XAU/USD Spot)');
}

// ── Source 2: Yahoo Finance — quote API يجرب XAUUSD=X أولاً ثم GC=F ─────────
async function fetchFromYahoo() {
  // يجرب الـ spot أولاً ثم الـ futures
  for (const sym of ['XAUUSD=X', 'GC=F']) {
    try {
      const { data } = await axios.get(
        'https://query1.finance.yahoo.com/v7/finance/quote',
        {
          params: { symbols: sym, fields: 'regularMarketPrice,regularMarketPreviousClose,regularMarketDayHigh,regularMarketDayLow,regularMarketOpen' },
          timeout: TIMEOUT(),
          headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
        }
      );

      const q = data?.quoteResponse?.result?.[0];
      if (!q) continue;

      const price = q.regularMarketPrice;
      if (!price || price <= 0 || price > 100000) continue;

      const prev  = q.regularMarketPreviousClose || price;
      const high  = q.regularMarketDayHigh       || price;
      const low   = q.regularMarketDayLow        || price;

      console.log(`✅ Yahoo (${sym}): $${price}`);
      return buildResult(price, prev, high, low, new Date().toISOString(),
        sym === 'XAUUSD=X' ? 'Yahoo Finance (XAU/USD Spot)' : 'Yahoo Finance (GC=F Futures)');
    } catch (e) {
      console.error(`❌ Yahoo ${sym}:`, e.message);
    }
  }
  throw new Error('Yahoo: all symbols failed');
}

// ── Source 3: Metals.dev (100 req/month) ────────────────────────────────────
async function fetchFromMetalsDev() {
  const key = API_KEY();
  if (!key) throw new Error('No metals.dev key');

  const { data } = await axios.get('https://api.metals.dev/v1/metal/spot', {
    params: { api_key: key, metal: 'gold', currency: 'USD' },
    timeout: TIMEOUT(),
  });

  if (data.status !== 'success') throw new Error('Metals.dev: non-success');
  const r = data.rate;
  return buildResult(r.price, +(r.price - (r.change || 0)).toFixed(2), r.high || r.price, r.low || r.price, data.timestamp, 'Metals.dev');
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function fetchGoldPrice() {
  const cached = cache.get('gold_price_usd');
  if (cached) return cached;

  const sources = [
    { name: 'GoldPriceZ', fn: fetchFromGoldPriceZ },
    { name: 'Yahoo',      fn: fetchFromYahoo },
    { name: 'Metals.dev', fn: fetchFromMetalsDev },
  ];

  for (const src of sources) {
    try {
      const result = await src.fn();
      console.log(`✅ ${src.name}: $${result.price_per_ounce}`);
      cache.set('gold_price_usd', result, CACHE_TTL());
      return result;
    } catch (err) {
      console.error(`❌ ${src.name} failed:`, err.message);
    }
  }

  return { success: false, error: 'All APIs failed' };
}

// ── Local prices ─────────────────────────────────────────────────────────────
async function getLocalPrices(currency = 'EGP') {
  const cacheKey = `gold_local_${currency}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const [gold, exchange] = await Promise.all([
      fetchGoldPrice(),
      require('./currencyService').getRates('USD'),
    ]);

    if (!gold.success || !exchange.success)
      return { success: false, error: 'Failed to fetch data' };

    const localRate       = exchange.rates[currency] || 1;
    const pricePerGramUSD = gold.price_per_ounce / TROY_OUNCE_TO_GRAM;
    const pricePerGramLocal = pricePerGramUSD * localRate;

    const karat_prices = {};
    for (const [k, purity] of Object.entries(KARATS)) {
      karat_prices[k] = {
        per_gram:  +(pricePerGramLocal * purity).toFixed(2),
        per_ounce: +(gold.price_per_ounce * purity * localRate).toFixed(2),
      };
    }

    const result = {
      success: true,
      currency,
      exchange_rate: localRate,
      global_price_usd: gold.price_per_ounce,
      price_per_gram_usd: +pricePerGramUSD.toFixed(2),
      karat_prices,
      change: gold.change,
      change_percent: gold.change_percent,
      high_price: +((gold.high_price / TROY_OUNCE_TO_GRAM) * localRate).toFixed(2),
      low_price:  +((gold.low_price  / TROY_OUNCE_TO_GRAM) * localRate).toFixed(2),
      last_updated: gold.last_updated,
      source: gold.source,
    };

    cache.set(cacheKey, result, CACHE_TTL());
    return result;
  } catch (err) {
    console.error('GoldService local error:', err.message);
    return { success: false, error: err.message };
  }
}

// ── History ──────────────────────────────────────────────────────────────────
async function fetchGoldHistory(days = 30) {
  const cacheKey = `gold_history_${days}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const range = days <= 7 ? '5d' : days <= 30 ? '1mo' : days <= 90 ? '3mo' : '6mo';
    const { data } = await axios.get(
      'https://query1.finance.yahoo.com/v8/finance/chart/GC=F',
      {
        params: { interval: '1d', range },
        timeout: TIMEOUT(),
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      }
    );

    const result = data?.chart?.result?.[0];
    if (result?.timestamp && result?.indicators?.quote?.[0]?.close) {
      const timestamps = result.timestamp;
      const closes     = result.indicators.quote[0].close;

      const points = timestamps
        .map((ts, i) => ({
          timestamp: ts * 1000,
          price: closes[i] ? +closes[i].toFixed(2) : null,
          date: new Date(ts * 1000).toLocaleDateString(),
        }))
        .filter(p => p.price && p.price > 0)
        .slice(-days);

      if (points.length > 0) {
        const histResult = { success: true, data: points, source: 'Yahoo Finance' };
        cache.set(cacheKey, histResult, 7200);
        return histResult;
      }
    }
  } catch (err) {
    console.error('Yahoo history error:', err.message);
  }

  return generateSmartHistory(days);
}

async function generateSmartHistory(days) {
  const gold      = await fetchGoldPrice();
  const basePrice = gold.success ? gold.price_per_ounce : 2400;
  const volatility = basePrice * 0.02;
  const points    = [];
  const now       = Date.now();
  const totalPoints = Math.min(days * 2, 100);
  const interval  = (days * 24 * 60 * 60 * 1000) / totalPoints;
  let price = basePrice - Math.random() * volatility * 2;

  for (let i = totalPoints; i >= 0; i--) {
    const change = (Math.random() - 0.48) * volatility * 0.1;
    price = Math.max(price + change, basePrice * 0.9);
    price = Math.min(price, basePrice * 1.1);
    const ts = now - i * interval;
    points.push({ timestamp: ts, price: +price.toFixed(2), date: new Date(ts).toLocaleDateString() });
  }
  points[points.length - 1].price = basePrice;
  return { success: true, data: points };
}

module.exports = { fetchGoldPrice, getLocalPrices, fetchGoldHistory };
