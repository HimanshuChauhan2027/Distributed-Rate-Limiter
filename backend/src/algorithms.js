const fs = require('fs');
const path = require('path');
const { createResult } = require('./rateLimiter');

function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`Could not open script file: ${filePath}`);
  }
}

function nowMs() {
  return Date.now();
}

// The Dockerfile copies redis/scripts to /app/redis/scripts, so that path
// is used when present. Outside the container (local dev, tests run
// directly with `node`), fall back to the scripts directory relative to
// this file's location in the repo. REDIS_SCRIPTS_DIR overrides both.
function resolveScriptsDir() {
  if (process.env.REDIS_SCRIPTS_DIR) return process.env.REDIS_SCRIPTS_DIR;
  const dockerPath = '/app/redis/scripts';
  if (fs.existsSync(dockerPath)) return dockerPath;
  return path.join(__dirname, '..', '..', 'redis', 'scripts');
}

const SCRIPTS_DIR = resolveScriptsDir();

// ─── Base Class ──────────────────────────────────────────────────────────────

class ScriptBackedLimiter {
  constructor(redisClient, scriptPath) {
    this.redis = redisClient;
    this.scriptSource = readFile(scriptPath);
    this.sha = '';
  }

  async init() {
    this.sha = await this.redis.loadScript(this.scriptSource);
  }

  /**
   * Execute the cached Lua script via EVALSHA.
   * If EVALSHA fails (e.g. NOSCRIPT after Redis restart),
   * reloads the script and retries once.
   */
  async runScript(key, argv) {
    if (!this.sha) {
      this.sha = await this.redis.loadScript(this.scriptSource);
    }

    let result = await this.redis.evalSha(this.sha, [key], argv);

    if (!result.ok && this.scriptSource) {
      this.sha = await this.redis.loadScript(this.scriptSource);
      if (this.sha) {
        result = await this.redis.evalSha(this.sha, [key], argv);
      }
    }

    return result;
  }
}

// ─── Fixed Window ────────────────────────────────────────────────────────────

class FixedWindowLimiter extends ScriptBackedLimiter {
  constructor(redisClient, limit, windowSeconds) {
    super(redisClient, path.join(SCRIPTS_DIR, 'fixed_window.lua'));
    this._limit = limit;
    this._window = windowSeconds;
  }

  name() {
    return 'FIXED_WINDOW';
  }

  async check(key) {
    const out = createResult();
    out.limit = this._limit;

    const r = await this.runScript(key, [
      String(this._limit),
      String(this._window),
    ]);

    if (!r.ok || r.values.length < 3) {
      out.redis_error = true;
      return out;
    }

    out.allowed = r.values[0] === 1;
    out.remaining = r.values[1];
    out.reset_seconds = r.values[2];
    return out;
  }
}

// ─── Sliding Window Log ──────────────────────────────────────────────────────

class SlidingWindowLimiter extends ScriptBackedLimiter {
  constructor(redisClient, limit, windowSeconds) {
    super(redisClient, path.join(SCRIPTS_DIR, 'sliding_window.lua'));
    this._limit = limit;
    this._window = windowSeconds;
  }

  name() {
    return 'SLIDING_WINDOW';
  }

  async check(key) {
    const out = createResult();
    out.limit = this._limit;

    const r = await this.runScript(key, [
      String(this._limit),
      String(this._window),
      String(nowMs()),
    ]);

    if (!r.ok || r.values.length < 3) {
      out.redis_error = true;
      return out;
    }

    out.allowed = r.values[0] === 1;
    out.remaining = r.values[1];
    out.reset_seconds = r.values[2];
    return out;
  }
}

// ─── Token Bucket ────────────────────────────────────────────────────────────

class TokenBucketLimiter extends ScriptBackedLimiter {
  constructor(redisClient, capacity, refillRate) {
    super(redisClient, path.join(SCRIPTS_DIR, 'token_bucket.lua'));
    this._capacity = capacity;
    this._refillRate = refillRate;
  }

  name() {
    return 'TOKEN_BUCKET';
  }

  async check(key) {
    const out = createResult();
    out.limit = this._capacity;

    const r = await this.runScript(key, [
      String(this._capacity),
      String(this._refillRate),
      String(nowMs()),
    ]);

    if (!r.ok || r.values.length < 3) {
      out.redis_error = true;
      return out;
    }

    out.allowed = r.values[0] === 1;
    out.remaining = r.values[1];
    out.reset_seconds = r.values[2];
    return out;
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

async function makeLimiter(redisClient, algorithm, limit, windowSeconds, refillRate) {
  let limiter;

  if (algorithm === 'SLIDING_WINDOW') {
    limiter = new SlidingWindowLimiter(redisClient, limit, windowSeconds);
  } else if (algorithm === 'TOKEN_BUCKET') {
    limiter = new TokenBucketLimiter(redisClient, limit, refillRate);
  } else {
    limiter = new FixedWindowLimiter(redisClient, limit, windowSeconds);
  }

  await limiter.init();
  return limiter;
}

module.exports = {
  makeLimiter,
  FixedWindowLimiter,
  SlidingWindowLimiter,
  TokenBucketLimiter,
  nowMs,
};
