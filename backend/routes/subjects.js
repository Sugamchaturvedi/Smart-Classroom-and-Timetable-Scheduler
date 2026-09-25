const express = require("express");
const pool = require("../db");
const authenticate = require("../middleware/auth");

const router = express.Router();

router.get("/", authenticate, async (req, res) => {

    try {

        const result = await pool.query(
            `SELECT
                s.id,
                s.code,
                s.name,
                s.weekly_periods AS "weeklyPeriods",
                s.subject_type AS "type",
                d.name AS department
             FROM subjects s
             LEFT JOIN departments d
             ON d.id = s.department_id
             WHERE s.is_active = TRUE
             ORDER BY s.code`
        );

        res.json({
            success: true,
            data: result.rows
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Unable to fetch subjects"
        });
    }
});

router.post("/", authenticate, async (req, res) => {

    try {

        const {
            code,
            name,
            weeklyPeriods = 3,
            department_id
        } = req.body;

        const result = await pool.query(
            `INSERT INTO subjects
            (
                code,
                name,
                weekly_periods,
                department_id
            )
            VALUES ($1,$2,$3,$4)
            RETURNING *`,
            [
                code,
                name,
                weeklyPeriods,
                department_id || null
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
            message: "Unable to create subject"
        });
    }
});

module.exports = router;