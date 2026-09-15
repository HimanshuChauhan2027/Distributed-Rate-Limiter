let failures = 0;

function check(cond, desc) {
  if (!cond) {
    console.error(`FAIL: ${desc}`);
    failures++;
  } else {
    console.log(`PASS: ${desc}`);
  }
}

function test_config_defaults() {
  delete process.env.RATE_LIMIT_ALGORITHM;
  delete process.env.RATE_LIMIT_MAX_REQUESTS;
  delete process.env.REDIS_FAILURE_MODE;

  delete require.cache[require.resolve('../src/config')];
  const config = require('../src/config');

  check(config.algorithm === 'FIXED_WINDOW', 'config.algorithm === "FIXED_WINDOW"');
  check(config.limit === 10, 'config.limit === 10');
  check(config.redisFailureMode === 'fail_open', 'config.redisFailureMode === "fail_open"');
}

function test_config_env_override() {
  process.env.RATE_LIMIT_ALGORITHM = 'TOKEN_BUCKET';
  process.env.RATE_LIMIT_MAX_REQUESTS = '42';

  delete require.cache[require.resolve('../src/config')];
  const config = require('../src/config');

  check(config.algorithm === 'TOKEN_BUCKET', 'config.algorithm === "TOKEN_BUCKET"');
  check(config.limit === 42, 'config.limit === 42');

  delete process.env.RATE_LIMIT_ALGORITHM;
  delete process.env.RATE_LIMIT_MAX_REQUESTS;
}

function test_rate_limit_result_defaults() {
  const { createResult } = require('../src/rateLimiter');
  const r = createResult();

  check(r.allowed === false, 'r.allowed === false');
  check(r.redis_error === false, 'r.redis_error === false');
}

test_config_defaults();
test_config_env_override();
test_rate_limit_result_defaults();

if (failures > 0) {
  console.error(`${failures} test(s) failed`);
  process.exit(1);
}
console.log('All unit tests passed');
