-- Token Bucket rate limiting (HASH-based)
-- KEYS[1] = rate-limit key    ARGV[1] = capacity    ARGV[2] = refill_rate    ARGV[3] = now_ms
-- Returns: {allowed(0/1), remaining_tokens, reset_seconds}

local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local bucket = redis.call("HMGET", key, "tokens", "last_refill_ms")
local tokens = tonumber(bucket[1])
local last_refill = tonumber(bucket[2])

if tokens == nil then
    tokens = capacity
    last_refill = now
end

local elapsed_seconds = math.max(0, (now - last_refill) / 1000.0)
local refill = elapsed_seconds * refill_rate
tokens = math.min(capacity, tokens + refill)

local allowed
if tokens >= 1 then
    tokens = tokens - 1
    allowed = 1
else
    allowed = 0
end

redis.call("HMSET", key, "tokens", tostring(tokens), "last_refill_ms", tostring(now))
local ttl = math.ceil(capacity / refill_rate) + 5
redis.call("EXPIRE", key, ttl)

local reset_seconds = 0
if allowed == 0 then
    reset_seconds = math.ceil((1 - tokens) / refill_rate)
end

return {allowed, math.floor(tokens), reset_seconds}
