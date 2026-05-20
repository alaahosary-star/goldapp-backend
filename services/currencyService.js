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

module.exports = { getRates, convert };
