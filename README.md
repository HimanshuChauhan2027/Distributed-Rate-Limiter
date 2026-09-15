# Distributed Rate Limiter

A production-grade distributed rate limiter that enforces shared request limits across multiple backend instances using **Redis** and **atomic Lua scripts**, fronted by an **NGINX** load balancer.

Built by **Himanshu Chauhan** — NIT Kurukshetra

---

## Architecture

```
                        ┌──────────────┐
                        │   Browser    │
                        │  Dashboard   │
                        └──────┬───────┘
                               │
                               ▼
                     ┌───────────────────┐
                     │   NGINX (:8080)   │
                     │   Load Balancer   │
                     │   + Static Files  │
                     └──┬──────┬──────┬──┘
                        │      │      │          Round-robin
              ┌─────────┘      │      └─────────┐
              ▼                ▼                ▼
     ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
     │  backend-1   │  │  backend-2   │  │  backend-3   │
     │  (Node.js)   │  │  (Node.js)   │  │  (Node.js)   │
     │  :8081       │  │  :8082       │  │  :8083       │
     └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
            │                 │                 │
            └────────┬────────┘                 │
                     │  Shared rate limit state  │
                     ├──────────────────────────┘
                     ▼
            ┌─────────────────┐
            │  Redis (:6379)  │
            │  Lua Scripts    │
            │  (atomic ops)   │
            └─────────────────┘

            ┌─────────────────┐      ┌──────────────────┐
            │  Prometheus     │─────▶│  Grafana (:3000)  │
            │  (:9090)        │      │  Dashboards       │
            └─────────────────┘      └──────────────────┘
```

### How It Works

1. **NGINX** receives all client requests and distributes them across three Node.js backend instances using round-robin
2. Each backend calls a **Lua script** on Redis to check/update the rate limit counter
3. Lua scripts execute **atomically** inside Redis — no race conditions, no check-then-act bugs
4. All backends share the **same Redis state**, so a user's limit is enforced globally regardless of which backend handles the request

### Why Redis + Lua?

A naive in-process counter would give each backend its own count. With 3 backends and a limit of 10, a client could get **30 requests** through by round-robining. Redis provides a single source of truth, and Lua scripts prevent race conditions where two backends simultaneously read the same counter and both allow a request.

---

## Rate Limiting Algorithms

| Algorithm | How It Works | Best For |
|-----------|-------------|----------|
| **Fixed Window** | Counts requests in fixed time windows (e.g., 10 req / 10 sec). Counter resets at window boundary. | Simple, predictable limiting |
| **Sliding Window** | Tracks each request timestamp in a sorted set. Removes expired entries on each check. | Smooth, accurate limiting without boundary bursts |
| **Token Bucket** | Bucket fills with tokens at a steady rate. Each request consumes one token. Allows controlled bursts up to bucket capacity. | APIs needing burst tolerance |

---

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)

### Run

```bash
docker compose build
docker compose up -d
```

That's it. All services start with sensible defaults.

### Access

| Service | URL |
|---------|-----|
| **Dashboard** | [http://localhost:8080](http://localhost:8080) |
| **API (via NGINX)** | [http://localhost:8080/api/limited?user=test](http://localhost:8080/api/limited?user=test) |
| **Health Check** | [http://localhost:8080/health](http://localhost:8080/health) |
| **Grafana** | [http://localhost:3000](http://localhost:3000) (admin / admin) |
| **Prometheus** | [http://localhost:9090](http://localhost:9090) |

### Stop

```bash
docker compose down
```

---

## Configuration

Configuration is done through environment variables. Optionally copy `.env.example` to `.env` to customize:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_ALGORITHM` | `FIXED_WINDOW` | `FIXED_WINDOW`, `SLIDING_WINDOW`, or `TOKEN_BUCKET` |
| `RATE_LIMIT_MAX_REQUESTS` | `10` | Max requests per window (Fixed/Sliding) or bucket capacity (Token Bucket) |
| `RATE_LIMIT_WINDOW_SECONDS` | `10` | Window duration in seconds (Fixed/Sliding Window only) |
| `RATE_LIMIT_REFILL_PER_SEC` | `1.0` | Token refill rate per second (Token Bucket only) |
| `REDIS_FAILURE_MODE` | `fail_open` | `fail_open` (allow requests when Redis is down) or `fail_closed` (reject) |

If no `.env` file exists, Docker Compose uses the defaults above automatically.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/limited?user={id}` | Rate-limited endpoint. Returns `200` if allowed, `429` if blocked |
| `GET` | `/api/status` | Current instance status, algorithm, and request counts |
| `GET` | `/api/hello` | Simple health check returning instance ID |
| `GET` | `/health` | Health check with Redis connectivity status |
| `GET` | `/metrics` | Prometheus metrics endpoint |

### Rate Limit Response Headers

Every response from `/api/limited` includes:

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Maximum allowed requests |
| `X-RateLimit-Remaining` | Requests remaining in current window |
| `X-RateLimit-Reset` | Seconds until the limit resets |
| `X-Backend-Instance` | Which backend handled the request |
| `X-RateLimit-Degraded` | Present when Redis is unreachable (includes failure mode) |

---

## Fail-Open vs Fail-Closed

Controlled by `REDIS_FAILURE_MODE`:

- **`fail_open`** (default) — Requests are **allowed** when Redis is unreachable. Prioritizes availability. The response header `X-RateLimit-Degraded: redis_unreachable_fail_open` signals degraded mode.
- **`fail_closed`** — Requests are **rejected** when Redis is unreachable. Prioritizes correctness.

---

## Project Structure

```
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
├── docker-compose.yml
├── .env.example
└── .dockerignore
```

---

## Testing

### Unit Tests

```bash
cd backend
npm install
node tests/test_unit.js
```

### Integration Tests (requires Redis)

```bash
cd backend
node tests/test_integration.js
```

### Load Tests (requires full stack running)

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

- Requests/sec (allowed vs blocked)
- Per-backend request distribution
- Average request latency
- Active in-flight requests
- HTTP status code breakdown
- Redis error rate
- Current algorithm per instance

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Node.js, Express |
| Rate Limiting | Redis + Lua scripts |
| Load Balancer | NGINX |
| Frontend | Vanilla HTML/CSS/JS |
| Monitoring | Prometheus + Grafana |
| Load Testing | k6 |
| Containerization | Docker Compose |

---

## Author

**Himanshu Chauhan**
NIT Kurukshetra

---

## License

This project is open source.
