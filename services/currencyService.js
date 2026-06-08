const axios = require('axios');
const cache = require('../cache');

const TIMEOUT = () => parseInt(process.env.API_TIMEOUT) || 10000;
const CACHE_TTL = () => parseInt(process.env.CURRENCY_CACHE_TTL) || 600;

async function getRates(base = 'USD') {
  const cacheKey = `exchange_rates_${base}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const { data } = await axios.get(`https://open.er-api.com/v6/latest/${base}`, {
      timeout: TIMEOUT(),
    });

    if (data.result === 'success') {
      const result = {
        success: true,
        base: data.base_code,
        rates: data.rates,
        last_updated: data.time_last_update_utc || new Date().toISOString(),
      };
      cache.set(cacheKey, result, CACHE_TTL());
      return result;
    }

    return { success: false, error: 'API returned error' };
  } catch (err) {
    console.error('CurrencyService error:', err.message);
    return { success: false, error: err.message };
  }
}

// Exchange-rate history of USD vs `currency` (e.g. EGP=X => how many EGP per 1 USD).
// Supports intraday (hourly) for days<=1.
async function getHistory(currency = 'EGP', days = 30) {
  currency = String(currency).toUpperCase();
  const cacheKey = `currency_history_${currency}_${days}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  // USD vs USD is always 1 — no meaningful chart.
  if (currency === 'USD') {
    return { success: false, error: 'No history for USD/USD' };
  }

  const intraday = days <= 1;
  const interval = intraday ? '60m' : '1d';
  const range = intraday
    ? '5d'
    : days <= 7 ? '5d' : days <= 30 ? '1mo' : days <= 90 ? '3mo' : '6mo';

  try {
    const { data } = await axios.get(
      `https://query1.finance.yahoo.com/v8/finance/chart/${currency}=X`,
      {
        params: { interval, range },
        timeout: TIMEOUT(),
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      }
    );

    const result = data?.chart?.result?.[0];
    if (result?.timestamp && result?.indicators?.quote?.[0]?.close) {
      const timestamps = result.timestamp;
      const closes = result.indicators.quote[0].close;
      let points = timestamps
        .map((ts, i) => ({
          timestamp: ts * 1000,
          price: closes[i] ? +closes[i].toFixed(4) : null,
          date: new Date(ts * 1000).toLocaleDateString(),
        }))
        .filter(p => p.price && p.price > 0);

      if (intraday) {
        const last = points.length ? points[points.length - 1].timestamp : Date.now();
        points = points.filter(p => p.timestamp >= last - 24 * 60 * 60 * 1000);
      } else {
        points = points.slice(-days);
      }

      if (points.length > 1) {
        const res = { success: true, currency, data: points, source: 'Yahoo Finance' };
        cache.set(cacheKey, res, intraday ? 900 : 7200);
        return res;
      }
    }
    return { success: false, error: 'No history data' };
  } catch (err) {
    console.error('CurrencyService history error:', err.message);
    return { success: false, error: err.message };
  }
}

async function convert(from, to, amount) {
  const rates = await getRates(from);
  if (!rates.success) return { success: false, error: 'Failed to fetch rates' };

  const rate = rates.rates[to];
  if (!rate) return { success: false, error: `Rate not found for ${to}` };

  return {
    success: true,
    from, to, amount,
    rate,
    result: +(amount * rate).toFixed(4),
  };
}

module.exports = { getRates, convert, getHistory };
