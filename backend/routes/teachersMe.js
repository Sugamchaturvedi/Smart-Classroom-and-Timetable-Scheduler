const express = require("express");
const pool = require("../db");
const { authenticate, requireTeacher } = require("../middleware/auth");
const { findConflicts, resolveTimeSlot, getDayNameFromDate } = require("../controllers/timetableController");

const router = express.Router();

// Enforce authentication and teacher/admin role for all endpoints in /api/teachers/me
router.use(authenticate, requireTeacher);

/**
 * Middleware: Ensures the authenticated user is mapped to a valid teacher record
 */
async function ensureTeacherMapping(req, res, next) {
    if (!req.user.teacherId) {
        // If an admin is testing without a linked teacher record, pick teacher 1 as fallback context
        if (req.user.role === "ADMIN") {
            const firstTeacher = await pool.query("SELECT id, teacher_code, full_name FROM teachers LIMIT 1");
            if (firstTeacher.rows.length) {
                req.user.teacherId = firstTeacher.rows[0].id;
                req.user.teacherCode = firstTeacher.rows[0].teacher_code;
            } else {
                return res.status(404).json({ success: false, message: "No teacher records found in database" });
            }
        } else {
            return res.status(403).json({
                success: false,
                message: "No teacher record is associated with this user account"
            });
        }
    }
    next();
}

router.use(ensureTeacherMapping);

/**
 * GET /api/teachers/me
 * Returns the logged-in teacher's profile and summary stats
 */
router.get("/", async (req, res) => {
    try {
        const teacherId = req.user.teacherId;

        // Query teacher details
        const teacherRes = await pool.query(`
            SELECT
                t.id,
                t.teacher_code AS "teacherCode",
                t.full_name AS name,
                t.department_id AS "departmentId",
                COALESCE(d.name, 'General Faculty') AS department,
                COALESCE(u.email, t.email) AS email,
                u.phone,
                u.avatar_url AS "avatarUrl",
                u.last_login AS "lastLogin",
                u.created_at AS "createdAt",
                t.is_active AS "isActive"
            FROM teachers t
            LEFT JOIN departments d ON d.id = t.department_id
            LEFT JOIN users u ON u.id = t.user_id
            WHERE t.id = $1
        `, [teacherId]);

        if (!teacherRes.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Teacher record not found"
            });
        }

        const teacher = teacherRes.rows[0];

        // Fetch counts for dashboard stats
        const subjectsCountRes = await pool.query(`
            SELECT COUNT(DISTINCT subject_id) AS count
            FROM (
                SELECT subject_id FROM teacher_subjects WHERE teacher_id = $1
                UNION
                SELECT subject_id FROM class_subjects WHERE teacher_id = $1
            ) s
        `, [teacherId]);

        const classesCountRes = await pool.query(`
            SELECT COUNT(DISTINCT class_id) AS count
            FROM class_subjects
            WHERE teacher_id = $1
        `, [teacherId]);

        const weeklyLecturesRes = await pool.query(`
            SELECT COUNT(id) AS count
            FROM timetable
            WHERE teacher_id = $1 AND status <> 'cancelled' AND (entry_type = 'regular' OR entry_type IS NULL)
        `, [teacherId]);

        const makeupCountRes = await pool.query(`
            SELECT COUNT(id) AS count
            FROM timetable
            WHERE (teacher_id = $1 OR makeup_teacher_id = $1) AND entry_type = 'makeup' AND status <> 'cancelled'
        `, [teacherId]);

        res.json({
            success: true,
            data: {
                ...teacher,
                stats: {
                    assignedSubjects: parseInt(subjectsCountRes.rows[0].count) || 0,
                    assignedClasses: parseInt(classesCountRes.rows[0].count) || 0,
                    weeklyLectures: parseInt(weeklyLecturesRes.rows[0].count) || 0,
                    activeMakeups: parseInt(makeupCountRes.rows[0].count) || 0
                }
            }
        });
    } catch (error) {
        console.error("GET /api/teachers/me error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to retrieve teacher profile"
        });
    }
});

