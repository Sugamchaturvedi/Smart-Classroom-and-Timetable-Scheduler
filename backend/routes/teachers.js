const express = require("express");
const pool = require("../db");
const authenticate = require("../middleware/auth");

const router = express.Router();

router.get("/", authenticate, async (req, res) => {

    try {

        const {
            search = "",
            department = "",
            page = 1,
            limit = 50
        } = req.query;

        const offset = (Number(page) - 1) * Number(limit);

        const values = [
            `%${search}%`,
            `%${department}%`,
            Number(limit),
            offset
        ];

        const result = await pool.query(
            `SELECT
                t.id,
                t.teacher_code AS "teacherId",
                t.full_name AS name,
                COALESCE(d.name, 'General') AS department,

                COALESCE(
                    json_agg(
                        DISTINCT jsonb_build_object(
                            'id', s.id,
                            'code', s.code,
                            'name', s.name
                        )
                    ) FILTER (WHERE s.id IS NOT NULL),
                    '[]'
                ) AS subjects

             FROM teachers t

             LEFT JOIN departments d
             ON d.id = t.department_id

             LEFT JOIN teacher_subjects ts
             ON ts.teacher_id = t.id

             LEFT JOIN subjects s
             ON s.id = ts.subject_id

             WHERE t.is_active = TRUE
             AND (
                 t.full_name ILIKE $1
                 OR t.teacher_code ILIKE $1
             )
             AND COALESCE(d.name, '') ILIKE $2

             GROUP BY
                t.id,
                t.teacher_code,
                t.full_name,
                d.name

             ORDER BY t.id

             LIMIT $3
             OFFSET $4`,
            values
        );

        res.json({
            success: true,
            page: Number(page),
            limit: Number(limit),
            data: result.rows
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Unable to fetch teachers"
        });
    }
});

router.get("/:id", authenticate, async (req, res) => {

    try {

        const result = await pool.query(
            `SELECT
                t.id,
                t.teacher_code AS "teacherId",
                t.full_name AS name,
                d.name AS department
             FROM teachers t
             LEFT JOIN departments d
             ON d.id = t.department_id
             WHERE t.id = $1`,
            [req.params.id]
        );

        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Teacher not found"
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: "Unable to fetch teacher"
        });
    }
});

router.post("/", authenticate, async (req, res) => {

    try {

        const {
            teacherId,
            name,
            department
        } = req.body;

        const departmentResult = await pool.query(
            `SELECT id
             FROM departments
             WHERE name = $1
             LIMIT 1`,
            [department]
        );

        const departmentId =
            departmentResult.rows[0]?.id || null;

        const result = await pool.query(
            `INSERT INTO teachers
            (teacher_code, full_name, department_id)
            VALUES ($1,$2,$3)
            RETURNING
                id,
                teacher_code AS "teacherId",
                full_name AS name`,
            [
                teacherId,
                name,
                departmentId
            ]
        );

        res.status(201).json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Unable to create teacher"
        });
    }
});

router.put("/:id", authenticate, async (req, res) => {

    try {

        const {
            teacherId,
            name,
            department
        } = req.body;

        const departmentResult = await pool.query(
            `SELECT id
             FROM departments
             WHERE name = $1
             LIMIT 1`,
            [department]
        );

        const departmentId =
            departmentResult.rows[0]?.id || null;

        const result = await pool.query(
            `UPDATE teachers
             SET
                teacher_code = $1,
                full_name = $2,
                department_id = $3
             WHERE id = $4
             RETURNING
                id,
                teacher_code AS "teacherId",
                full_name AS name`,
            [
                teacherId,
                name,
                departmentId,
                req.params.id
            ]
        );

        res.json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: "Unable to update teacher"
        });
    }
});

router.delete("/:id", authenticate, async (req, res) => {

    try {

        await pool.query(
            `UPDATE teachers
             SET is_active = FALSE
             WHERE id = $1`,
            [req.params.id]
        );

        res.json({
            success: true,
            message: "Teacher deactivated"
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: "Unable to delete teacher"
        });
    }
});

module.exports = router;