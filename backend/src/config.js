const config = {
  instanceId: process.env.INSTANCE_ID || 'backend-unknown',
  port: parseInt(process.env.PORT, 10) || 8080,
  redisHost: process.env.REDIS_HOST || 'redis',
  redisPort: parseInt(process.env.REDIS_PORT, 10) || 6379,
  algorithm: process.env.RATE_LIMIT_ALGORITHM || 'FIXED_WINDOW',
  limit: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 10,
  windowSeconds: parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS, 10) || 10,
  tokenRefillRate: parseFloat(process.env.RATE_LIMIT_REFILL_PER_SEC) || 1.0,
  redisFailureMode: process.env.REDIS_FAILURE_MODE || 'fail_open',
};

module.exports = config;
