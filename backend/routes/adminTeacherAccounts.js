const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const pool = require("../db");
const { authenticate, requireAdmin } = require("../middleware/auth");

const router = express.Router();

// Enforce both authentication and administrator privileges for all endpoints in this router
router.use(authenticate, requireAdmin);

/**
 * Helper to generate a strong random temporary password
 */
function generateSecurePassword() {
    const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let pwd = "";
    for (let i = 0; i < 8; i++) {
        pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `Teach#${pwd}!`;
}

/**
 * GET /api/admin/teacher-accounts
 * Lists teachers with their account status, email, and activity counters
 */
router.get("/", async (req, res) => {
    try {
        const {
            search = "",
            status = "all",
            department = "",
            page = 1,
            limit = 50
        } = req.query;

        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.min(1000, Math.max(1, parseInt(limit) || 50));
        const offset = (pageNum - 1) * limitNum;

        // 1. Fetch high-level summary counters
        const summaryRes = await pool.query(`
            SELECT
                COUNT(t.id) AS total_teachers,
                COUNT(u.id) FILTER (WHERE u.id IS NOT NULL AND u.is_active = TRUE) AS active_accounts,
                COUNT(u.id) FILTER (WHERE u.id IS NOT NULL AND u.is_active = FALSE) AS inactive_accounts,
                COUNT(t.id) FILTER (WHERE u.id IS NULL) AS uncreated_accounts
            FROM teachers t
            LEFT JOIN users u ON u.id = t.user_id
        `);

        const summary = {
            total: parseInt(summaryRes.rows[0].total_teachers) || 0,
            totalTeachers: parseInt(summaryRes.rows[0].total_teachers) || 0,
            active: parseInt(summaryRes.rows[0].active_accounts) || 0,
            activeAccounts: parseInt(summaryRes.rows[0].active_accounts) || 0,
            inactive: parseInt(summaryRes.rows[0].inactive_accounts) || 0,
            inactiveAccounts: parseInt(summaryRes.rows[0].inactive_accounts) || 0,
            uncreated: parseInt(summaryRes.rows[0].uncreated_accounts) || 0,
            uncreatedAccounts: parseInt(summaryRes.rows[0].uncreated_accounts) || 0
        };

        // 2. Build filtered query
        const conditions = [];
        const params = [];

        if (search && search.trim()) {
            params.push(`%${search.trim()}%`);
            conditions.push(`(
                t.full_name ILIKE $${params.length}
                OR t.teacher_code ILIKE $${params.length}
                OR COALESCE(u.email, t.email, '') ILIKE $${params.length}
            )`);
        }

        if (department && department.trim()) {
            params.push(department.trim());
            conditions.push(`d.name = $${params.length}`);
        }

        if (status === "active") {
            conditions.push("u.id IS NOT NULL AND u.is_active = TRUE");
        } else if (status === "inactive") {
            conditions.push("u.id IS NOT NULL AND u.is_active = FALSE");
        } else if (status === "uncreated") {
            conditions.push("u.id IS NULL");
        }

        const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

        // Total count for current filters
        const countRes = await pool.query(`
            SELECT COUNT(t.id) AS filtered_count
            FROM teachers t
            LEFT JOIN users u ON u.id = t.user_id
            LEFT JOIN departments d ON d.id = t.department_id
            ${whereSql}
        `, params);

        const totalFiltered = parseInt(countRes.rows[0].filtered_count) || 0;

        // Fetch teachers page
        const queryParams = [...params, limitNum, offset];
        const teachersRes = await pool.query(`
            SELECT
                t.id AS teacher_id,
                t.teacher_code,
                t.full_name,
                t.department_id,
                COALESCE(d.name, 'General Faculty') AS department_name,
                t.user_id,
                u.email AS user_email,
                t.email AS teacher_email,
                COALESCE(u.email, t.email) AS email,
                u.is_active AS user_active,
                u.last_login,
                u.created_at AS account_created_at,
                CASE
                    WHEN u.id IS NULL THEN 'uncreated'
                    WHEN u.is_active = FALSE THEN 'inactive'
                    ELSE 'active'
                END AS account_status
            FROM teachers t
            LEFT JOIN users u ON u.id = t.user_id
            LEFT JOIN departments d ON d.id = t.department_id
            ${whereSql}
            ORDER BY t.id ASC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `, queryParams);

        const formatted = teachersRes.rows.map(r => ({
            id: r.teacher_id,
            teacherId: r.teacher_id,
            teacher_id: r.teacher_id,
            teacherCode: r.teacher_code,
            teacher_code: r.teacher_code,
            name: r.full_name,
            teacher_name: r.full_name,
            fullName: r.full_name,
            full_name: r.full_name,
            department: r.department_name,
            department_name: r.department_name,
            departmentId: r.department_id,
            department_id: r.department_id,
            userId: r.user_id,
            user_id: r.user_id,
            email: r.email || `${r.teacher_code.toLowerCase()}@brightfield.edu`,
            teacherEmail: r.teacher_email,
            teacher_email: r.teacher_email,
            userEmail: r.user_email,
            accountEmail: r.user_email || (r.user_id ? r.email : null),
            account_email: r.user_email || (r.user_id ? r.email : null),
            hasAccount: r.user_id !== null,
            has_account: r.user_id !== null,
            accountStatus: r.account_status,
            account_status: r.account_status,
            isActive: r.user_id !== null ? (r.user_active ?? false) : false,
            is_active: r.user_id !== null ? (r.user_active ?? false) : false,
            accountActive: r.user_id !== null ? (r.user_active ?? false) : false,
            account_active: r.user_id !== null ? (r.user_active ?? false) : false,
            lastLogin: r.last_login,
            last_login: r.last_login,
            createdAt: r.account_created_at,
            created_at: r.account_created_at
        }));

        res.json({
            success: true,
            summary,
            data: formatted,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: totalFiltered,
                totalPages: Math.ceil(totalFiltered / limitNum) || 1
            }
        });
    } catch (error) {
        console.error("GET /api/admin/teacher-accounts error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to retrieve teacher accounts directory"
        });
    }
});

