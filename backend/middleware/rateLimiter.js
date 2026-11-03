/**
 * Production-hardened, zero-dependency in-memory sliding-window rate limiter.
 * 
 * Security & Architectural Controls:
 * - SEC-01: Derives client IP strictly from Express's req.ip (respecting the app's
 *   configured proxy-trust model) with fallback to socket remote address. Never
 *   inspects raw caller-supplied forwarding headers directly.
 * - SEC-03: Bounded memory usage with opportunistic sweeping of stale/expired keys
 *   and LRU-style oldest-entry eviction under capacity pressure.
 * - SEC-04: Fully configurable via validated environment variables with safe defaults.
 * 
 * Deployment Note on Proxy Trust:
 * Express disables proxy trust by default ('trust proxy' = false). In this default state,
 * Express derives req.ip strictly from the immediate TCP socket remote address, safely
 * ignoring caller-spoofed X-Forwarded-For headers. When deploying behind a trusted reverse
 * proxy (e.g., AWS ALB, NGINX, Cloudflare), backend/server.js must be explicitly configured
 * with an audited, restricted trust-proxy setting (e.g. app.set('trust proxy', 'loopback')).
 * 
 * Institutional Deployment Note on Campus NATs:
 * On shared campus/university egress gateways, multiple legitimate users may share a single
 * public IP. Aggregate IP limits (LOGIN_RATE_LIMIT_IP_MAX) should be monitored and scaled
 * appropriately for campus deployments to prevent inadvertent denial of service.
 */

// Storage: Map<key, Array<timestamp>>
const attemptStore = new Map();

// Opportunistic sweeping interval: run at most once per 60 seconds during active requests
let lastSweepTimestamp = 0;
const SWEEP_MIN_INTERVAL_MS = 60 * 1000;

/**
 * Validates and parses positive integer configuration parameters with fallback
 */
function parsePositiveInteger(val, defaultVal, minVal, maxVal) {
    if (val === undefined || val === null || String(val).trim() === "") {
        return defaultVal;
    }
    const num = Number(val);
    if (!Number.isFinite(num) || !Number.isInteger(num) || num < minVal || num > maxVal) {
        return defaultVal;
    }
    return num;
}

/**
 * Resolves current rate limiter configuration from environment with secure defaults
 */
function getRateLimitConfig() {
    return {
        windowMs: parsePositiveInteger(process.env.LOGIN_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000, 1000, 86400000), // 1s to 24h
        maxPerAccount: parsePositiveInteger(process.env.LOGIN_RATE_LIMIT_ACCOUNT_MAX, 5, 1, 100),                // 1 to 100 attempts
        maxPerIp: parsePositiveInteger(process.env.LOGIN_RATE_LIMIT_IP_MAX, 25, 5, 1000),                        // 5 to 1000 attempts
        maxCapacity: parsePositiveInteger(process.env.LOGIN_RATE_LIMIT_MAX_KEYS, 10000, 50, 100000)             // 50 to 100,000 keys
    };
}

/**
 * SEC-01: Safely extracts and normalizes the client IP address.
 * 
 * Never reads caller-supplied X-Forwarded-For headers directly.
 * Relies on req.ip (populated securely by Express in accordance with its 'trust proxy' setting)
 * with safe fallback to req.socket.remoteAddress.
 */
function getClientIp(req) {
    let rawIp = req?.ip || req?.socket?.remoteAddress || "127.0.0.1";
    if (typeof rawIp !== "string") {
        rawIp = "127.0.0.1";
    }
    rawIp = rawIp.trim();

    // Normalize IPv6-mapped IPv4 addresses (e.g., ::ffff:127.0.0.1 -> 127.0.0.1)
    if (rawIp.startsWith("::ffff:")) {
        rawIp = rawIp.substring(7);
    } else if (rawIp === "::1") {
        rawIp = "127.0.0.1";
    }

    return rawIp || "127.0.0.1";
}

/**
 * SEC-03: Sweeps expired timestamp entries from attemptStore to prevent memory leaks
 */
function sweepExpiredEntries(now, windowMs) {
    const cutoff = now - windowMs;
    for (const [key, timestamps] of attemptStore.entries()) {
        const active = timestamps.filter(ts => ts > cutoff);
        if (active.length > 0) {
            attemptStore.set(key, active);
        } else {
            attemptStore.delete(key);
        }
    }
    lastSweepTimestamp = now;
}

/**
 * SEC-03: Enforces bounded memory capacity against key-flood attacks
 */