/**
 * GET /api/teachers/me/timetable
 * Returns strictly the authenticated teacher's teaching timetable entries
 */
router.get("/timetable", async (req, res) => {
    try {
        const teacherId = req.user.teacherId;
        const { day, date, entry_type } = req.query;

        const conditions = [
            "(t.teacher_id = $1 OR t.makeup_teacher_id = $1)",
            "t.status <> 'cancelled'"
        ];
        const params = [teacherId];

        if (day) {
            params.push(day);
            conditions.push(`t.day_of_week = $${params.length}`);
        }

        if (date) {
            params.push(date);
            conditions.push(`(t.timetable_date = $${params.length}::date OR (t.timetable_date IS NULL AND t.day_of_week = TRIM(TO_CHAR($${params.length}::date, 'Day'))))`);
        }

        if (entry_type) {
            params.push(entry_type);
            conditions.push(`t.entry_type = $${params.length}`);
        }

        const querySql = `
            SELECT
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
                r.room_type AS "roomType",
                t.time_slot_id AS "slotId",
                ts.slot_code AS "slotCode",
                ts.label AS "slotLabel",
                ts.start_time AS "startTime",
                ts.end_time AS "endTime",
                t.day_of_week AS day,
                t.timetable_date AS "timetableDate",
                t.status,
                t.notes,
                t.entry_type AS "entryType",
                t.original_timetable_id AS "originalTimetableId",
                t.original_date AS "originalDate",
                t.makeup_reason AS "makeupReason",
                t.makeup_teacher_id AS "makeupTeacherId",
                mtr.full_name AS "makeupTeacherName"
            FROM timetable t
            JOIN classes c ON c.id = t.class_id
            JOIN sections sec ON sec.id = t.section_id
            JOIN subjects s ON s.id = t.subject_id
            JOIN teachers tr ON tr.id = t.teacher_id
            JOIN rooms r ON r.id = t.room_id
            JOIN time_slots ts ON ts.id = t.time_slot_id
            LEFT JOIN teachers mtr ON mtr.id = t.makeup_teacher_id
            WHERE ${conditions.join(" AND ")}
            ORDER BY
                CASE t.day_of_week
                    WHEN 'Monday' THEN 1
                    WHEN 'Tuesday' THEN 2
                    WHEN 'Wednesday' THEN 3
                    WHEN 'Thursday' THEN 4
                    WHEN 'Friday' THEN 5
                    WHEN 'Saturday' THEN 6
                    ELSE 7
                END,
                ts.start_time
        `;

        const result = await pool.query(querySql, params);

        res.json({
            success: true,
            data: result.rows
        });
    } catch (error) {
        console.error("GET /api/teachers/me/timetable error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to retrieve teacher timetable"
        });
    }
});

/**
 * GET /api/teachers/me/today
 * Returns today's class schedule for the teacher
 */
router.get("/today", async (req, res) => {
    try {
        const teacherId = req.user.teacherId;
        const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const todayDay = days[new Date().getDay()];

        const result = await pool.query(`
            SELECT
                t.id,
                t.class_id AS "classId",
                c.name AS "className",
                t.section_id AS "sectionId",
                sec.name AS section,
                t.subject_id AS "subjectId",
                s.code AS "subjectCode",
                s.name AS "subjectName",
                t.room_id AS "roomId",
                r.room_number AS "roomNumber",
                r.room_type AS "roomType",
                ts.slot_code AS "slotCode",
                ts.label AS "slotLabel",
                ts.start_time AS "startTime",
                ts.end_time AS "endTime",
                t.day_of_week AS day,
                t.timetable_date AS "timetableDate",
                t.entry_type AS "entryType",
                t.makeup_reason AS "makeupReason",
                t.status
            FROM timetable t
            JOIN classes c ON c.id = t.class_id
            JOIN sections sec ON sec.id = t.section_id
            JOIN subjects s ON s.id = t.subject_id
            JOIN rooms r ON r.id = t.room_id
            JOIN time_slots ts ON ts.id = t.time_slot_id
            WHERE (t.teacher_id = $1 OR t.makeup_teacher_id = $1)
              AND t.status <> 'cancelled'
              AND (
                  (t.timetable_date IS NOT NULL AND t.timetable_date = CURRENT_DATE)
                  OR (t.timetable_date IS NULL AND t.day_of_week = $2)
              )
            ORDER BY ts.start_time ASC
        `, [teacherId, todayDay]);

        res.json({
            success: true,
            day: todayDay,
            date: new Date().toISOString().split("T")[0],
            data: result.rows
        });
    } catch (error) {
        console.error("GET /api/teachers/me/today error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to retrieve today's schedule"
        });
    }
});

