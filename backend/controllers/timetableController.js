const pool = require("../db");

async function findConflicts(data, excludeId = null) {

    const {
        teacher_id,
        room_id,
        class_id,
        section_id,
        day_of_week,
        time_slot_id,
        room_capacity,
        student_count
    } = data;

    const conflicts = [];

    const exclude =
        excludeId
            ? `AND t.id <> $4`
            : "";

    const valuesBase = [
        teacher_id,
        room_id,
        class_id,
        section_id
    ];

    const teacherQuery = await pool.query(
        `SELECT
            t.id,
            s.code,
            s.name AS subject,
            r.room_number
         FROM timetable t
         JOIN subjects s ON s.id = t.subject_id
         JOIN rooms r ON r.id = t.room_id
         WHERE t.teacher_id = $1
         AND t.day_of_week = $2
         AND t.time_slot_id = $3
         ${exclude}`,
        excludeId
            ? [
                teacher_id,
                day_of_week,
                time_slot_id,
                excludeId
            ]
            : [
                teacher_id,
                day_of_week,
                time_slot_id
            ]
    );

    if (teacherQuery.rows.length) {
        conflicts.push({
            type: "TEACHER_CONFLICT",
            message: "Teacher is already scheduled at this time.",
            records: teacherQuery.rows
        });
    }

    const roomQuery = await pool.query(
        `SELECT
            t.id,
            c.name AS class_name,
            s.name AS subject
         FROM timetable t
         JOIN classes c ON c.id = t.class_id
         JOIN subjects s ON s.id = t.subject_id
         WHERE t.room_id = $1
         AND t.day_of_week = $2
         AND t.time_slot_id = $3
         ${exclude}`,
        excludeId
            ? [
                room_id,
                day_of_week,
                time_slot_id,
                excludeId
            ]
            : [
                room_id,
                day_of_week,
                time_slot_id
            ]
    );

    if (roomQuery.rows.length) {
        conflicts.push({
            type: "ROOM_CONFLICT",
            message: "Room is already occupied at this time.",
            records: roomQuery.rows
        });
    }

    const classQuery = await pool.query(
        `SELECT
            t.id,
            s.code,
            s.name AS subject
         FROM timetable t
         JOIN subjects s ON s.id = t.subject_id
         WHERE t.class_id = $1
         AND t.day_of_week = $2
         AND t.time_slot_id = $3
         ${exclude}`,
        excludeId
            ? [
                class_id,
                day_of_week,
                time_slot_id,
                excludeId
            ]
            : [
                class_id,
                day_of_week,
                time_slot_id
            ]
    );

    if (classQuery.rows.length) {
        conflicts.push({
            type: "CLASS_CONFLICT",
            message: "Class already has a subject at this time.",
            records: classQuery.rows
        });
    }

    const sectionQuery = await pool.query(
        `SELECT
            t.id,
            s.code,
            s.name AS subject
         FROM timetable t
         JOIN subjects s ON s.id = t.subject_id
         WHERE t.section_id = $1
         AND t.day_of_week = $2
         AND t.time_slot_id = $3
         ${exclude}`,
        excludeId
            ? [
                section_id,
                day_of_week,
                time_slot_id,
                excludeId
            ]
            : [
                section_id,
                day_of_week,
                time_slot_id
            ]
    );

    if (sectionQuery.rows.length) {
        conflicts.push({
            type: "SECTION_CONFLICT",
            message: "Section already has a class at this time.",
            records: sectionQuery.rows
        });
    }

    if (
        room_capacity !== undefined &&
        student_count !== undefined &&
        Number(room_capacity) < Number(student_count)
    ) {
        conflicts.push({
            type: "ROOM_CAPACITY",
            message: "Room capacity is smaller than class strength."
        });
    }

    const teacherAvailability = await pool.query(
        `SELECT available
         FROM teacher_availability
         WHERE teacher_id = $1
         AND day_of_week = $2
         AND time_slot_id = $3`,
        [
            teacher_id,
            day_of_week,
            time_slot_id
        ]
    );

    if (
        teacherAvailability.rows.length &&
        !teacherAvailability.rows[0].available
    ) {
        conflicts.push({
            type: "TEACHER_UNAVAILABLE",
            message: "Teacher is unavailable at this time."
        });
    }

    const roomAvailability = await pool.query(
        `SELECT available
         FROM room_availability
         WHERE room_id = $1
         AND day_of_week = $2
         AND time_slot_id = $3`,
        [
            room_id,
            day_of_week,
            time_slot_id
        ]
    );

    if (
        roomAvailability.rows.length &&
        !roomAvailability.rows[0].available
    ) {
        conflicts.push({
            type: "ROOM_UNAVAILABLE",
            message: "Room is unavailable at this time."
        });
    }

    return conflicts;
}