/**
 * POST /api/admin/teacher-accounts
 * Provisions an individual teacher account
 */
router.post("/", async (req, res) => {
    const client = await pool.connect();
    try {
        const rawTeacherId = req.body.teacherId ?? req.body.teacher_id;
        const teacherId = parseInt(rawTeacherId, 10);
        const { email, password } = req.body;

        if (!teacherId || isNaN(teacherId)) {
            return res.status(400).json({
                success: false,
                message: "A valid teacher ID is required"
            });
        }

        // Validate email format if provided
        if (email && email.trim()) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email.trim())) {
                return res.status(400).json({
                    success: false,
                    message: "A valid email address format is required"
                });
            }
        }

        // 1. Verify teacher exists
        const teacherRes = await client.query(
            "SELECT id, teacher_code, full_name, user_id, department_id, email FROM teachers WHERE id = $1",
            [teacherId]
        );

        if (!teacherRes.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Teacher record not found"
            });
        }

        const teacher = teacherRes.rows[0];

        if (teacher.user_id) {
            return res.status(409).json({
                success: false,
                message: "This faculty member already has an active or existing user account."
            });
        }

        // 2. Determine target email (prefer provided email, fallback to teacher record email, fallback to brightfield default)
        const targetEmail = (email && email.trim()) 
            ? email.trim().toLowerCase() 
            : (teacher.email ? teacher.email.trim().toLowerCase() : `${teacher.teacher_code.toLowerCase()}@brightfield.edu`);

        // Check email uniqueness in users
        const emailCheck = await client.query(
            "SELECT id FROM users WHERE LOWER(email) = LOWER($1)",
            [targetEmail]
        );

        if (emailCheck.rows.length) {
            return res.status(409).json({
                success: false,
                message: `The email ${targetEmail} is already assigned to another user account.`
            });
        }

        // Check email uniqueness across other teachers with user accounts
        const teacherEmailCheck = await client.query(
            "SELECT id FROM teachers WHERE LOWER(email) = LOWER($1) AND id != $2 AND user_id IS NOT NULL",
            [targetEmail, teacher.id]
        );

        if (teacherEmailCheck.rows.length) {
            return res.status(409).json({
                success: false,
                message: `The email ${targetEmail} is already linked to another teacher account.`
            });
        }

        // 3. Determine password
        const rawPassword = (password && password.trim().length >= 6)
            ? password.trim()
            : generateSecurePassword();

        const hash = await bcrypt.hash(rawPassword, 10);

        await client.query("BEGIN");

        // Insert new user with TEACHER role
        const userInsert = await client.query(
            `INSERT INTO users (full_name, email, password_hash, role, is_active, department_id, last_login)
             VALUES ($1, $2, $3, 'TEACHER', true, $4, NULL)
             RETURNING id, full_name, email, role, is_active, created_at`,
            [teacher.full_name, targetEmail, hash, teacher.department_id]
        );

        const newUserId = userInsert.rows[0].id;

        // Link teacher record safely ensuring user_id is still NULL
        const updateResult = await client.query(
            "UPDATE teachers SET user_id = $1, email = $2 WHERE id = $3 AND user_id IS NULL",
            [newUserId, targetEmail, teacher.id]
        );

        if (updateResult.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(409).json({
                success: false,
                message: "Concurrent update: This faculty member was already provisioned an account."
            });
        }

        // Audit log
        try {
            await client.query(
                `INSERT INTO audit_logs (user_id, action, entity, entity_id, description)
                 VALUES ($1, 'TEACHER_ACCOUNT_CREATED', 'teachers', $2, $3)`,
                [req.user.id, String(teacher.id), `Provisioned teacher account for ${teacher.full_name} (${targetEmail})`]
            );
        } catch (_) {}

        await client.query("COMMIT");

        res.status(201).json({
            success: true,
            message: `Account created successfully for ${teacher.full_name}`,
            data: {
                teacherId: teacher.id,
                teacher_id: teacher.id,
                teacherCode: teacher.teacher_code,
                teacher_code: teacher.teacher_code,
                name: teacher.full_name,
                teacher_name: teacher.full_name,
                userId: newUserId,
                user_id: newUserId,
                email: targetEmail,
                role: "TEACHER",
                accountStatus: "active"
            },
            temporaryPassword: rawPassword
        });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("POST /api/admin/teacher-accounts error:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Failed to create teacher account"
        });
    } finally {
        client.release();
    }
});

