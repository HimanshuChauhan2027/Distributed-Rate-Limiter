function createResult() {
  return {
    allowed: false,
    limit: 0,
    remaining: 0,
    reset_seconds: 0,
    redis_error: false,
  };
}

module.exports = { createResult };
