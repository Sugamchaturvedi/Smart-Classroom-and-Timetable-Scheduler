const pool = require("../db");
const {
    findConflicts
} = require("./timetableController");

const DAYS = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday"
];

async function generateTimetable(req, res) {

    try {

        const {
            academic_year_id,
            class_id,
            days = DAYS,
            max_periods_per_day = 7,
            save = false
        } = req.body;

        if (!academic_year_id) {
            return res.status(400).json({
                success: false,
                message: "academic_year_id is required"
            });
        }

        const classQuery = class_id
            ? `
                SELECT *
                FROM classes
                WHERE id = $1
                AND is_active = TRUE
              `
            : `
                SELECT *
                FROM classes
                WHERE is_active = TRUE
                ORDER BY id
              `;

        const classResult = await pool.query(
            classQuery,
            class_id ? [class_id] : []
        );

        const slotsResult = await pool.query(
            `SELECT *
             FROM time_slots
             WHERE is_active = TRUE
             ORDER BY start_time`
        );

        const roomsResult = await pool.query(
            `SELECT
                r.id,
                r.room_number,
                r.capacity,
                r.room_type
             FROM rooms r
             WHERE r.is_active = TRUE
             ORDER BY r.capacity`
        );

        const generated = [];
        const unresolved = [];

        for (const cls of classResult.rows) {

            const sectionsResult = await pool.query(
                `SELECT *
                 FROM sections
                 WHERE class_id = $1
                 AND is_active = TRUE
                 ORDER BY id`,
                [cls.id]
            );

            for (const section of sectionsResult.rows) {

                const subjectsResult = await pool.query(
                    `SELECT
                        cs.class_id,
                        cs.subject_id,
                        cs.teacher_id,
                        cs.weekly_periods,
                        s.name AS subject_name
                     FROM class_subjects cs
                     JOIN subjects s
                     ON s.id = cs.subject_id
                     WHERE cs.class_id = $1`,
                    [cls.id]
                );

                for (const subject of subjectsResult.rows) {

                    let periodsPlaced = 0;

                    for (
                        let period = 0;
                        period < subject.weekly_periods;
                        period++
                    ) {

                        let placed = false;

                        for (const day of days) {

                            if (placed) break;

                            for (
                                const slot
                                of slotsResult.rows.slice(
                                    0,
                                    max_periods_per_day
                                )
                            ) {

                                if (placed) break;

                                for (
                                    const room
                                    of roomsResult.rows
                                ) {

                                    if (
                                        room.capacity <
                                        cls.student_count
                                    ) {
                                        continue;
                                    }

                                    const conflicts =
                                        await findConflicts({
                                            class_id: cls.id,
                                            section_id: section.id,
                                            subject_id: subject.subject_id,
                                            teacher_id: subject.teacher_id,
                                            room_id: room.id,
                                            time_slot_id: slot.id,
                                            day_of_week: day,
                                            room_capacity:
                                                room.capacity,
                                            student_count:
                                                section.student_count
                                        });

                                    if (
                                        conflicts.length === 0
                                    ) {

                                        generated.push({
                                            class_id: cls.id,
                                            section_id: section.id,
                                            subject_id:
                                                subject.subject_id,
                                            teacher_id:
                                                subject.teacher_id,
                                            room_id: room.id,
                                            time_slot_id:
                                                slot.id,
                                            day_of_week: day,
                                            subject_name:
                                                subject.subject_name,
                                            room_number:
                                                room.room_number,
                                            slot_label:
                                                slot.label
                                        });

                                        placed = true;
                                        periodsPlaced++;

                                        break;
                                    }
                                }
                            }
                        }

                        if (!placed) {

                            unresolved.push({
                                class_id: cls.id,
                                section_id: section.id,
                                subject_id:
                                    subject.subject_id,
                                subject_name:
                                    subject.subject_name,
                                reason:
                                    "No conflict-free slot available"
                            });
                        }
                    }
                }
            }
        }

        let saved = 0;

        if (save && generated.length) {

            for (const entry of generated) {

                await pool.query(
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
                        created_by
                    )
                    VALUES
                    ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                    [
                        academic_year_id,
                        entry.class_id,
                        entry.section_id,
                        entry.subject_id,
                        entry.teacher_id,
                        entry.room_id,
                        entry.time_slot_id,
                        entry.day_of_week,
                        req.user?.id || null
                    ]
                );

                saved++;
            }
        }

        res.json({
            success: true,
            message: save
                ? "Timetable generated and saved"
                : "Timetable generated as preview",

            statistics: {
                generated: generated.length,
                unresolved: unresolved.length,
                saved
            },

            timetable: generated,
            conflicts: unresolved
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Timetable generation failed",
            error: error.message
        });
    }
}

module.exports = {
    generateTimetable
};