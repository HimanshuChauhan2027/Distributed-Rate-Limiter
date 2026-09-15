# Architecture

```
                     Browser
                       │
                       ▼
                 NGINX (:8080)
             ┌─────────┼─────────┐
             ▼         ▼         ▼
         backend-1  backend-2  backend-3
         (Node.js)  (Node.js)  (Node.js)
             └─────────┼─────────┘
                       ▼
                  Redis (:6379)
                  Lua scripts (atomic)

         Prometheus (:9090) ──► Grafana (:3000)
```

## Why Redis + Lua

A naive in-process rate limiter keeps counters in local memory. With multiple instances behind a load balancer, each instance tracks its own counter — a client round-robining across three backends could get 3× the intended limit.

Redis provides a single shared source of truth. Lua scripts execute atomically within Redis, preventing check-then-act race conditions where two backends simultaneously read the same counter and both allow a request that exceeds the limit.

## Fail-Open vs Fail-Closed

Controlled by `REDIS_FAILURE_MODE`:

- **fail_open** (default) — Requests allowed through when Redis is unreachable. Prioritizes availability. Every degraded response includes `X-RateLimit-Degraded: redis_unreachable_fail_open`.
- **fail_closed** — Requests rejected when Redis is unreachable. Prioritizes correctness over availability.

## Known Limitations

- **Single Redis connection per backend** — each instance uses one ioredis connection; commands are queued and pipelined rather than parallelized. A connection pool would give more headroom under very high concurrency.
- **NGINX passive health checks only** — open-source NGINX detects backend failures only when a real request fails (active polling requires NGINX Plus).
- **Status endpoint shows per-instance counters** — because round-robin may hit different backends on each poll. Aggregated metrics are available through Prometheus + Grafana.
- **Sliding Window uses a full request log (ZSET)** — accurate but memory-heavy compared to counter-based approximations.

Redis script-cache resets are handled: if `EVALSHA` fails with `NOSCRIPT` (e.g. after a Redis restart flushes the script cache), the backend reloads the script and retries once automatically — see `ScriptBackedLimiter.runScript` in `backend/src/algorithms.js`.
