const pool = require("../db");

/**
 * GET /api/study-plans
 * Retrieve study plans with optional filtering and pagination
 */
async function getStudyPlans(req, res) {
    try {
        const {
            program_id,
            department_id,
            semester_number,
            subject_id,
            academic_year,
            search = "",
            page = 1,
            limit = 50
        } = req.query;

        const conditions = [];
        const values = [];

        if (program_id) {
            values.push(Number(program_id));
            conditions.push(`sp.program_id = $${values.length}`);
        }

        if (department_id) {
            values.push(Number(department_id));
            conditions.push(`sp.department_id = $${values.length}`);
        }

        if (semester_number) {
            values.push(Number(semester_number));
            conditions.push(`sp.semester_number = $${values.length}`);
        }

        if (subject_id) {
            values.push(Number(subject_id));
            conditions.push(`sp.subject_id = $${values.length}`);
        }

        if (academic_year) {
            values.push(academic_year);
            conditions.push(`sp.academic_year = $${values.length}`);
        }

        if (search.trim()) {
            values.push(`%${search.trim()}%`);
            conditions.push(`(
                sp.title ILIKE $${values.length}
                OR s.name ILIKE $${values.length}
                OR s.code ILIKE $${values.length}
                OR p.name ILIKE $${values.length}
                OR p.code ILIKE $${values.length}
                OR tr.full_name ILIKE $${values.length}
                OR sp.description ILIKE $${values.length}
            )`);
        }

        const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

        // Count total matching
        const countQuery = await pool.query(
            `SELECT COUNT(*)::int AS total
             FROM study_plans sp
             JOIN programs p ON p.id = sp.program_id
             JOIN subjects s ON s.id = sp.subject_id
             LEFT JOIN departments d ON d.id = sp.department_id
             LEFT JOIN teachers tr ON tr.id = sp.teacher_id
             ${whereClause}`,
            values
        );
        const total = countQuery.rows[0].total;

        // Pagination
        values.push(Number(limit));
        const limitIndex = values.length;
        values.push((Number(page) - 1) * Number(limit));
        const offsetIndex = values.length;

        const query = `
            SELECT
                sp.id,
                sp.title,
                sp.program_id AS "programId",
                p.code AS "programCode",
                p.name AS "programName",
                sp.department_id AS "departmentId",
                d.name AS "departmentName",
                sp.semester_number AS "semesterNumber",
                sp.academic_year AS "academicYear",
                sp.subject_id AS "subjectId",
                s.code AS "subjectCode",
                s.name AS "subjectName",
                sp.teacher_id AS "teacherId",
                tr.full_name AS "teacherName",
                sp.credits,
                sp.status,
                sp.description,
                sp.objectives,
                sp.modules,
                sp.created_at AS "createdAt",
                sp.updated_at AS "updatedAt"
            FROM study_plans sp
            JOIN programs p ON p.id = sp.program_id
            JOIN subjects s ON s.id = sp.subject_id
            LEFT JOIN departments d ON d.id = sp.department_id
            LEFT JOIN teachers tr ON tr.id = sp.teacher_id
            ${whereClause}
            ORDER BY sp.id DESC
            LIMIT $${limitIndex}
            OFFSET $${offsetIndex}
        `;

        const result = await pool.query(query, values);

        res.json({
            success: true,
            total,
            page: Number(page),
            limit: Number(limit),
            data: result.rows
        });
    } catch (error) {
        console.error("Get study plans error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to fetch study plans"
        });
    }
}

/**
 * GET /api/study-plans/:id
 * Retrieve single study plan with detailed metadata
 */
async function getStudyPlanById(req, res) {
    try {
        const { id } = req.params;

        const query = `
            SELECT
                sp.id,
                sp.title,
                sp.program_id AS "programId",
                p.code AS "programCode",
                p.name AS "programName",
                sp.department_id AS "departmentId",
                d.name AS "departmentName",
                sp.semester_number AS "semesterNumber",
                sp.academic_year AS "academicYear",
                sp.subject_id AS "subjectId",
                s.code AS "subjectCode",
                s.name AS "subjectName",
                sp.teacher_id AS "teacherId",
                tr.full_name AS "teacherName",
                sp.credits,
                sp.status,
                sp.description,
                sp.objectives,
                sp.modules,
                sp.created_by AS "createdBy",
                u.full_name AS "creatorName",
                sp.created_at AS "createdAt",
                sp.updated_at AS "updatedAt"
            FROM study_plans sp
            JOIN programs p ON p.id = sp.program_id
            JOIN subjects s ON s.id = sp.subject_id
            LEFT JOIN departments d ON d.id = sp.department_id
            LEFT JOIN teachers tr ON tr.id = sp.teacher_id
            LEFT JOIN users u ON u.id = sp.created_by
            WHERE sp.id = $1
        `;

        const result = await pool.query(query, [id]);

        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Study plan not found"
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });
    } catch (error) {
        console.error("Get study plan by ID error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to fetch study plan details"
        });
    }
}

