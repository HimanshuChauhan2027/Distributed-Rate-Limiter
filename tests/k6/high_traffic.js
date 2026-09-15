// High traffic burst — exceeds the configured rate limit.
// k6 run tests/k6/high_traffic.js
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

export const options = {
  vus: 50,
  duration: '30s',
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const rateLimited = new Counter('rate_limited_responses');

export default function () {
  const res = http.get(`${BASE_URL}/api/limited?user=high-traffic-user`);
  check(res, {
    'status is 200 or 429': (r) => r.status === 200 || r.status === 429,
  });
  if (res.status === 429) {
    rateLimited.add(1);
  }
}
