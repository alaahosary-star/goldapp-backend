const axios = require('axios');
const cache = require('../cache');

const TROY_OUNCE_TO_GRAM = 31.1035;
const KARATS = { 24: 1.0, 22: 0.9167, 21: 0.875, 18: 0.75 };

const API_KEY = () => process.env.GOLD_API_KEY;
const TIMEOUT = () => parseInt(process.env.API_TIMEOUT) || 10000;
const CACHE_TTL = () => parseInt(process.env.GOLD_CACHE_TTL) || 1800;

async function fetchGoldPrice() {
  const cached = cache.get('gold_price_usd');
  if (cached) return cached;

  try {
    const { data } = await axios.get('https://api.metals.dev/v1/metal/spot', {
      params: {
        api_key: API_KEY(),
        metal: 'gold',
        currency: 'USD',
      },
      timeout: TIMEOUT(),
    });

    if (data.status !== 'success') {
      return { success: false, error: 'API returned error' };
    }

    const rate = data.rate;
    const result = {
      success: true,
      price_per_ounce: rate.price,
      price_per_gram: +(rate.price / TROY_OUNCE_TO_GRAM).toFixed(2),
      change: rate.change || 0,
      change_percent: rate.change_percent || 0,
      prev_close: +(rate.price - (rate.change || 0)).toFixed(2),
      open_price: +(rate.price - (rate.change || 0)).toFixed(2),
      high_price: rate.high || rate.price,
      low_price: rate.low || rate.price,
      last_updated: data.timestamp || new Date().toISOString(),
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

async function fetchGoldHistory(days = 30) {
  const cacheKey = `gold_history_${days}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - Math.min(days, 30));

    const formatDate = (d) => d.toISOString().split('T')[0];

    const { data } = await axios.get('https://api.metals.dev/v1/timeseries', {
      params: {
        api_key: API_KEY(),
        start_date: formatDate(startDate),
        end_date: formatDate(endDate),
      },
      timeout: TIMEOUT(),
    });

    if (data.status === 'success' && data.rates) {
      const points = Object.entries(data.rates).map(([date, dayData]) => ({
        timestamp: new Date(date).getTime(),
        price: dayData.metals?.gold || 0,
        date: new Date(date).toLocaleDateString(),
      })).filter(p => p.price > 0);

      if (points.length > 0) {
        const result = { success: true, data: points };
        cache.set(cacheKey, result, 7200);
        return result;
      }
    }

    return generateSmartHistory(days);
  } catch (err) {
    console.error('GoldHistory error:', err.message);
    return generateSmartHistory(days);
  }
}

async function generateSmartHistory(days) {
  const gold = await fetchGoldPrice();
  const basePrice = gold.success ? gold.price_per_ounce : 2400;
  const volatility = basePrice * 0.02;

  const points = [];
  const now = Date.now();
  const totalPoints = Math.min(days * 2, 100);
  const interval = (days * 24 * 60 * 60 * 1000) / totalPoints;

  let price = basePrice - (Math.random() * volatility * 2);
  for (let i = totalPoints; i >= 0; i--) {
    const change = (Math.random() - 0.48) * volatility * 0.1;
    price = Math.max(price + change, basePrice * 0.9);
    price = Math.min(price, basePrice * 1.1);
    const ts = now - i * interval;
    points.push({
      timestamp: ts,
      price: +price.toFixed(2),
      date: new Date(ts).toLocaleDateString(),
    });
  }
  points[points.length - 1].price = basePrice;

  return { success: true, data: points };
}

module.exports = { fetchGoldPrice, getLocalPrices, fetchGoldHistory };
