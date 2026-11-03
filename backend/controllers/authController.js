const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const { resetLoginRateLimit } = require("../middleware/rateLimiter");

/**
 * POST /api/auth/login
 * Unified authentication for both Administrators and Teachers
 */
async function login(req, res) {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Email and password are required"
            });
        }

        const result = await pool.query(
            `SELECT
                u.id,
                u.full_name,
                u.email,
                u.password_hash,
                u.role,
                u.is_active,
                u.phone,
                u.avatar_url,
                u.created_at,
                u.last_login,
                d.name AS department_name
             FROM users u
             LEFT JOIN departments d ON d.id = u.department_id
             WHERE LOWER(u.email) = LOWER($1)`,
            [email.trim()]
        );

        if (!result.rows.length) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password"
            });
        }

        const user = result.rows[0];

        if (!user.is_active) {
            return res.status(403).json({
                success: false,
                message: "Account is inactive. Please contact your university administrator."
            });
        }

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password"
            });
        }

        // Reset rate limiter failed attempts on successful login
        resetLoginRateLimit(req);

        // Update last login timestamp
        await pool.query(
            "UPDATE users SET last_login = NOW() WHERE id = $1",
            [user.id]
        );

        const normalizedRole = (user.role || "TEACHER").toUpperCase();

        // Check for linked teacher profile
        let teacherRecord = null;
        if (normalizedRole === "TEACHER") {
            const tResult = await pool.query(
                `SELECT t.id, t.teacher_code, t.full_name, t.department_id, d.name AS department_name
                 FROM teachers t
                 LEFT JOIN departments d ON d.id = t.department_id
                 WHERE t.user_id = $1
                 LIMIT 1`,
                [user.id]
            );
            if (tResult.rows.length) {
                teacherRecord = tResult.rows[0];
            }
        }

        const token = jwt.sign(
            {
                id: user.id,
                email: user.email,
                role: normalizedRole,
                teacherId: teacherRecord ? teacherRecord.id : null
            },
            process.env.JWT_SECRET,
            { expiresIn: "12h" }
        );

        res.json({
            success: true,
            message: "Login successful",
            token,
            user: {
                id: user.id,
                name: user.full_name,
                email: user.email,
                role: normalizedRole,
                phone: user.phone || "",
                avatarUrl: user.avatar_url || "",
                department: teacherRecord ? (teacherRecord.department_name || "General") : (user.department_name || "Academic Administration"),
                status: user.is_active ? "Active" : "Inactive",
                lastLogin: new Date().toISOString(),
                createdAt: user.created_at,
                teacherId: teacherRecord ? teacherRecord.id : null,
                teacherCode: teacherRecord ? teacherRecord.teacher_code : null
            }
        });
    } catch (error) {
        console.error("Login controller error:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error during authentication"
        });
    }
}

/**
 * GET /api/auth/me
 * Retrieves authenticated user's current profile information
 */
async function getMe(req, res) {
    try {
        const userId = req.user.id;

        const userRes = await pool.query(
            `SELECT
                u.id,
                u.full_name,
                u.email,
                u.role,
                u.is_active,
                u.phone,
                u.avatar_url,
                u.created_at,
                u.last_login,
                d.name AS department_name
             FROM users u
             LEFT JOIN departments d ON d.id = u.department_id
             WHERE u.id = $1`,
            [userId]
        );

        if (!userRes.rows.length) {
            return res.status(404).json({
                success: false,
                message: "User profile not found"
            });
        }

        const user = userRes.rows[0];
        const normalizedRole = (user.role || "TEACHER").toUpperCase();

        let teacherRecord = null;
        if (normalizedRole === "TEACHER") {
            const tResult = await pool.query(
                `SELECT t.id, t.teacher_code, t.full_name, t.department_id, d.name AS department_name
                 FROM teachers t
                 LEFT JOIN departments d ON d.id = t.department_id
                 WHERE t.user_id = $1
                 LIMIT 1`,
                [user.id]
            );
            if (tResult.rows.length) {
                teacherRecord = tResult.rows[0];
            }
        }

        res.json({
            success: true,
            user: {
                id: user.id,
                name: user.full_name,
                email: user.email,
                role: normalizedRole,
                phone: user.phone || "",
                avatarUrl: user.avatar_url || "",
                department: teacherRecord ? (teacherRecord.department_name || "General") : (user.department_name || "Academic Administration"),
                status: user.is_active ? "Active" : "Inactive",
                lastLogin: user.last_login,
                createdAt: user.created_at,
                teacherId: teacherRecord ? teacherRecord.id : null,
                teacherCode: teacherRecord ? teacherRecord.teacher_code : null
            }
        });
    } catch (error) {
        console.error("getMe error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to retrieve user profile"
        });
    }
}