function enforceCapacityLimits(now, config) {
    if (attemptStore.size >= config.maxCapacity) {
        sweepExpiredEntries(now, config.windowMs);
        if (attemptStore.size >= config.maxCapacity) {
            // Evict oldest entries until size drops below 90% of maxCapacity
            const targetSize = Math.floor(config.maxCapacity * 0.9);
            for (const key of attemptStore.keys()) {
                attemptStore.delete(key);
                if (attemptStore.size <= targetSize) {
                    break;
                }
            }
        }
    }
}

/**
 * Cleans expired timestamps for a specific key and returns active count
 */
function getActiveAttempts(key, now, windowMs) {
    const timestamps = attemptStore.get(key);
    if (!timestamps || !timestamps.length) {
        return 0;
    }
    const cutoff = now - windowMs;
    const active = timestamps.filter(ts => ts > cutoff);
    if (active.length > 0) {
        attemptStore.set(key, active);
    } else {
        attemptStore.delete(key);
    }
    return active.length;
}

/**
 * Records an attempt timestamp
 */
function recordAttempt(key, now, config) {
    enforceCapacityLimits(now, config);
    const timestamps = attemptStore.get(key) || [];
    timestamps.push(now);
    attemptStore.set(key, timestamps);
}

/**
 * Calculates remaining seconds until window expires for oldest active attempt
 */
function getRetryAfterSeconds(key, now, windowMs) {
    const timestamps = attemptStore.get(key) || [];
    if (!timestamps.length) return 60;
    const oldest = timestamps[0];
    const remainingMs = Math.max(0, (oldest + windowMs) - now);
    return Math.ceil(remainingMs / 1000) || 1;
}

/**
 * Middleware: Enforces rate limiting on login endpoint
 */
function loginRateLimiter(req, res, next) {
    const config = getRateLimitConfig();
    const now = Date.now();

    // SEC-03: Opportunistic periodic sweep of stale keys during active traffic
    if (now - lastSweepTimestamp > SWEEP_MIN_INTERVAL_MS) {
        sweepExpiredEntries(now, config.windowMs);
    }

    const ip = getClientIp(req);
    const email = req.body?.email ? String(req.body.email).trim().toLowerCase() : "unknown";

    const accountKey = `login_acc:${ip}:${email}`;
    const ipKey = `login_ip:${ip}`;

    const accountAttempts = getActiveAttempts(accountKey, now, config.windowMs);
    const ipAttempts = getActiveAttempts(ipKey, now, config.windowMs);

    if (accountAttempts >= config.maxPerAccount || ipAttempts >= config.maxPerIp) {
        const keyForRetry = (accountAttempts >= config.maxPerAccount) ? accountKey : ipKey;
        const limitApplicable = (accountAttempts >= config.maxPerAccount) ? config.maxPerAccount : config.maxPerIp;
        const retryAfter = getRetryAfterSeconds(keyForRetry, now, config.windowMs);

        res.setHeader("Retry-After", String(retryAfter));
        res.setHeader("X-RateLimit-Limit", String(limitApplicable));
        res.setHeader("X-RateLimit-Remaining", "0");
        res.setHeader("X-RateLimit-Reset", String(retryAfter));

        return res.status(429).json({
            success: false,
            message: `Too many login attempts. Please try again after ${Math.ceil(retryAfter / 60)} minute(s).`,
            retryAfter
        });
    }

    // Attach hook to record failure if login fails
    const originalJson = res.json.bind(res);
    res.json = function(data) {
        // If response indicates failure (status >= 400 or success === false)
        if (res.statusCode >= 400 || (data && data.success === false)) {
            recordAttempt(accountKey, Date.now(), config);
            recordAttempt(ipKey, Date.now(), config);
        }
        return originalJson(data);
    };

    next();
}

/**
 * Resets/clears rate limit attempts for an IP and account upon successful login
 */
function resetLoginRateLimit(req) {
    const ip = getClientIp(req);
    const email = req.body?.email ? String(req.body.email).trim().toLowerCase() : "";
    if (email) {
        attemptStore.delete(`login_acc:${ip}:${email}`);
    }
}

/**
 * Test helper to clear entire store between test runs
 */
function clearRateLimitStore() {
    attemptStore.clear();
    lastSweepTimestamp = 0;
}

/**
 * Test helper to inspect store size
 */
function getAttemptStoreSize() {
    return attemptStore.size;
}

module.exports = {
    loginRateLimiter,
    resetLoginRateLimit,
    clearRateLimitStore,
    getClientIp,
    getRateLimitConfig,
    parsePositiveInteger,
    sweepExpiredEntries,
    getAttemptStoreSize,
    attemptStore
};
