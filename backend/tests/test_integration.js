const RedisClient = require('../src/redisClient');
const {
  FixedWindowLimiter,
  SlidingWindowLimiter,
  TokenBucketLimiter,
  nowMs,
} = require('../src/algorithms');

let failures = 0;

function check(cond, desc) {
  if (!cond) {
    console.error(`FAIL: ${desc}`);
    failures++;
  } else {
    console.log(`PASS: ${desc}`);
  }
}

function uniqueKey(prefix) {
  return `${prefix}_${nowMs()}`;
}

async function test_fixed_window_blocks_after_limit(redis) {
  const limiter = new FixedWindowLimiter(redis, 3, 5);
  await limiter.init();
  const key = uniqueKey('test:fixed');

  check((await limiter.check(key)).allowed === true, 'fixed: request 1 allowed');
  check((await limiter.check(key)).allowed === true, 'fixed: request 2 allowed');
  check((await limiter.check(key)).allowed === true, 'fixed: request 3 allowed');
  check((await limiter.check(key)).allowed === false, 'fixed: request 4 blocked');
}

async function test_token_bucket_allows_burst_then_throttles(redis) {
  const limiter = new TokenBucketLimiter(redis, 5, 1.0);
  await limiter.init();
  const key = uniqueKey('test:bucket');

  let allowed = 0;
  for (let i = 0; i < 6; i++) {
    if ((await limiter.check(key)).allowed) allowed++;
  }
  check(allowed === 5, `bucket: ${allowed} of 6 allowed (expected 5)`);
}

async function test_sliding_window_shared_across_instances(redis) {
  const key = uniqueKey('test:sliding:shared');
  const backend1 = new SlidingWindowLimiter(redis, 5, 10);
  const backend2 = new SlidingWindowLimiter(redis, 5, 10);
  const backend3 = new SlidingWindowLimiter(redis, 5, 10);
  await Promise.all([backend1.init(), backend2.init(), backend3.init()]);

  let allowed = 0;
  const backends = [backend1, backend2, backend3];
  for (let i = 0; i < 9; i++) {
    const b = backends[i % 3];
    if ((await b.check(key)).allowed) allowed++;
  }
  check(allowed === 5, `sliding shared: ${allowed} of 9 allowed (expected 5)`);
}

async function main() {
  delete require.cache[require.resolve('../src/config')];
  const config = require('../src/config');

  const redis = new RedisClient(config.redisHost, config.redisPort);

  await new Promise((r) => setTimeout(r, 1000));

  const connected = await redis.ping();
  if (!connected) {
    console.error(
      `SKIPPED: Redis not reachable at ${config.redisHost}:${config.redisPort}`
    );
    redis.client.disconnect();
    process.exit(0);
  }

  await test_fixed_window_blocks_after_limit(redis);
  await test_token_bucket_allows_burst_then_throttles(redis);
  await test_sliding_window_shared_across_instances(redis);

  redis.client.disconnect();

  if (failures > 0) {
    console.error(`${failures} test(s) failed`);
    process.exit(1);
  }
  console.log('All integration tests passed');
}

main().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
