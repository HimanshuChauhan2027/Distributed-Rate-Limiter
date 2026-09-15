// Distributed Rate Limiter — Frontend Dashboard
//
// Traffic through the load balancer uses a relative path - the browser
// is already being served by the same NGINX that proxies /api/, so this
// works with zero CORS setup and correctly demonstrates round-robin
// load balancing across backend-1/2/3.
const LB_BASE = "";

// Per-backend health checks are proxied through NGINX so the dashboard
// doesn't need to make cross-origin requests to each backend's host
// port. NGINX routes /health/backend-N directly to the corresponding
// upstream instance (see nginx.conf).
const BACKENDS = [
  { name: "backend-1", url: "/health/backend-1" },
  { name: "backend-2", url: "/health/backend-2" },
  { name: "backend-3", url: "/health/backend-3" },
];

const GAUGE_CIRCUMFERENCE = Math.PI * 80; // matches the SVG arc's radius (80)

let allowedCount = 0;
let blockedCount = 0;

// ── Logging ──────────────────────────────────────────────────

function logLine(text, cls) {
  const log = document.getElementById("request-log");
  const empty = document.getElementById("log-empty");
  if (empty) empty.remove();

  const div = document.createElement("div");
  div.className = "log-line " + cls;
  div.textContent = text;
  log.prepend(div);
}

function clearLog() {
  const log = document.getElementById("request-log");
  log.innerHTML =
    '<div class="log-empty" id="log-empty">No requests sent yet. Use the controls above to send traffic.</div>';
  allowedCount = 0;
  blockedCount = 0;
  document.getElementById("counter-allowed").textContent = "0";
  document.getElementById("counter-blocked").textContent = "0";
  document.getElementById("counter-remaining").textContent = "\u2013";
  setGauge(null, null, "no requests sent yet");
}

// ── Gauge ────────────────────────────────────────────────────

function setGauge(remaining, limit, caption) {
  const valuePath = document.getElementById("gauge-value");
  const number = document.getElementById("gauge-number");
  const captionEl = document.getElementById("gauge-caption");

  if (remaining === null || limit === null || !limit) {
    valuePath.style.strokeDashoffset = GAUGE_CIRCUMFERENCE;
    valuePath.classList.remove("gauge-depleted");
    number.textContent = "\u2013";
    captionEl.textContent = caption || "no requests sent yet";
    return;
  }

  const fraction = Math.max(0, Math.min(1, remaining / limit));
  valuePath.style.strokeDashoffset = String(
    GAUGE_CIRCUMFERENCE * (1 - fraction)
  );

  if (fraction <= 0) {
    valuePath.classList.add("gauge-depleted");
  } else {
    valuePath.classList.remove("gauge-depleted");
  }

  number.textContent = `${remaining} / ${limit}`;
  captionEl.textContent = caption || "remaining in current window";
}

// ── Request Sending ──────────────────────────────────────────

async function sendRequests(count) {
  count = parseInt(count, 10) || 1;
  const user = document.getElementById("input-user").value || "user-1";
  const interval =
    parseInt(document.getElementById("input-interval").value, 10) || 0;

  for (let i = 1; i <= count; i++) {
    await sendOne(i, user);
    if (interval > 0 && i < count) {
      await new Promise((r) => setTimeout(r, interval));
    }
  }
}

async function sendOne(index, user) {
  try {
    const res = await fetch(
      `${LB_BASE}/api/limited?user=${encodeURIComponent(user)}`
    );
    const remaining = res.headers.get("X-RateLimit-Remaining");
    const limit = res.headers.get("X-RateLimit-Limit");
    const instance = res.headers.get("X-Backend-Instance") || "?";
    document.getElementById("counter-remaining").textContent =
      remaining ?? "\u2013";

    if (remaining !== null && limit !== null) {
      setGauge(Number(remaining), Number(limit), `user ${user}`);
    }

    if (res.status === 200) {
      allowedCount++;
      document.getElementById("counter-allowed").textContent = allowedCount;
      logLine(
        `#${index}  200  ${instance}  remaining=${remaining}`,
        "log-ok"
      );
    } else if (res.status === 429) {
      blockedCount++;
      document.getElementById("counter-blocked").textContent = blockedCount;
      logLine(
        `#${index}  429  ${instance}  too many requests`,
        "log-blocked"
      );
    } else {
      logLine(`#${index}  HTTP ${res.status}`, "log-error");
    }
  } catch (err) {
    logLine(`#${index}  network error: ${err.message}`, "log-error");
  }
}

// ── Status / Health Polling ──────────────────────────────────

async function refreshStatus() {
  try {
    const res = await fetch(`${LB_BASE}/api/status`);
    const data = await res.json();
    document.getElementById("stat-algorithm").textContent =
      data.algorithm ?? "\u2013";
    document.getElementById("stat-redis").textContent = data.redis_connected
      ? "connected"
      : "down";
    document.getElementById("stat-total").textContent =
      data.total_requests ?? 0;
    document.getElementById("stat-allowed").textContent =
      data.allowed_requests ?? 0;
    document.getElementById("stat-blocked").textContent =
      data.blocked_requests ?? 0;

    const pill = document.getElementById("conn-status");
    pill.className = "conn-pill is-ok";
    pill.querySelector(".conn-text").textContent = "connected";
  } catch (err) {
    const pill = document.getElementById("conn-status");
    pill.className = "conn-pill is-bad";
    pill.querySelector(".conn-text").textContent = "disconnected";
  }
}

async function refreshBackends() {
  const container = document.getElementById("backend-list");
  const items = await Promise.all(
    BACKENDS.map(async (backend) => {
      try {
        const res = await fetch(backend.url, {
          signal: AbortSignal.timeout(1500),
        });
        return { name: backend.name, healthy: res.ok };
      } catch (e) {
        return { name: backend.name, healthy: false };
      }
    })
  );

  container.innerHTML = items
    .map(
      (b) => `
      <div class="backend-card ${b.healthy ? "backend-card--healthy" : "backend-card--down"}">
        <span class="backend-dot"></span>
        <span class="backend-name">${b.name}</span>
        <span class="backend-status">${b.healthy ? "healthy" : "down"}</span>
      </div>`
    )
    .join("");
}

// ── Boot ─────────────────────────────────────────────────────

function tick() {
  refreshStatus();
  refreshBackends();
}

setGauge(null, null, "no requests sent yet");
tick();
setInterval(tick, 3000);