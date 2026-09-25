const pool = require("../db");

async function getSections(req, res) {
    try {
        const { class_id } = req.query;

        if (!class_id) {
            return res.status(400).json({
                success: false,
                message: "class_id is required"
            });
        }

        const result = await pool.query(
            `SELECT
                id,
                class_id,
                name,
                student_count,
                is_active
             FROM sections
             WHERE class_id = $1
               AND is_active = true
             ORDER BY id`,
            [class_id]
        );

        res.json({
            success: true,
            data: result.rows
        });
    } catch (error) {
        console.error("Get sections error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to fetch sections"
        });
    }
}

module.exports = {
    getSections
};
