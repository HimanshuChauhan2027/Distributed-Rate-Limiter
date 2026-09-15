const { Registry, Counter, Gauge } = require('prom-client');

class Metrics {
  constructor() {
    this.registry = new Registry();

    // Internal counters for /api/status endpoint
    this._total = 0;
    this._allowed = 0;
    this._blocked = 0;
    this._redisErrors = 0;

    // Latency tracking (avg/max as gauges — Grafana queries these directly)
    this._latencySum = 0;
    this._latencyCount = 0;
    this._latencyMax = 0;

    this.totalCounter = new Counter({
      name: 'ratelimiter_requests_total',
      help: 'Total requests received',
      labelNames: ['instance'],
      registers: [this.registry],
    });

    this.allowedCounter = new Counter({
      name: 'ratelimiter_requests_allowed_total',
      help: 'Requests allowed by rate limiter',
      labelNames: ['instance'],
      registers: [this.registry],
    });

    this.blockedCounter = new Counter({
      name: 'ratelimiter_requests_blocked_total',
      help: 'Requests blocked by rate limiter (HTTP 429)',
      labelNames: ['instance'],
      registers: [this.registry],
    });

    this.redisErrorCounter = new Counter({
      name: 'ratelimiter_redis_errors_total',
      help: 'Redis connection or execution errors',
      labelNames: ['instance'],
      registers: [this.registry],
    });

    this.statusCounter = new Counter({
      name: 'ratelimiter_http_status_total',
      help: 'Requests per HTTP status code',
      labelNames: ['instance', 'code'],
      registers: [this.registry],
    });

    this.activeGauge = new Gauge({
      name: 'ratelimiter_active_requests',
      help: 'Currently in-flight requests',
      labelNames: ['instance'],
      registers: [this.registry],
    });

    this.algorithmGauge = new Gauge({
      name: 'ratelimiter_algorithm_info',
      help: 'Current rate limiting algorithm (always 1)',
      labelNames: ['instance', 'algorithm'],
      registers: [this.registry],
    });

    this.latencyAvgGauge = new Gauge({
      name: 'ratelimiter_request_latency_ms_avg',
      help: 'Average request latency in milliseconds',
      labelNames: ['instance'],
      registers: [this.registry],
    });

    this.latencyMaxGauge = new Gauge({
      name: 'ratelimiter_request_latency_ms_max',
      help: 'Maximum observed request latency in milliseconds',
      labelNames: ['instance'],
      registers: [this.registry],
    });
  }

  initAlgorithm(instanceId, algorithm) {
    this.algorithmGauge.labels(instanceId, algorithm).set(1);
  }

  incTotal(instanceId) {
    this._total++;
    this.totalCounter.labels(instanceId).inc();
  }

  incAllowed(instanceId) {
    this._allowed++;
    this.allowedCounter.labels(instanceId).inc();
  }

  incBlocked(instanceId) {
    this._blocked++;
    this.blockedCounter.labels(instanceId).inc();
  }

  incRedisError(instanceId) {
    this._redisErrors++;
    this.redisErrorCounter.labels(instanceId).inc();
  }

  incActive(instanceId) {
    this.activeGauge.labels(instanceId).inc();
  }

  decActive(instanceId) {
    this.activeGauge.labels(instanceId).dec();
  }

  incStatus(instanceId, code) {
    this.statusCounter.labels(instanceId, String(code)).inc();
  }

  observeLatency(instanceId, ms) {
    this._latencySum += ms;
    this._latencyCount++;
    if (ms > this._latencyMax) this._latencyMax = ms;

    const avg =
      this._latencyCount > 0 ? this._latencySum / this._latencyCount : 0;
    this.latencyAvgGauge.labels(instanceId).set(avg);
    this.latencyMaxGauge.labels(instanceId).set(this._latencyMax);
  }

  total() {
    return this._total;
  }

  allowed() {
    return this._allowed;
  }

  blocked() {
    return this._blocked;
  }

  async render() {
    return this.registry.metrics();
  }
}

module.exports = Metrics;
