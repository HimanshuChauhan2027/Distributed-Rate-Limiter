# Distributed Rate Limiter

A production-grade distributed rate limiter that enforces **shared request limits across multiple backend instances**, using Redis and atomic Lua scripts, fronted by an NGINX load balancer — with Prometheus + Grafana monitoring built in.

Built by **Himanshu Chauhan** — NIT Kurukshetra

---

## Table of Contents

- [Architecture](#architecture)
- [Why Redis + Lua](#why-redis--lua)
- [Rate Limiting Algorithms](#rate-limiting-algorithms)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [API Endpoints](#api-endpoints)
- [Fail-Open vs Fail-Closed](#fail-open-vs-fail-closed)
- [Project Structure](#project-structure)
- [Testing](#testing)
- [Monitoring](#monitoring)
- [Known Limitations](#known-limitations)
- [Tech Stack](#tech-stack)

---

## Architecture

![Architecture diagram](docs/architecture.svg)

1. **NGINX** receives every client request and round-robins it across three Node.js backend instances.
2. Each backend calls a **Lua script** on Redis to check and update the rate-limit counter for that client.
3. Lua scripts run **atomically** inside Redis — no race conditions, no check-then-act bugs.
4. All backends share the **same Redis state**, so a client's limit is enforced globally, regardless of which backend handles any given request.
5. Every backend exposes `/metrics`; **Prometheus** scrapes all three every 5 seconds and **Grafana** visualizes the result.

### Why Redis + Lua?

A naive in-process counter gives each backend its own count. With 3 backends and a limit of 10 requests, a client could get **30 requests** through simply by round-robining across instances. Redis provides a single source of truth shared by every backend, and Lua scripts guarantee the read-check-increment sequence happens atomically — so two backends can never simultaneously read the same counter and both allow a request that should have been blocked.

---

## Rate Limiting Algorithms

Selectable at runtime via `RATE_LIMIT_ALGORITHM`. Each is implemented as an atomic Redis Lua script.

| Algorithm | Script | How It Works | Best For |
|---|---|---|---|
| **Fixed Window** | `redis/scripts/fixed_window.lua` | Counts requests in fixed time windows (e.g. 10 req / 10 sec). Counter resets at the window boundary. | Simple, predictable limiting |
| **Sliding Window** | `redis/scripts/sliding_window.lua` | Tracks each request timestamp in a Redis sorted set and prunes expired entries on every check. | Smooth, accurate limiting without boundary bursts |
| **Token Bucket** | `redis/scripts/token_bucket.lua` | A bucket refills with tokens at a steady rate; each request consumes one token. | APIs that need to tolerate controlled bursts |

---

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)

### Run

```bash
docker compose build
docker compose up -d
```

Every service starts with sensible defaults — no extra configuration required.

### Access

| Service | URL |
|---|---|
| Dashboard | http://localhost:8080 |
| API (via NGINX) | http://localhost:8080/api/limited?user=test |
| Health check | http://localhost:8080/health |
| Grafana | http://localhost:3000 (`admin` / `admin`) |
| Prometheus | http://localhost:9090 |

### Stop

```bash
docker compose down
```

---

## Configuration

All configuration is done through environment variables. Optionally copy `.env.example` to `.env` to customize:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|---|---|---|
| `RATE_LIMIT_ALGORITHM` | `FIXED_WINDOW` | `FIXED_WINDOW`, `SLIDING_WINDOW`, or `TOKEN_BUCKET` |
| `RATE_LIMIT_MAX_REQUESTS` | `10` | Max requests per window (Fixed/Sliding) or bucket capacity (Token Bucket) |
| `RATE_LIMIT_WINDOW_SECONDS` | `10` | Window duration in seconds (Fixed/Sliding Window only) |
| `RATE_LIMIT_REFILL_PER_SEC` | `1.0` | Token refill rate per second (Token Bucket only) |
| `REDIS_FAILURE_MODE` | `fail_open` | `fail_open` (allow requests when Redis is down) or `fail_closed` (reject) |

If no `.env` file exists, Docker Compose falls back to the defaults above automatically.

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/limited?user={id}` | Rate-limited endpoint. Returns `200` if allowed, `429` if blocked |
| `GET` | `/api/status` | Current instance status, active algorithm, and request counts |
| `GET` | `/api/hello` | Simple health check returning the instance ID |
| `GET` | `/health` | Health check that includes Redis connectivity |
| `GET` | `/metrics` | Prometheus metrics endpoint |

### Rate limit response headers

Every response from `/api/limited` includes:

| Header | Description |
|---|---|
| `X-RateLimit-Limit` | Maximum allowed requests |
| `X-RateLimit-Remaining` | Requests remaining in the current window |
| `X-RateLimit-Reset` | Seconds until the limit resets |
| `X-Backend-Instance` | Which backend instance handled the request |
| `X-RateLimit-Degraded` | Present only when Redis is unreachable (includes failure mode) |

---

## Fail-Open vs Fail-Closed

Controlled by `REDIS_FAILURE_MODE`:

- **`fail_open`** (default) — Requests are **allowed** when Redis is unreachable. Prioritizes availability. The response header `X-RateLimit-Degraded: redis_unreachable_fail_open` signals degraded mode.
- **`fail_closed`** — Requests are **rejected** when Redis is unreachable. Prioritizes correctness over availability.

---

## Project Structure

```
distributed-rate-limiter/
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── src/
│   │   ├── app.js              # Express server and API routes
│   │   ├── config.js           # Environment variable parsing
│   │   ├── redisClient.js      # Redis connection and Lua script execution
│   │   ├── algorithms.js       # Rate limiter implementations (Fixed, Sliding, Token)
│   │   ├── rateLimiter.js      # Shared result factory
│   │   └── metrics.js          # Prometheus metrics
│   └── tests/
│       ├── test_unit.js        # Unit tests (no Redis needed)
│       └── test_integration.js # Integration tests (requires Redis)
├── redis/
│   └── scripts/
│       ├── fixed_window.lua    # Atomic fixed window counter
│       ├── sliding_window.lua  # Atomic sliding window log (ZSET)
│       └── token_bucket.lua    # Atomic token bucket (HASH)
├── nginx/
│   └── nginx.conf              # Reverse proxy + load balancer config
├── frontend/
│   ├── index.html              # Dashboard UI
│   ├── app.js                  # Dashboard logic
│   └── style.css               # Dashboard styling
├── prometheus/
│   └── prometheus.yml          # Scrape config for backend instances
├── grafana/
│   ├── dashboards/             # Pre-built Grafana dashboard
│   └── provisioning/           # Auto-provisioned datasource + dashboard
├── tests/
│   └── k6/                     # Load testing scripts
│       ├── normal_traffic.js
│       ├── high_traffic.js
│       └── multi_user.js
├── docs/
│   ├── architecture.md         # Architecture notes (text)
│   └── architecture.svg        # Architecture diagram (white background)
├── docker-compose.yml
├── .env.example
└── .dockerignore
```

---

## Testing

### Unit tests

```bash
cd backend
npm install
node tests/test_unit.js
```

### Integration tests (requires Redis)

```bash
cd backend
node tests/test_integration.js
```

### Load tests (requires the full stack running)

```bash
# Light steady traffic
k6 run tests/k6/normal_traffic.js

# High burst traffic
k6 run tests/k6/high_traffic.js

# Multiple concurrent users
k6 run tests/k6/multi_user.js
```

---

## Monitoring

Prometheus scrapes all three backend instances every 5 seconds. Grafana ships with a pre-built dashboard showing:

- Requests/sec (allowed vs. blocked)
- Per-backend request distribution
- Average request latency
- Active in-flight requests
- HTTP status code breakdown
- Redis error rate
- Current algorithm per instance

---

## Known Limitations

- **Single Redis connection per backend** — each instance uses one `ioredis` connection; commands are queued and pipelined rather than parallelized. A connection pool would give more headroom under very high concurrency.
- **NGINX passive health checks only** — open-source NGINX detects backend failures only when a real request fails (active polling requires NGINX Plus).
- **Status endpoint shows per-instance counters** — because round-robin may hit a different backend on each poll. Aggregated metrics are available through Prometheus + Grafana.
- **Sliding Window uses a full request log (ZSET)** — accurate, but more memory-heavy than counter-based approximations.
- **Script cache resets are handled automatically** — if `EVALSHA` fails with `NOSCRIPT` (e.g. after a Redis restart flushes the script cache), the backend reloads the script and retries once. See `ScriptBackedLimiter.runScript` in `backend/src/algorithms.js`.

---

## Tech Stack

| Component | Technology |
|---|---|
| Backend | Node.js, Express |
| Rate limiting | Redis + Lua scripts |
| Load balancer | NGINX |
| Frontend | Vanilla HTML/CSS/JS |
| Monitoring | Prometheus + Grafana |
| Load testing | k6 |
| Containerization | Docker Compose |

---

## Author

**Himanshu Chauhan**
NIT Kurukshetra

## License

This project is open source.