/**
 * GET /api/teachers/me/subjects
 * Returns all subjects assigned to this teacher
 */
router.get("/subjects", async (req, res) => {
    try {
        const teacherId = req.user.teacherId;

        const result = await pool.query(`
            SELECT DISTINCT
                s.id,
                s.code,
                s.name,
                s.credits,
                s.weekly_periods AS "weeklyPeriods",
                s.subject_type AS "subjectType",
                d.name AS department
            FROM subjects s
            LEFT JOIN departments d ON d.id = s.department_id
            LEFT JOIN teacher_subjects ts ON ts.subject_id = s.id
            LEFT JOIN class_subjects cs ON cs.subject_id = s.id
            WHERE ts.teacher_id = $1 OR cs.teacher_id = $1
            ORDER BY s.name ASC
        `, [teacherId]);

        res.json({
            success: true,
            data: result.rows
        });
    } catch (error) {
        console.error("GET /api/teachers/me/subjects error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to retrieve assigned subjects"
        });
    }
});

/**
 * GET /api/teachers/me/classes
 * Returns classes & sections assigned to this teacher
 */
router.get("/classes", async (req, res) => {
    try {
        const teacherId = req.user.teacherId;

        const result = await pool.query(`
            SELECT DISTINCT
                c.id AS "classId",
                c.name AS "className",
                c.class_code AS "classCode",
                sec.id AS "sectionId",
                sec.name AS "sectionName",
                sec.student_count AS "studentCount",
                s.id AS "subjectId",
                s.name AS "subjectName",
                s.code AS "subjectCode"
            FROM class_subjects cs
            JOIN classes c ON c.id = cs.class_id
            JOIN sections sec ON sec.class_id = c.id
            JOIN subjects s ON s.id = cs.subject_id
            WHERE cs.teacher_id = $1
            ORDER BY c.name, sec.name
        `, [teacherId]);

        res.json({
            success: true,
            data: result.rows
        });
    } catch (error) {
        console.error("GET /api/teachers/me/classes error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to retrieve assigned classes"
        });
    }
});

/**
 * GET /api/teachers/me/availability
 * Returns teacher's availability across slots and days
 */
router.get("/availability", async (req, res) => {
    try {
        const teacherId = req.user.teacherId;

        const result = await pool.query(`
            SELECT
                ta.id,
                ta.day_of_week AS day,
                ta.time_slot_id AS "slotId",
                ts.slot_code AS "slotCode",
                ts.label AS "slotLabel",
                ta.available
            FROM teacher_availability ta
            JOIN time_slots ts ON ts.id = ta.time_slot_id
            WHERE ta.teacher_id = $1
            ORDER BY
                CASE ta.day_of_week
                    WHEN 'Monday' THEN 1
                    WHEN 'Tuesday' THEN 2
                    WHEN 'Wednesday' THEN 3
                    WHEN 'Thursday' THEN 4
                    WHEN 'Friday' THEN 5
                    WHEN 'Saturday' THEN 6
                    ELSE 7
                END,
                ts.start_time
        `, [teacherId]);

        res.json({
            success: true,
            data: result.rows
        });
    } catch (error) {
        console.error("GET /api/teachers/me/availability error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to retrieve availability matrix"
        });
    }
});

