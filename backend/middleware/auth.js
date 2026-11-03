const jwt = require("jsonwebtoken");
const pool = require("../db");

/**
 * Validates JWT token and hydrates fresh user state from PostgreSQL
 */
async function authenticate(req, res, next) {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
        return res.status(401).json({
            success: false,
            message: "Authentication required"
        });
    }

    const token = header.substring(7);

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Fetch fresh user data from database to ensure account is active and role is accurate
        const userRes = await pool.query(
            `SELECT u.id, u.full_name, u.email, u.role, u.is_active, u.department_id, u.phone, u.avatar_url,
                    d.name AS department_name
             FROM users u
             LEFT JOIN departments d ON d.id = u.department_id
             WHERE u.id = $1`,
            [decoded.id]
        );

        if (!userRes.rows.length) {
            return res.status(401).json({
                success: false,
                message: "User account no longer exists"
            });
        }

        const dbUser = userRes.rows[0];

        if (!dbUser.is_active) {
            return res.status(403).json({
                success: false,
                message: "Account has been deactivated. Please contact an administrator."
            });
        }

        const normalizedRole = (dbUser.role || "TEACHER").toUpperCase();

        let teacherRecord = null;
        if (normalizedRole === "TEACHER" || decoded.teacherId) {
            const teacherRes = await pool.query(
                `SELECT t.id, t.teacher_code, t.full_name, t.department_id, d.name AS department_name
                 FROM teachers t
                 LEFT JOIN departments d ON d.id = t.department_id
                 WHERE t.user_id = $1
                 LIMIT 1`,
                [dbUser.id]
            );
            if (teacherRes.rows.length) {
                teacherRecord = teacherRes.rows[0];
            }
        }

        req.user = {
            id: dbUser.id,
            email: dbUser.email,
            name: dbUser.full_name,
            role: normalizedRole,
            phone: dbUser.phone,
            avatarUrl: dbUser.avatar_url,
            departmentId: teacherRecord ? teacherRecord.department_id : dbUser.department_id,
            departmentName: teacherRecord ? teacherRecord.department_name : dbUser.department_name,
            teacherId: teacherRecord ? teacherRecord.id : null,
            teacherCode: teacherRecord ? teacherRecord.teacher_code : null
        };

        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: "Invalid or expired session token"
        });
    }
}

/**
 * Middleware: Strictly requires ADMIN role
 */
function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== "ADMIN") {
        return res.status(403).json({
            success: false,
            message: "Access denied: Administrator privileges required"
        });
    }
    next();
}

/**
 * Middleware: Requires TEACHER (or ADMIN) role
 */
function requireTeacher(req, res, next) {
    if (!req.user || (req.user.role !== "TEACHER" && req.user.role !== "ADMIN")) {
        return res.status(403).json({
            success: false,
            message: "Access denied: Teacher account required"
        });
    }
    next();
}

/**
 * Middleware: Enforces that teachers cannot access or modify other teachers' data
 */
function requireTeacherOwnership(paramField = "teacherId") {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ success: false, message: "Authentication required" });
        }

        if (req.user.role === "ADMIN") {
            return next(); // Admins have elevated access
        }

        const requestedTeacherId = req.params[paramField] || req.query[paramField] || req.body[paramField];
        if (requestedTeacherId && String(requestedTeacherId) !== String(req.user.teacherId)) {
            return res.status(403).json({
                success: false,
                message: "Forbidden: You are not authorized to access another teacher's private information"
            });
        }
        next();
    };
}

module.exports = authenticate;
module.exports.authenticate = authenticate;
module.exports.requireAdmin = requireAdmin;
module.exports.requireTeacher = requireTeacher;
module.exports.requireTeacherOwnership = requireTeacherOwnership;