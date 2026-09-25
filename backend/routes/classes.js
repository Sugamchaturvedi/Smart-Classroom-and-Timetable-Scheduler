const express = require("express");
const pool = require("../db");
const authenticate = require("../middleware/auth");

const router = express.Router();

router.get("/", authenticate, async (req, res) => {

    try {

        const {
            search = "",
            program_id,
            department_id,
            semester_id,
            page = 1,
            limit = 50
        } = req.query;

        const conditions = [
            "c.is_active = TRUE",
            "(c.name ILIKE $1 OR c.class_code ILIKE $1)"
        ];

        const values = [`%${search}%`];

        if (program_id) {
            values.push(program_id);
            conditions.push(
                `c.program_id = $${values.length}`
            );
        }

        if (department_id) {
            values.push(department_id);
            conditions.push(
                `c.department_id = $${values.length}`
            );
        }

        if (semester_id) {
            values.push(semester_id);
            conditions.push(
                `c.semester_id = $${values.length}`
            );
        }

        values.push(Number(limit));
        const limitIndex = values.length;

        values.push(
            (Number(page) - 1) * Number(limit)
        );

        const offsetIndex = values.length;

        const result = await pool.query(
            `SELECT
                c.id,
                c.class_code,
                c.name,
                c.student_count AS students,
                p.code AS program_code,
                p.name AS program_name,
                d.name AS department,

                COALESCE(
                    json_agg(
                        json_build_object(
                            'id', sec.id,
                            'name', sec.name,
                            'students', sec.student_count
                        )
                    ) FILTER (WHERE sec.id IS NOT NULL),
                    '[]'
                ) AS sections

             FROM classes c

             LEFT JOIN programs p
             ON p.id = c.program_id

             LEFT JOIN departments d
             ON d.id = c.department_id

             LEFT JOIN sections sec
             ON sec.class_id = c.id

             WHERE ${conditions.join(" AND ")}

             GROUP BY
                c.id,
                p.code,
                p.name,
                d.name

             ORDER BY c.id

             LIMIT $${limitIndex}
             OFFSET $${offsetIndex}`,
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
            message: "Unable to fetch classes"
        });
    }
});

router.post("/", authenticate, async (req, res) => {

    try {

        const {
            name,
            section = "A",
            students = 0,
            program_id
        } = req.body;

        const programResult = await pool.query(
            `SELECT id, code
             FROM programs
             WHERE id = $1`,
            [program_id]
        );

        if (!programResult.rows.length) {
            return res.status(400).json({
                success: false,
                message: "Invalid program"
            });
        }

        const program = programResult.rows[0];

        const result = await pool.query(
            `INSERT INTO classes
            (
                class_code,
                name,
                program_id,
                student_count
            )
            VALUES ($1,$2,$3,$4)
            RETURNING *`,
            [
                `${program.code}-${Date.now()}`,
                name,
                program_id,
                students
            ]
        );

        const classId = result.rows[0].id;

        await pool.query(
            `INSERT INTO sections
            (class_id, name, student_count)
            VALUES ($1,$2,$3)
            ON CONFLICT DO NOTHING`,
            [
                classId,
                section,
                students
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
            message: "Unable to create class"
        });
    }
});

module.exports = router;