async function getTimetable(req, res) {

    try {

        const {
            day,
            teacher_id,
            room_id,
            class_id,
            section_id,
            page = 1,
            limit = 100
        } = req.query;

        const conditions = [];

        const values = [];

        if (day) {
            values.push(day);
            conditions.push(
                `t.day_of_week = $${values.length}`
            );
        }

        if (teacher_id) {
            values.push(teacher_id);
            conditions.push(
                `t.teacher_id = $${values.length}`
            );
        }

        if (room_id) {
            values.push(room_id);
            conditions.push(
                `t.room_id = $${values.length}`
            );
        }

        if (class_id) {
            values.push(class_id);
            conditions.push(
                `t.class_id = $${values.length}`
            );
        }

        if (section_id) {
            values.push(section_id);
            conditions.push(
                `t.section_id = $${values.length}`
            );
        }

        const where =
            conditions.length
                ? `WHERE ${conditions.join(" AND ")}`
                : "";

        values.push(Number(limit));
        const limitIndex = values.length;

        values.push(
            (Number(page) - 1) * Number(limit)
        );

        const offsetIndex = values.length;

        const result = await pool.query(
            `SELECT
                t.id,

                t.class_id AS "classId",
                c.name AS "className",

                t.section_id AS "sectionId",
                sec.name AS section,

                t.subject_id AS "subjectId",
                s.code AS "subjectCode",
                s.name AS "subjectName",

                t.teacher_id AS "teacherId",
                tr.full_name AS "teacherName",

                t.room_id AS "roomId",
                r.room_number AS "roomNumber",

                t.time_slot_id AS "slotId",
                ts.label AS "slotLabel",

                t.day_of_week AS day,

                t.status,
                t.notes

             FROM timetable t

             JOIN classes c
             ON c.id = t.class_id

             JOIN sections sec
             ON sec.id = t.section_id

             JOIN subjects s
             ON s.id = t.subject_id

             JOIN teachers tr
             ON tr.id = t.teacher_id

             JOIN rooms r
             ON r.id = t.room_id

             JOIN time_slots ts
             ON ts.id = t.time_slot_id

             ${where}

             ORDER BY
                CASE t.day_of_week
                    WHEN 'Monday' THEN 1
                    WHEN 'Tuesday' THEN 2
                    WHEN 'Wednesday' THEN 3
                    WHEN 'Thursday' THEN 4
                    WHEN 'Friday' THEN 5
                    WHEN 'Saturday' THEN 6
                END,
                ts.start_time

             LIMIT $${limitIndex}
             OFFSET $${offsetIndex}`,
            values
        );

        res.json({
            success: true,
            data: result.rows
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Unable to fetch timetable"
        });
    }
}

async function createTimetable(req, res) {

    try {

        const data = req.body;

        const conflicts = await findConflicts(data);

        if (conflicts.length) {
            return res.status(409).json({
                success: false,
                message: "Timetable conflict detected",
                conflicts
            });
        }

        const result = await pool.query(
            `INSERT INTO timetable
            (
                academic_year_id,
                class_id,
                section_id,
                subject_id,
                teacher_id,
                room_id,
                time_slot_id,
                day_of_week,
                timetable_date,
                notes,
                created_by
            )
            VALUES
            ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            RETURNING *`,
            [
                data.academic_year_id,
                data.class_id,
                data.section_id,
                data.subject_id,
                data.teacher_id,
                data.room_id,
                data.time_slot_id,
                data.day_of_week,
                data.timetable_date || null,
                data.notes || null,
                req.user?.id || null
            ]
        );

        res.status(201).json({
            success: true,
            message: "Timetable entry created",
            data: result.rows[0]
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Unable to create timetable entry"
        });
    }
}

async function updateTimetable(req, res) {

    try {

        const id = req.params.id;

        const existing = await pool.query(
            `SELECT *
             FROM timetable
             WHERE id = $1`,
            [id]
        );

        if (!existing.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Timetable entry not found"
            });
        }

        const old = existing.rows[0];

        const data = {
            ...old,
            ...req.body
        };

        const conflicts = await findConflicts(
            data,
            id
        );

        if (conflicts.length) {
            return res.status(409).json({
                success: false,
                message: "Timetable conflict detected",
                conflicts
            });
        }

        const result = await pool.query(
            `UPDATE timetable
             SET
                academic_year_id = $1,
                class_id = $2,
                section_id = $3,
                subject_id = $4,
                teacher_id = $5,
                room_id = $6,
                time_slot_id = $7,
                day_of_week = $8,
                timetable_date = $9,
                notes = $10,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $11
             RETURNING *`,
            [
                data.academic_year_id,
                data.class_id,
                data.section_id,
                data.subject_id,
                data.teacher_id,
                data.room_id,
                data.time_slot_id,
                data.day_of_week,
                data.timetable_date || null,
                data.notes || null,
                id
            ]
        );

        res.json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Unable to update timetable"
        });
    }
}

async function deleteTimetable(req, res) {

    try {

        const result = await pool.query(
            `DELETE FROM timetable
             WHERE id = $1
             RETURNING id`,
            [req.params.id]
        );

        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Timetable entry not found"
            });
        }

        res.json({
            success: true,
            message: "Timetable entry deleted"
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Unable to delete timetable entry"
        });
    }
}

module.exports = {
    getTimetable,
    createTimetable,
    updateTimetable,
    deleteTimetable,
    findConflicts
};
