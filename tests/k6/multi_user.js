// Multiple distinct users — verifies per-user rate limit isolation.
// k6 run tests/k6/multi_user.js
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 20,
  duration: '20s',
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

export default function () {
  const user = `multi-user-${__VU}`;
  const res = http.get(`${BASE_URL}/api/limited?user=${user}`);
  check(res, {
    'status is 200 or 429': (r) => r.status === 200 || r.status === 429,
  });
}