/**
 * PUT /api/auth/profile
 * Allows logged-in user to update permitted profile fields
 */
async function updateProfile(req, res) {
    try {
        const userId = req.user.id;
        const { full_name, name, phone, email } = req.body;
        const targetName = full_name || name;

        if (!targetName || !targetName.trim()) {
            return res.status(400).json({
                success: false,
                message: "Full name is required"
            });
        }

        // If email is being changed, ensure it's not taken by another user
        if (email && email.trim().toLowerCase() !== req.user.email.toLowerCase()) {
            const emailCheck = await pool.query(
                "SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id <> $2",
                [email.trim(), userId]
            );
            if (emailCheck.rows.length) {
                return res.status(409).json({
                    success: false,
                    message: "Email address is already in use by another account"
                });
            }
        }

        const newEmail = email ? email.trim() : req.user.email;

        const updateResult = await pool.query(
            `UPDATE users
             SET
                full_name = $1,
                phone = COALESCE($2, phone),
                email = $3
             WHERE id = $4
             RETURNING id, full_name, email, role, phone, avatar_url, last_login, created_at`,
            [targetName.trim(), phone || null, newEmail, userId]
        );

        // Keep linked teacher record synchronized if this is a teacher
        if (req.user.teacherId) {
            await pool.query(
                `UPDATE teachers
                 SET full_name = $1, email = $2
                 WHERE id = $3`,
                [targetName.trim(), newEmail, req.user.teacherId]
            );
        }

        const updated = updateResult.rows[0];

        res.json({
            success: true,
            message: "Profile updated successfully",
            user: {
                id: updated.id,
                name: updated.full_name,
                email: updated.email,
                role: (updated.role || "TEACHER").toUpperCase(),
                phone: updated.phone || "",
                avatarUrl: updated.avatar_url || "",
                department: req.user.departmentName || "Academic Administration",
                status: "Active",
                lastLogin: updated.last_login,
                createdAt: updated.created_at,
                teacherId: req.user.teacherId || null,
                teacherCode: req.user.teacherCode || null
            }
        });
    } catch (error) {
        console.error("updateProfile error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to update profile"
        });
    }
}

/**
 * PUT /api/auth/change-password
 * Secure password change with verification of current password and bcrypt hashing
 */
async function changePassword(req, res) {
    try {
        const userId = req.user.id;
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                message: "Current password and new password are required"
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: "New password must be at least 6 characters long"
            });
        }

        // Fetch user's current password hash
        const userRes = await pool.query(
            "SELECT password_hash FROM users WHERE id = $1",
            [userId]
        );

        if (!userRes.rows.length) {
            return res.status(404).json({
                success: false,
                message: "User account not found"
            });
        }

        const isMatch = await bcrypt.compare(currentPassword, userRes.rows[0].password_hash);
        if (!isMatch) {
            return res.status(400).json({
                success: false,
                message: "The current password you entered is incorrect"
            });
        }

        const newHash = await bcrypt.hash(newPassword, 10);
        await pool.query(
            "UPDATE users SET password_hash = $1 WHERE id = $2",
            [newHash, userId]
        );

        // Record in audit log if table exists
        try {
            await pool.query(
                `INSERT INTO audit_logs (user_id, action, entity, entity_id, description)
                 VALUES ($1, 'PASSWORD_CHANGE', 'users', $2, 'User successfully changed account password')`,
                [userId, String(userId)]
            );
        } catch (_) {}

        res.json({
            success: true,
            message: "Password changed successfully"
        });
    } catch (error) {
        console.error("changePassword error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to update password"
        });
    }
}