/**
 * PATCH /api/admin/teacher-accounts/:id/status
 * Activates or deactivates an existing teacher account
 */
router.patch("/:id/status", async (req, res) => {
    try {
        const teacherId = req.params.id;
        const rawActive = req.body.isActive !== undefined ? req.body.isActive : req.body.is_active;

        if (rawActive === undefined || rawActive === null) {
            return res.status(400).json({
                success: false,
                message: "isActive (boolean) is required"
            });
        }

        const isActive = typeof rawActive === "boolean" ? rawActive : (rawActive === "true" || rawActive === 1 || rawActive === "1");

        const teacherRes = await pool.query(
            "SELECT id, full_name, user_id FROM teachers WHERE id = $1",
            [teacherId]
        );

        if (!teacherRes.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Teacher not found"
            });
        }

        const teacher = teacherRes.rows[0];

        if (!teacher.user_id) {
            return res.status(400).json({
                success: false,
                message: "Cannot modify status because this teacher does not have a user account yet."
            });
        }

        await pool.query(
            "UPDATE users SET is_active = $1 WHERE id = $2",
            [!!isActive, teacher.user_id]
        );

        // Audit log
        try {
            await pool.query(
                `INSERT INTO audit_logs (user_id, action, entity, entity_id, description)
                 VALUES ($1, $2, 'users', $3, $4)`,
                [
                    req.user.id,
                    isActive ? "TEACHER_ACCOUNT_ACTIVATED" : "TEACHER_ACCOUNT_DEACTIVATED",
                    String(teacher.user_id),
                    `Admin set status of teacher ${teacher.full_name} to ${isActive ? 'Active' : 'Inactive'}`
                ]
            );
        } catch (_) {}

        res.json({
            success: true,
            message: `Account for ${teacher.full_name} is now ${isActive ? "Active" : "Inactive"}`,
            accountStatus: isActive ? "active" : "inactive"
        });
    } catch (error) {
        console.error("PATCH /api/admin/teacher-accounts/:id/status error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to update account status"
        });
    }
});

/**
 * POST /api/admin/teacher-accounts/:id/reset-password
 * Resets a teacher's password securely
 */
