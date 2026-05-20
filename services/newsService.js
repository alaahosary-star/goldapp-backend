const axios = require('axios');
const { parseStringPromise } = require('xml2js');
const cache = require('../cache');

const TIMEOUT = () => parseInt(process.env.API_TIMEOUT) || 10000;
const CACHE_TTL = () => parseInt(process.env.NEWS_CACHE_TTL) || 900;

const QUERIES = {
  gold:    { ar: 'أسعار الذهب', en: 'gold prices' },
  forex:   { ar: 'أسعار العملات', en: 'forex currency exchange rates' },
  economy: { ar: 'الاقتصاد أخبار مالية', en: 'economy financial markets' },
};

async function getArticles(category = 'gold', language = 'ar') {
  const lang = language === 'ar' ? 'ar' : 'en';
  const cacheKey = `news_${category}_${lang}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const queries = QUERIES[category] || QUERIES.gold;
    const query = encodeURIComponent(queries[lang] || queries.en);
    const hl = lang === 'ar' ? 'ar' : 'en';
    const gl = lang === 'ar' ? 'EG' : 'US';
    const ceid = lang === 'ar' ? 'EG:ar' : 'US:en';

    const url = `https://news.google.com/rss/search?q=${query}&hl=${hl}&gl=${gl}&ceid=${ceid}`;

    const { data: xml } = await axios.get(url, {
      timeout: TIMEOUT(),
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    const parsed = await parseStringPromise(xml, { explicitArray: false });
    const items = parsed?.rss?.channel?.item;
    if (!items) return { success: true, articles: [], last_updated: new Date().toISOString() };

    const itemList = Array.isArray(items) ? items : [items];

    const articles = itemList.slice(0, 20).map((item) => {
      let title = item.title || '';
      let source = '';

      // Google News format: "Title - Source"
      if (title.includes(' - ')) {
        const parts = title.split(' - ');
        source = parts.pop();
        title = parts.join(' - ');
      }

      // Try to extract image from description HTML
      let imageUrl = null;
      const desc = item.description || '';
      const imgMatch = desc.match(/<img[^>]+src=["']([^"']+)["']/);
      if (imgMatch) imageUrl = imgMatch[1];

      return {
        id: Buffer.from(item.link || `${Date.now()}`).toString('base64').slice(0, 20),
        title,
        description: desc.replace(/<[^>]*>/g, '').trim(),
        source,
        url: item.link || '',
        image_url: imageUrl,
        published_at: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      };
    });

    const result = { success: true, articles, last_updated: new Date().toISOString() };
    cache.set(cacheKey, result, CACHE_TTL());
    return result;
  } catch (err) {
    console.error('NewsService error:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { getArticles };
