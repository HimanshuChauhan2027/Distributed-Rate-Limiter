-- Sliding Window Log rate limiting (ZSET-based)
-- KEYS[1] = rate-limit key    ARGV[1] = limit    ARGV[2] = window_seconds    ARGV[3] = now_ms
-- Returns: {allowed(0/1), remaining, reset_seconds}

local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local window_start = now - (window * 1000)

redis.call("ZREMRANGEBYSCORE", key, "-inf", window_start)

local count = redis.call("ZCARD", key)

if count < limit then
    local member = tostring(now) .. "-" .. tostring(count)
    redis.call("ZADD", key, now, member)
    redis.call("EXPIRE", key, window)
    return {1, limit - count - 1, window}
else
    redis.call("EXPIRE", key, window)
    return {0, 0, window}
end
