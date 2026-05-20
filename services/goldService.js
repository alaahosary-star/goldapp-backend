const axios = require('axios');
const cache = require('../cache');

const TROY_OUNCE_TO_GRAM = 31.1035;
const KARATS = { 24: 1.0, 22: 0.9167, 21: 0.875, 18: 0.75 };

const API_KEY = () => process.env.GOLD_API_KEY;
const TIMEOUT = () => parseInt(process.env.API_TIMEOUT) || 10000;
const CACHE_TTL = () => parseInt(process.env.GOLD_CACHE_TTL) || 300;

async function fetchGoldPrice() {
  const cached = cache.get('gold_price_usd');
  if (cached) return cached;

  try {
    const { data } = await axios.get('https://www.goldapi.io/api/XAU/USD', {
      headers: { 'x-access-token': API_KEY(), 'Content-Type': 'application/json' },
      timeout: TIMEOUT(),
    });

    const result = {
      success: true,
      price_per_ounce: data.price,
      price_per_gram: +(data.price / TROY_OUNCE_TO_GRAM).toFixed(2),
      change: data.ch || 0,
      change_percent: data.chp || 0,
      prev_close: data.prev_close_price || 0,
      open_price: data.open_price || 0,
      high_price: data.high_price || 0,
      low_price: data.low_price || 0,
      last_updated: new Date().toISOString(),
    };

    cache.set('gold_price_usd', result, CACHE_TTL());
    return result;
  } catch (err) {
    console.error('GoldService error:', err.message);
    return { success: false, error: err.message };
  }
}

async function getLocalPrices(currency = 'EGP') {
  const cacheKey = `gold_local_${currency}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const [gold, exchange] = await Promise.all([
      fetchGoldPrice(),
      require('./currencyService').getRates('USD'),
    ]);

    if (!gold.success || !exchange.success) {
      return { success: false, error: 'Failed to fetch data' };
    }

    const localRate = exchange.rates[currency] || 1;
    const pricePerGramUSD = gold.price_per_ounce / TROY_OUNCE_TO_GRAM;
    const pricePerGramLocal = pricePerGramUSD * localRate;

    const karat_prices = {};
    for (const [k, purity] of Object.entries(KARATS)) {
      karat_prices[k] = {
        per_gram: +(pricePerGramLocal * purity).toFixed(2),
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
      low_price: +((gold.low_price / TROY_OUNCE_TO_GRAM) * localRate).toFixed(2),
      last_updated: gold.last_updated,
    };

    cache.set(cacheKey, result, CACHE_TTL());
    return result;
  } catch (err) {
    console.error('GoldService local error:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { fetchGoldPrice, getLocalPrices };
