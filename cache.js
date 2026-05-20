const NodeCache = require('node-cache');

// Default TTL 300s, check expired keys every 60s
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

module.exports = cache;
