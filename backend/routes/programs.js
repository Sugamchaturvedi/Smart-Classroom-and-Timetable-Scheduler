const express = require("express");
const pool = require("../db");
const authenticate = require("../middleware/auth");

const router = express.Router();

router.get("/", authenticate, async (req, res) => {

    try {

        const result = await pool.query(
            `SELECT
                id,
                code,
                name,
                degree_level,
                duration_years,
                is_active
             FROM programs
             WHERE is_active = TRUE
             ORDER BY name`
        );

        res.json({
            success: true,
            data: result.rows
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Unable to fetch programs"
        });
    }
});

router.get("/:id", authenticate, async (req, res) => {

    try {

        const result = await pool.query(
            `SELECT *
             FROM programs
             WHERE id = $1`,
            [req.params.id]
        );

        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Program not found"
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: "Unable to fetch program"
        });
    }
});

router.post("/", authenticate, async (req, res) => {

    try {

        const {
            code,
            name,
            degree_level,
            duration_years
        } = req.body;

        const result = await pool.query(
            `INSERT INTO programs
            (code, name, degree_level, duration_years)
            VALUES ($1,$2,$3,$4)
            RETURNING *`,
            [
                code,
                name,
                degree_level,
                duration_years || 4
            ]
        );

        res.status(201).json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: "Unable to create program"
        });
    }
});

module.exports = router;