/**
 * POST /api/study-plans
 * Create a new study plan
 */
async function createStudyPlan(req, res) {
    try {
        const {
            title,
            program_id,
            department_id,
            semester_number = 1,
            subject_id,
            teacher_id,
            academic_year = "2026-27",
            credits = 3,
            status = "Active",
            description = "",
            objectives = "",
            modules = []
        } = req.body;

        if (!title || !program_id || !subject_id) {
            return res.status(400).json({
                success: false,
                message: "Title, program, and subject are required"
            });
        }

        const modulesJson = typeof modules === "string" ? modules : JSON.stringify(modules || []);

        const result = await pool.query(
            `INSERT INTO study_plans
            (
                title,
                program_id,
                department_id,
                semester_number,
                subject_id,
                teacher_id,
                academic_year,
                credits,
                status,
                description,
                objectives,
                modules,
                created_by
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
            RETURNING *`,
            [
                title,
                program_id,
                department_id || null,
                semester_number,
                subject_id,
                teacher_id || null,
                academic_year,
                credits,
                status,
                description,
                objectives,
                modulesJson,
                req.user?.id || null
            ]
        );

        // Audit log
        await pool.query(
            `INSERT INTO audit_logs (user_id, action, entity, entity_id, description)
             VALUES ($1, 'create', 'Study Plan', $2, $3)`,
            [
                req.user?.id || null,
                String(result.rows[0].id),
                `Created study plan "${title}" for program ID ${program_id}`
            ]
        );

        res.status(201).json({
            success: true,
            message: "Study plan created successfully",
            data: result.rows[0]
        });
    } catch (error) {
        console.error("Create study plan error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to create study plan: " + error.message
        });
    }
}

/**
 * PUT /api/study-plans/:id
 * Update an existing study plan
 */
async function updateStudyPlan(req, res) {
    try {
        const { id } = req.params;

        const existing = await pool.query("SELECT * FROM study_plans WHERE id = $1", [id]);
        if (!existing.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Study plan not found"
            });
        }

        const current = existing.rows[0];
        const {
            title = current.title,
            program_id = current.program_id,
            department_id = current.department_id,
            semester_number = current.semester_number,
            subject_id = current.subject_id,
            teacher_id = current.teacher_id,
            academic_year = current.academic_year,
            credits = current.credits,
            status = current.status,
            description = current.description,
            objectives = current.objectives,
            modules = current.modules
        } = req.body;

        const modulesJson = typeof modules === "string" ? modules : JSON.stringify(modules || []);

        const result = await pool.query(
            `UPDATE study_plans
             SET
                title = $1,
                program_id = $2,
                department_id = $3,
                semester_number = $4,
                subject_id = $5,
                teacher_id = $6,
                academic_year = $7,
                credits = $8,
                status = $9,
                description = $10,
                objectives = $11,
                modules = $12::jsonb,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $13
             RETURNING *`,
            [
                title,
                program_id,
                department_id || null,
                semester_number,
                subject_id,
                teacher_id || null,
                academic_year,
                credits,
                status,
                description,
                objectives,
                modulesJson,
                id
            ]
        );

        // Audit log
        await pool.query(
            `INSERT INTO audit_logs (user_id, action, entity, entity_id, description)
             VALUES ($1, 'update', 'Study Plan', $2, $3)`,
            [
                req.user?.id || null,
                String(id),
                `Updated study plan "${title}"`
            ]
        );

        res.json({
            success: true,
            message: "Study plan updated successfully",
            data: result.rows[0]
        });
    } catch (error) {
        console.error("Update study plan error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to update study plan: " + error.message
        });
    }
}

/**
 * DELETE /api/study-plans/:id
 * Delete a study plan
 */
async function deleteStudyPlan(req, res) {
    try {
        const { id } = req.params;

        const existing = await pool.query("SELECT title FROM study_plans WHERE id = $1", [id]);
        if (!existing.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Study plan not found"
            });
        }

        const title = existing.rows[0].title;

        await pool.query("DELETE FROM study_plans WHERE id = $1", [id]);

        // Audit log
        await pool.query(
            `INSERT INTO audit_logs (user_id, action, entity, entity_id, description)
             VALUES ($1, 'delete', 'Study Plan', $2, $3)`,
            [
                req.user?.id || null,
                String(id),
                `Deleted study plan "${title}"`
            ]
        );

        res.json({
            success: true,
            message: "Study plan deleted successfully"
        });
    } catch (error) {
        console.error("Delete study plan error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to delete study plan"
        });
    }
}

module.exports = {
    getStudyPlans,
    getStudyPlanById,
    createStudyPlan,
    updateStudyPlan,
    deleteStudyPlan
};
