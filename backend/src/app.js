const express = require('express');
const cors = require('cors');
const config = require('./config');
const RedisClient = require('./redisClient');
const { makeLimiter } = require('./algorithms');
const Metrics = require('./metrics');

async function main() {
  const metrics = new Metrics();

  console.log(
    `[${config.instanceId}] starting on port ${config.port}` +
      ` | algorithm=${config.algorithm}` +
      ` | redis=${config.redisHost}:${config.redisPort}` +
      ` | failure_mode=${config.redisFailureMode}`
  );

  const redis = new RedisClient(config.redisHost, config.redisPort);

  // Wait for Redis connection before loading Lua scripts
  await new Promise((resolve) => {
    if (redis.isConnected()) return resolve();
    const onReady = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      redis.client.removeListener('ready', onReady);
      resolve();
    }, 5000);
    redis.client.once('ready', onReady);
  });

  const limiter = await makeLimiter(
    redis,
    config.algorithm,
    config.limit,
    config.windowSeconds,
    config.tokenRefillRate
  );

  metrics.initAlgorithm(config.instanceId, limiter.name());

  const app = express();

  // Requests arrive via the NGINX reverse proxy (see nginx.conf), which sets
  // X-Forwarded-For. Trusting one hop makes req.ip resolve to the real client
  // address instead of NGINX's own container IP — otherwise every client
  // falling back to IP-based keying (no ?user= param) would share one bucket.
  app.set('trust proxy', 1);

  app.use(
    cors({
      origin: '*',
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['*'],
      exposedHeaders: [
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
        'X-Backend-Instance',
        'X-RateLimit-Degraded',
      ],
      optionsSuccessStatus: 200,
    })
  );

  app.get('/api/hello', (_req, res) => {
    res.json({ message: `hello from ${config.instanceId}` });
  });

  app.get('/api/status', (_req, res) => {
    res.json({
      instance: config.instanceId,
      algorithm: config.algorithm,
      limit: config.limit,
      window_seconds: config.windowSeconds,
      refill_per_sec: config.tokenRefillRate,
      redis_connected: redis.isConnected(),
      total_requests: metrics.total(),
      allowed_requests: metrics.allowed(),
      blocked_requests: metrics.blocked(),
    });
  });

  app.get('/health', async (_req, res) => {
    const connected = await redis.ping();
    const status = connected ? 200 : 503;
    res.status(status).json({
      instance: config.instanceId,
      redis_connected: connected,
    });
  });

  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', 'text/plain');
    res.send(await metrics.render());
  });

  app.get('/api/limited', async (req, res) => {
    const start = process.hrtime.bigint();

    metrics.incActive(config.instanceId);
    metrics.incTotal(config.instanceId);

    const user = req.query.user || req.ip;
    const key = `rl:${user}`;

    let result = await limiter.check(key);

    if (result.redis_error) {
      metrics.incRedisError(config.instanceId);

      if (config.redisFailureMode === 'fail_open') {
        res.set('X-RateLimit-Degraded', 'redis_unreachable_fail_open');
        result.allowed = true;
        result.remaining = -1;
        result.reset_seconds = 0;
      } else {
        res.set('X-RateLimit-Degraded', 'redis_unreachable_fail_closed');
        result.allowed = false;
      }
    }

    res.set('X-RateLimit-Limit', String(result.limit));
    res.set('X-RateLimit-Remaining', String(result.remaining));
    res.set('X-RateLimit-Reset', String(result.reset_seconds));
    res.set('X-Backend-Instance', config.instanceId);

    if (result.allowed) {
      metrics.incAllowed(config.instanceId);
      res.status(200).json({
        status: 'ok',
        instance: config.instanceId,
        key: user,
      });
    } else {
      metrics.incBlocked(config.instanceId);
      res.status(429).json({
        status: 'rate_limited',
        instance: config.instanceId,
        key: user,
        retry_after_seconds: result.reset_seconds,
      });
    }

    metrics.incStatus(config.instanceId, res.statusCode);
    const end = process.hrtime.bigint();
    const ms = Number(end - start) / 1_000_000;
    metrics.observeLatency(config.instanceId, ms);
    metrics.decActive(config.instanceId);
  });

  app.listen(config.port, '0.0.0.0', () => {
    console.log(`[${config.instanceId}] listening on 0.0.0.0:${config.port}`);
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