router.post("/:id/reset-password", async (req, res) => {
    try {
        const teacherId = req.params.id;
        const rawPassword = req.body.newPassword || req.body.new_password;

        const teacherRes = await pool.query(
            "SELECT id, full_name, user_id FROM teachers WHERE id = $1",
            [teacherId]
        );

        if (!teacherRes.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Teacher not found"
            });
        }

        const teacher = teacherRes.rows[0];

        if (!teacher.user_id) {
            return res.status(400).json({
                success: false,
                message: "Teacher does not have an active user account to reset."
            });
        }

        const passwordToSet = (rawPassword && typeof rawPassword === "string" && rawPassword.trim().length >= 6)
            ? rawPassword.trim()
            : generateSecurePassword();

        const hash = await bcrypt.hash(passwordToSet, 10);

        await pool.query(
            "UPDATE users SET password_hash = $1 WHERE id = $2",
            [hash, teacher.user_id]
        );

        // Audit log
        try {
            await pool.query(
                `INSERT INTO audit_logs (user_id, action, entity, entity_id, description)
                 VALUES ($1, 'TEACHER_PASSWORD_RESET', 'users', $2, $3)`,
                [req.user.id, String(teacher.user_id), `Admin reset password for teacher ${teacher.full_name}`]
            );
        } catch (_) {}

        res.json({
            success: true,
            message: `Password reset successfully for ${teacher.full_name}`,
            temporaryPassword: passwordToSet,
            temporary_password: passwordToSet
        });
    } catch (error) {
        console.error("POST /api/admin/teacher-accounts/:id/reset-password error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to reset teacher password"
        });
    }
});

/**
 * POST /api/admin/teacher-accounts/batch-create
 * Administrator-controlled "Create Missing Accounts" workflow
 * Creates user accounts for teachers that do not have one yet.
 */
router.post("/batch-create", async (req, res) => {
    const client = await pool.connect();
    try {
        const { limit = 50, department_id } = req.body;
        const batchLimit = Math.min(500, Math.max(1, parseInt(limit) || 50));

        let query = `
            SELECT t.id, t.teacher_code, t.full_name, t.department_id
            FROM teachers t
            WHERE t.user_id IS NULL AND t.is_active = TRUE
        `;
        const params = [];

        if (department_id) {
            params.push(department_id);
            query += ` AND t.department_id = $1`;
        }

        params.push(batchLimit);
        query += ` ORDER BY t.id ASC LIMIT $${params.length}`;

        const unprovisionedRes = await client.query(query, params);
        const teachers = unprovisionedRes.rows;

        if (!teachers.length) {
            return res.json({
                success: true,
                message: "All selected teachers already possess active user accounts.",
                createdCount: 0,
                accounts: []
            });
        }

        await client.query("BEGIN");

        const createdAccounts = [];

        for (const t of teachers) {
            const rawEmail = `${t.teacher_code.toLowerCase()}@brightfield.edu`;
            const rawPassword = generateSecurePassword();
            const hash = await bcrypt.hash(rawPassword, 10);

            // Double check email collision
            const emailCheck = await client.query(
                "SELECT id FROM users WHERE LOWER(email) = LOWER($1)",
                [rawEmail]
            );

            let effectiveEmail = rawEmail;
            if (emailCheck.rows.length) {
                effectiveEmail = `fac-${t.id}-${t.teacher_code.toLowerCase()}@brightfield.edu`;
            }

            const userInsert = await client.query(
                `INSERT INTO users (full_name, email, password_hash, role, is_active, department_id)
                 VALUES ($1, $2, $3, 'TEACHER', true, $4)
                 RETURNING id`,
                [t.full_name, effectiveEmail, hash, t.department_id]
            );

            const newUserId = userInsert.rows[0].id;

            await client.query(
                "UPDATE teachers SET user_id = $1, email = $2 WHERE id = $3",
                [newUserId, effectiveEmail, t.id]
            );

            createdAccounts.push({
                teacherId: t.id,
                teacherCode: t.teacher_code,
                name: t.full_name,
                email: effectiveEmail,
                temporaryPassword: rawPassword
            });
        }

        // Audit log
        try {
            await client.query(
                `INSERT INTO audit_logs (user_id, action, entity, entity_id, description)
                 VALUES ($1, 'BATCH_TEACHER_PROVISIONING', 'teachers', 'bulk', $2)`,
                [req.user.id, `Batch created ${createdAccounts.length} teacher accounts`]
            );
        } catch (_) {}

        await client.query("COMMIT");

        res.status(201).json({
            success: true,
            message: `Successfully provisioned ${createdAccounts.length} teacher account(s)`,
            createdCount: createdAccounts.length,
            accounts: createdAccounts
        });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("POST /api/admin/teacher-accounts/batch-create error:", error);
        res.status(500).json({
            success: false,
            message: "Batch account provisioning failed"
        });
    } finally {
        client.release();
    }
});

module.exports = router;
