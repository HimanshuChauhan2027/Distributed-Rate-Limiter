-- Fixed Window rate limiting
-- KEYS[1] = rate-limit key    ARGV[1] = limit    ARGV[2] = window_seconds
-- Returns: {allowed(0/1), remaining, reset_seconds}

local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])

local current = redis.call("INCR", key)
if current == 1 then
    redis.call("EXPIRE", key, window)
end

local ttl = redis.call("TTL", key)
if ttl < 0 then ttl = window end

if current > limit then
    return {0, 0, ttl}
else
    return {1, limit - current, ttl}
end
