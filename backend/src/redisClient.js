const Redis = require('ioredis');

class RedisClient {
  constructor(host, port, connectMs = 3000, commandMs = 2000) {
    this.client = new Redis({
      host,
      port,
      connectTimeout: connectMs,
      commandTimeout: commandMs,
      maxRetriesPerRequest: 1,
      retryStrategy(times) {
        return Math.min(times * 100, 3000);
      },
      lazyConnect: false,
    });

    this.client.on('error', (err) => {
      console.error('[redis] connection error:', err.message);
    });

    this.client.on('connect', () => {
      console.log('[redis] connected');
    });
  }

  isConnected() {
    return this.client.status === 'ready';
  }

  async ping() {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  async loadScript(scriptSource) {
    try {
      const sha = await this.client.script('LOAD', scriptSource);
      return sha;
    } catch (err) {
      console.error('[redis] SCRIPT LOAD error:', err.message);
      return '';
    }
  }

  async evalSha(sha, keys, argv) {
    const result = { ok: false, values: [] };
    try {
      const reply = await this.client.evalsha(
        sha,
        keys.length,
        ...keys,
        ...argv
      );
      if (Array.isArray(reply)) {
        result.ok = true;
        result.values = reply.map((v) =>
          typeof v === 'number' ? v : parseInt(v, 10) || 0
        );
      }
    } catch (err) {
      console.error('[redis] EVALSHA error:', err.message);
    }
    return result;
  }
}

module.exports = RedisClient;