/**
 * POST /api/auth/logout
 */
async function logout(req, res) {
    res.json({
        success: true,
        message: "Logged out successfully"
    });
}

/**
 * POST /api/auth/register
 * Secure registration policy:
 * - When no ADMIN exists (Bootstrap mode):
 *     Requires INITIAL_ADMIN_SECRET environment variable (fail closed if missing or <16 chars).
 *     Requires setup_secret (in header x-setup-secret or body setup_secret) matching INITIAL_ADMIN_SECRET (timing-safe).
 *     Forces role to 'ADMIN'.
 * - When ADMIN exists (Standard mode):
 *     Unauthenticated registration is rejected (fail closed HTTP 403).
 *     Only authenticated administrators can provision accounts.
 *     Role is strictly validated against whitelist ['ADMIN', 'TEACHER'] to prevent privilege escalation.
 */
async function register(req, res) {
    let client = null;
    try {
        const { full_name, email, password, role } = req.body;

        // 1. Initial check: determine whether the system is in bootstrap mode
        const quickCheck = await pool.query(
            "SELECT COUNT(*)::int AS count FROM users WHERE UPPER(role) = 'ADMIN'"
        );
        const initialCount = parseInt(quickCheck.rows[0]?.count, 10) || 0;

        let targetRole;

        if (initialCount === 0) {
            // --- BOOTSTRAP MODE: Initial administrator setup ---
            // A. Validate environment configuration first (fail closed)
            const configuredSecret = process.env.INITIAL_ADMIN_SECRET;
            if (!configuredSecret || typeof configuredSecret !== "string" || configuredSecret.trim().length < 16) {
                return res.status(403).json({
                    success: false,
                    message: "Initial administrator registration is blocked: INITIAL_ADMIN_SECRET is not configured or insufficient on the server."
                });
            }

            // B. Validate request setup secret (timing-safe)
            const providedSecret = req.headers["x-setup-secret"] || req.body?.setup_secret;
            if (!providedSecret || typeof providedSecret !== "string") {
                return res.status(403).json({
                    success: false,
                    message: "Forbidden: Initial administrator registration requires a valid setup secret."
                });
            }

            const expectedBuf = Buffer.from(configuredSecret.trim());
            const providedBuf = Buffer.from(providedSecret.trim());

            const isMatch = (expectedBuf.length === providedBuf.length) &&
                crypto.timingSafeEqual(expectedBuf, providedBuf);

            if (!isMatch) {
                return res.status(403).json({
                    success: false,
                    message: "Forbidden: Invalid setup secret provided for initial administrator registration."
                });
            }

            // C. Common payload validation
            if (!full_name || !full_name.trim() || !email || !email.trim() || !password) {
                return res.status(400).json({
                    success: false,
                    message: "Full name, email, and password are required"
                });
            }

            if (typeof password !== "string" || password.length < 6) {
                return res.status(400).json({
                    success: false,
                    message: "Password must be at least 6 characters long"
                });
            }

            const normalizedEmail = email.trim().toLowerCase();

            // D. SEC-02: Check out dedicated database client from pool for transaction-atomic bootstrap
            client = await pool.connect();
            await client.query("BEGIN");

            // Acquire transaction-level advisory lock (scoped strictly to this transaction)
            // Constant integer 829471928 represents the first-admin bootstrap critical section
            const BOOTSTRAP_LOCK_ID = 829471928;
            const lockRes = await client.query(
                "SELECT pg_try_advisory_xact_lock($1) AS acquired",
                [BOOTSTRAP_LOCK_ID]
            );

            if (!lockRes.rows.length || !lockRes.rows[0].acquired) {
                await client.query("ROLLBACK");
                return res.status(409).json({
                    success: false,
                    message: "Concurrent administrator setup in progress. Please retry momentarily."
                });
            }

            // Re-check administrator count under the acquired advisory lock
            const lockedCheck = await client.query(
                "SELECT COUNT(*)::int AS count FROM users WHERE UPPER(role) = 'ADMIN'"
            );
            const verifiedCount = parseInt(lockedCheck.rows[0]?.count, 10) || 0;

            if (verifiedCount > 0) {
                await client.query("ROLLBACK");
                return res.status(403).json({
                    success: false,
                    message: "Public registration is disabled. Administrator accounts already exist. Contact an administrator for account provisioning."
                });
            }

            // Check email uniqueness within transaction
            const existing = await client.query(
                "SELECT id FROM users WHERE LOWER(email) = $1",
                [normalizedEmail]
            );

            if (existing.rows.length) {
                await client.query("ROLLBACK");
                return res.status(409).json({
                    success: false,
                    message: "Email address is already registered"
                });
            }

            const hash = await bcrypt.hash(password, 10);
            const insertResult = await client.query(
                `INSERT INTO users (full_name, email, password_hash, role, is_active)
                 VALUES ($1, $2, $3, 'ADMIN', true)
                 RETURNING id, full_name, email, role, created_at`,
                [full_name.trim(), normalizedEmail, hash]
            );

            await client.query("COMMIT");

            return res.status(201).json({
                success: true,
                message: "Initial administrator account successfully initialized",
                user: insertResult.rows[0]
            });
        } else {
            // --- STANDARD MODE: Administrator already exists ---
            const authHeader = req.headers.authorization;
            let caller = null;

            if (authHeader && authHeader.startsWith("Bearer ")) {
                try {
                    const token = authHeader.substring(7);
                    const decoded = jwt.verify(token, process.env.JWT_SECRET);
                    const callerRes = await pool.query(
                        "SELECT id, role, is_active FROM users WHERE id = $1",
                        [decoded.id]
                    );
                    if (callerRes.rows.length && callerRes.rows[0].is_active) {
                        caller = callerRes.rows[0];
                    }
                } catch (_) {
                    // Invalid/expired token
                }
            }

            if (!caller) {
                return res.status(403).json({
                    success: false,
                    message: "Public registration is disabled. Administrator accounts already exist. Contact an administrator for account provisioning."
                });
            }

            if (caller.role.toUpperCase() !== "ADMIN") {
                return res.status(403).json({
                    success: false,
                    message: "Access denied: Only administrators can create or provision accounts."
                });
            }

            // Whitelist permitted roles to prevent arbitrary privilege escalation
            const requestedRole = String(role || "TEACHER").toUpperCase().trim();
            const ALLOWED_ROLES = ["ADMIN", "TEACHER"];
            if (!ALLOWED_ROLES.includes(requestedRole)) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid role specified. Permitted roles are: ${ALLOWED_ROLES.join(", ")}`
                });
            }

            targetRole = requestedRole;

            // Common validation
            if (!full_name || !full_name.trim() || !email || !email.trim() || !password) {
                return res.status(400).json({
                    success: false,
                    message: "Full name, email, and password are required"
                });
            }

            if (typeof password !== "string" || password.length < 6) {
                return res.status(400).json({
                    success: false,
                    message: "Password must be at least 6 characters long"
                });
            }

            const normalizedEmail = email.trim().toLowerCase();
            const existing = await pool.query(
                "SELECT id FROM users WHERE LOWER(email) = $1",
                [normalizedEmail]
            );

            if (existing.rows.length) {
                return res.status(409).json({
                    success: false,
                    message: "Email address is already registered"
                });
            }

            const hash = await bcrypt.hash(password, 10);
            const result = await pool.query(
                `INSERT INTO users (full_name, email, password_hash, role, is_active)
                 VALUES ($1, $2, $3, $4, true)
                 RETURNING id, full_name, email, role, created_at`,
                [full_name.trim(), normalizedEmail, hash, targetRole]
            );

            return res.status(201).json({
                success: true,
                message: "User account created successfully",
                user: result.rows[0]
            });
        }
    } catch (error) {
        if (client) {
            try { await client.query("ROLLBACK"); } catch (_) {}
        }
        console.error("register error:", error);
        res.status(500).json({
            success: false,
            message: "Registration failed"
        });
    } finally {
        if (client) {
            client.release();
        }
    }
}

module.exports = {
    login,
    register,
    getMe,
    updateProfile,
    changePassword,
    logout
};