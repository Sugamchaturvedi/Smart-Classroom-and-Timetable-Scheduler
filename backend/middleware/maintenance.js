/**
 * Maintenance Mode Gate Middleware
 * 
 * Provides an application-level fail-closed maintenance gate that rejects
 * mutating HTTP requests (POST, PUT, PATCH, DELETE) with HTTP 503 Service Unavailable
 * before they can reach route handlers, controllers, or PostgreSQL.
 * 
 * Read-only HTTP methods (GET, HEAD, OPTIONS) are allowed through the gate.
 */

const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const TRUTHY_VALUES = new Set(["true", "1"]);
const FALSY_VALUES = new Set(["false", "0", "off", "no"]);

/**
 * Parses and validates the MAINTENANCE_MODE configuration value.
 * Pure function: zero side-effects.
 * 
 * Rules:
 * - Enabled: "true", "1" (case-insensitive, trimmed) -> { status: "ENABLED", active: true, valid: true }
 * - Disabled: undefined, null, empty/whitespace, "false", "0", "off", "no" -> { status: "DISABLED", active: false, valid: true }
 * - Invalid: every other non-empty value -> { status: "INVALID", active: false, valid: false }
 * 
 * @param {*} envVal
 * @returns {{ status: "ENABLED"|"DISABLED"|"INVALID", active: boolean, valid: boolean }}
 */
function parseMaintenanceModeConfig(envVal) {
    if (envVal === undefined || envVal === null) {
        return { status: "DISABLED", active: false, valid: true };
    }
    const normalized = String(envVal).trim().toLowerCase();
    if (normalized === "") {
        return { status: "DISABLED", active: false, valid: true };
    }
    if (TRUTHY_VALUES.has(normalized)) {
        return { status: "ENABLED", active: true, valid: true };
    }
    if (FALSY_VALUES.has(normalized)) {
        return { status: "DISABLED", active: false, valid: true };
    }
    return { status: "INVALID", active: false, valid: false };
}

/**
 * Validates MAINTENANCE_MODE for application startup.
 * Returns null if valid; returns a sanitized error message if invalid.
 * Does NOT reflect raw untrusted input in the message.
 * 
 * @param {*} envVal
 * @returns {string|null} Error description or null if valid
 */
function validateMaintenanceConfig(envVal) {
    const parsed = parseMaintenanceModeConfig(envVal);
    if (!parsed.valid) {
        return "Invalid MAINTENANCE_MODE configuration value. Expected 'true', 'false', '1', '0', 'off', 'no', or empty.";
    }
    return null;
}

/**
 * Evaluates whether maintenance mode is explicitly active.
 * Maintained for backwards compatibility.
 * 
 * @param {*} envVal
 * @returns {boolean}
 */
function isMaintenanceModeActive(envVal) {
    const parsed = parseMaintenanceModeConfig(envVal);
    return parsed.active;
}

/**
 * Creates an Express maintenance-mode middleware handler.
 * Supports dependency injection for testing.
 * 
 * @param {Object} [options={}]
 * @param {Function} [options.getConfig] - Custom check function returning { active, valid }
 * @param {Function} [options.checkMaintenance] - Legacy custom check function returning boolean
 * @returns {Function} Express middleware (req, res, next)
 */
function createMaintenanceMiddleware(options = {}) {
    const getConfig = typeof options.getConfig === "function"
        ? options.getConfig
        : typeof options.checkMaintenance === "function"
            ? (req) => {
                const res = options.checkMaintenance(req);
                if (typeof res === "object" && res !== null && "valid" in res) {
                    return res;
                }
                return {
                    status: res ? "ENABLED" : "DISABLED",
                    active: Boolean(res),
                    valid: true
                };
            }
            : () => parseMaintenanceModeConfig(process.env.MAINTENANCE_MODE);

    return function maintenanceMiddleware(req, res, next) {
        const config = getConfig(req);
        const method = (req.method || "").toUpperCase();
        const isReadOnly = READ_ONLY_METHODS.has(method);

        // 1. Invalid configuration encountered at runtime
        // Fail closed for mutation requests; permit read-only requests as an explicitly documented availability choice
        if (!config.valid) {
            if (isReadOnly) {
                return next();
            }
            res.set("Retry-After", "60");
            return res.status(503).json({
                success: false,
                error: "CONFIGURATION_ERROR",
                message: "Service is temporarily unavailable due to a configuration error. Write operations are suspended."
            });
        }

        // 2. Normal mode (disabled)
        if (!config.active) {
            return next();
        }

        // 3. Maintenance mode active (enabled)
        if (isReadOnly) {
            return next();
        }

        // Mutation method blocked in maintenance mode
        res.set("Retry-After", "300");
        return res.status(503).json({
            success: false,
            error: "MAINTENANCE_MODE",
            message: "Service is temporarily in read-only maintenance mode. Write operations are suspended."
        });
    };
}

// Default singleton middleware reading process.env.MAINTENANCE_MODE dynamically on each request
const maintenanceMiddleware = createMaintenanceMiddleware();

module.exports = {
    READ_ONLY_METHODS,
    TRUTHY_VALUES,
    FALSY_VALUES,
    parseMaintenanceModeConfig,
    validateMaintenanceConfig,
    isMaintenanceModeActive,
    createMaintenanceMiddleware,
    maintenanceMiddleware
};

