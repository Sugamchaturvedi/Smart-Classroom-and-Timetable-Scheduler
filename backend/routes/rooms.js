const express = require("express");
const pool = require("../db");
const authenticate = require("../middleware/auth");

const router = express.Router();

router.get("/", authenticate, async (req, res) => {

    try {

        const {
            room_type,
            min_capacity,
            page = 1,
            limit = 100
        } = req.query;

        const conditions = [
            "r.is_active = TRUE"
        ];

        const values = [];

        if (room_type) {
            values.push(room_type);
            conditions.push(
                `r.room_type = $${values.length}`
            );
        }

        if (min_capacity) {
            values.push(Number(min_capacity));
            conditions.push(
                `r.capacity >= $${values.length}`
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
                r.id,
                r.room_number AS number,
                r.capacity,
                r.room_type AS type,
                b.name AS building

             FROM rooms r

             LEFT JOIN buildings b
             ON b.id = r.building_id

             WHERE ${conditions.join(" AND ")}

             ORDER BY r.room_number

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
            message: "Unable to fetch rooms"
        });
    }
});

router.post("/", authenticate, async (req, res) => {

    try {

        const {
            number,
            building,
            capacity,
            type
        } = req.body;

        let buildingResult = await pool.query(
            `SELECT id
             FROM buildings
             WHERE name = $1`,
            [building]
        );

        let buildingId;

        if (buildingResult.rows.length) {

            buildingId = buildingResult.rows[0].id;

        } else {

            const created = await pool.query(
                `INSERT INTO buildings(name)
                 VALUES ($1)
                 RETURNING id`,
                [building]
            );

            buildingId = created.rows[0].id;
        }

        const result = await pool.query(
            `INSERT INTO rooms
            (
                room_number,
                building_id,
                capacity,
                room_type
            )
            VALUES ($1,$2,$3,$4)
            RETURNING *`,
            [
                number,
                buildingId,
                capacity,
                type
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
            message: "Unable to create room"
        });
    }
});

module.exports = router;