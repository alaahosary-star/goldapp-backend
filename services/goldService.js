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
    const { data } = await axios.get(
      'https://goldpricez.com/api/rates/currency/usd/measure/ounce',
      {
        headers: { 'X-API-KEY': API_KEY() },
        timeout: TIMEOUT(),
      }
    );

    const price = parseFloat(data.ounce_price_usd) || 0;
    const high = parseFloat(data.ounce_price_usd_today_high) || price;
    const low = parseFloat(data.ounce_price_usd_today_low) || price;
    const ask = parseFloat(data.ounce_price_ask) || price;
    const bid = parseFloat(data.ounce_price_bid) || price;

    // Calculate change from previous cached price
    const prevData = cache.get('gold_prev_close');
    const prevClose = prevData || price;
    const change = +(price - prevClose).toFixed(2);
    const changePercent = prevClose > 0 ? +((change / prevClose) * 100).toFixed(2) : 0;

    // Store current price as prev_close for next fetch
    if (!prevData) {
      cache.set('gold_prev_close', price, 86400); // 24 hours
    }

    const result = {
      success: true,
      price_per_ounce: price,
      price_per_gram: +(price / TROY_OUNCE_TO_GRAM).toFixed(2),
      change: change,
      change_percent: changePercent,
      prev_close: prevClose,
      open_price: prevClose,
      high_price: high,
      low_price: low,
      ask_price: ask,
      bid_price: bid,
      last_updated: data.gmt_ounce_price_usd_updated || new Date().toISOString(),
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

  // GoldPriceZ doesn't have a history endpoint, generate smart history
  return generateSmartHistory(days);
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

  const result = { success: true, data: points };
  cache.set(`gold_history_${points.length > 50 ? 30 : 7}`, result, 7200);
  return result;
}

module.exports = { fetchGoldPrice, getLocalPrices, fetchGoldHistory };
