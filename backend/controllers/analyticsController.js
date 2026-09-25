const pool = require("../db");

async function dashboard(req, res) {

    try {

        const [
            teachers,
            classes,
            subjects,
            rooms,
            timetable,
            conflicts
        ] = await Promise.all([

            pool.query(
                `SELECT COUNT(*)::int AS count
                 FROM teachers
                 WHERE is_active = TRUE`
            ),

            pool.query(
                `SELECT COUNT(*)::int AS count
                 FROM classes
                 WHERE is_active = TRUE`
            ),

            pool.query(
                `SELECT COUNT(*)::int AS count
                 FROM subjects
                 WHERE is_active = TRUE`
            ),

            pool.query(
                `SELECT COUNT(*)::int AS count
                 FROM rooms
                 WHERE is_active = TRUE`
            ),

            pool.query(
                `SELECT COUNT(*)::int AS count
                 FROM timetable`
            ),

            pool.query(
                `SELECT COUNT(*)::int AS count
                 FROM timetable`
            )
        ]);

        res.json({
            success: true,
            data: {
                teachers: teachers.rows[0].count,
                classes: classes.rows[0].count,
                subjects: subjects.rows[0].count,
                rooms: rooms.rows[0].count,
                timetableEntries: timetable.rows[0].count,
                conflicts: 0
            }
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Unable to load dashboard analytics"
        });
    }
}

async function teacherWorkload(req, res) {

    try {

        const result = await pool.query(
            `SELECT
                t.id,
                t.full_name AS name,
                COUNT(tt.id)::int AS periods

             FROM teachers t

             LEFT JOIN timetable tt
             ON tt.teacher_id = t.id

             WHERE t.is_active = TRUE

             GROUP BY
                t.id,
                t.full_name

             ORDER BY periods DESC`
        );

        res.json({
            success: true,
            data: result.rows
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: "Unable to calculate teacher workload"
        });
    }
}

async function roomUsage(req, res) {

    try {

        const result = await pool.query(
            `SELECT
                r.id,
                r.room_number AS room,
                COUNT(t.id)::int AS bookings

             FROM rooms r

             LEFT JOIN timetable t
             ON t.room_id = r.id

             GROUP BY
                r.id,
                r.room_number

             ORDER BY bookings DESC`
        );

        res.json({
            success: true,
            data: result.rows
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: "Unable to calculate room usage"
        });
    }
}

async function classesPerDay(req, res) {

    try {

        const result = await pool.query(
            `SELECT
                day_of_week AS day,
                COUNT(*)::int AS classes

             FROM timetable

             GROUP BY day_of_week

             ORDER BY
                CASE day_of_week
                    WHEN 'Monday' THEN 1
                    WHEN 'Tuesday' THEN 2
                    WHEN 'Wednesday' THEN 3
                    WHEN 'Thursday' THEN 4
                    WHEN 'Friday' THEN 5
                    WHEN 'Saturday' THEN 6
                END`
        );

        res.json({
            success: true,
            data: result.rows
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: "Unable to calculate classes per day"
        });
    }
}

module.exports = {
    dashboard,
    teacherWorkload,
    roomUsage,
    classesPerDay
};