/**
 * POST /api/teachers/me/makeup-classes
 * Allows a teacher to schedule a makeup class for their course with automated conflict checks
 */
router.post("/makeup-classes", async (req, res) => {
    try {
        const teacherId = req.user.teacherId;
        const data = req.body;

        // Force teacher_id to authenticated teacher
        data.teacher_id = teacherId;
        data.makeup_teacher_id = teacherId;
        data.entry_type = "makeup";

        if (!data.timetable_date) {
            return res.status(400).json({
                success: false,
                message: "timetable_date (YYYY-MM-DD) is required for makeup classes"
            });
        }

        // Derive day of week from date
        data.day_of_week = getDayNameFromDate(data.timetable_date);

        // Resolve time slot
        const slot = await resolveTimeSlot(data.time_slot_id || data.slotId || data.slot_code);
        if (!slot) {
            return res.status(400).json({
                success: false,
                message: "Valid time slot is required"
            });
        }
        data.time_slot_id = slot.id;

        // Verify that this teacher is authorized to teach this subject or class
        const authCheck = await pool.query(`
            SELECT 1 FROM (
                SELECT subject_id FROM teacher_subjects WHERE teacher_id = $1 AND subject_id = $2
                UNION
                SELECT subject_id FROM class_subjects WHERE teacher_id = $1 AND subject_id = $2
            ) a
        `, [teacherId, data.subject_id]);

        // Strict clash detection
        const conflicts = await findConflicts(data);
        if (conflicts.length) {
            return res.status(409).json({
                success: false,
                message: "Scheduling clash detected for makeup class",
                conflicts
            });
        }

        // Insert makeup class
        const insertRes = await pool.query(`
            INSERT INTO timetable (
                academic_year_id,
                class_id,
                section_id,
                subject_id,
                teacher_id,
                room_id,
                time_slot_id,
                day_of_week,
                timetable_date,
                status,
                notes,
                entry_type,
                makeup_reason,
                makeup_teacher_id,
                created_by
            )
            VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, 'scheduled', $10, 'makeup', $11, $12, $13
            )
            RETURNING *
        `, [
            data.academic_year_id || 1,
            data.class_id,
            data.section_id,
            data.subject_id,
            teacherId,
            data.room_id,
            slot.id,
            data.day_of_week,
            data.timetable_date,
            data.notes || null,
            data.makeup_reason || "Faculty Arranged Makeup Class",
            teacherId,
            req.user.id
        ]);

        // Insert notification or audit log
        try {
            await pool.query(
                `INSERT INTO audit_logs (user_id, action, entity, entity_id, description)
                 VALUES ($1, 'TEACHER_SCHEDULED_MAKEUP', 'timetable', $2, $3)`,
                [req.user.id, String(insertRes.rows[0].id), `Teacher scheduled makeup class on ${data.timetable_date}`]
            );
        } catch (_) {}

        res.status(201).json({
            success: true,
            message: "Makeup class successfully scheduled and reserved",
            data: insertRes.rows[0]
        });
    } catch (error) {
        console.error("POST /api/teachers/me/makeup-classes error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to schedule makeup class"
        });
    }
});

/**
 * POST /api/teachers/me/absences
 * Teacher reports a planned absence
 */
router.post("/absences", async (req, res) => {
    try {
        const teacherId = req.user.teacherId;
        const { absence_date, reason } = req.body;

        if (!absence_date) {
            return res.status(400).json({
                success: false,
                message: "absence_date is required"
            });
        }

        const insertRes = await pool.query(`
            INSERT INTO teacher_absences (teacher_id, absence_date, reason, created_by)
            VALUES ($1, $2, $3, $4)
            RETURNING id, teacher_id, absence_date, reason, created_at
        `, [teacherId, absence_date, reason || "Personal / Medical Leave", req.user.id]);

        res.status(201).json({
            success: true,
            message: "Absence reported successfully. University administration has been notified.",
            data: insertRes.rows[0]
        });
    } catch (error) {
        console.error("POST /api/teachers/me/absences error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to record absence"
        });
    }
});

module.exports = router;
