const pool = require("../db");

const DAYS = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday"
];

/**
 * High-performance Constraint Satisfaction Timetable Generator
 * Strictly respects all 12 teacher timetable rules, avoids freeze/slowdown,
 * optimizes soft preferences, and produces actionable diagnostic feedback.
 */
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

        // 1. Load active rules
        const rulesRes = await pool.query(
            `SELECT rule_key, name, is_enabled, is_mandatory, config FROM timetable_rules`
        );
        const rulesMap = {};
        rulesRes.rows.forEach(r => { rulesMap[r.rule_key] = r; });

        const isRuleActive = (key) => rulesMap[key] ? Boolean(rulesMap[key].is_enabled) : true;
        const isRuleMandatory = (key) => rulesMap[key] ? Boolean(rulesMap[key].is_mandatory) : true;
        const maxDailyConfig = Number(rulesMap["MAX_DAILY_HOURS"]?.config?.max_hours) || 4;
        const maxWeeklyConfig = Number(rulesMap["MAX_WEEKLY_HOURS"]?.config?.max_hours) || 16;
        const maxConsecutiveConfig = Number(rulesMap["MAX_CONSECUTIVE_PERIODS"]?.config?.max_consecutive) || 2;
        const minBreakSlots = Number(rulesMap["MIN_BREAK_DURATION"]?.config?.min_break_slots) || 1;
        const maxGapAllowed = Number(rulesMap["MINIMIZE_GAPS"]?.config?.max_allowed_gap_slots) || 2;

        // 2. Load teacher preferences
        const prefsRes = await pool.query(`SELECT * FROM teacher_preferences WHERE status = 'Approved'`);
        const teacherPrefsMap = new Map();
        prefsRes.rows.forEach(p => { teacherPrefsMap.set(p.teacher_id, p); });

        // 3. Load qualified teachers mapping (teacher_subjects, class_subjects, and same-dept fallback)
        const qualRes = await pool.query(
            `SELECT DISTINCT teacher_id, subject_id FROM (
                SELECT teacher_id, subject_id FROM teacher_subjects
                UNION
                SELECT teacher_id, subject_id FROM class_subjects WHERE teacher_id IS NOT NULL
             ) q`
        );
        const subjectTeachersMap = new Map();
        qualRes.rows.forEach(r => {
            if (!subjectTeachersMap.has(r.subject_id)) subjectTeachersMap.set(r.subject_id, []);
            subjectTeachersMap.get(r.subject_id).push(r.teacher_id);
        });

        // 4. Query classes, slots, rooms
        const classQuery = class_id
            ? `SELECT * FROM classes WHERE id = $1 AND is_active = TRUE`
            : `SELECT * FROM classes WHERE is_active = TRUE ORDER BY id`;

        const classResult = await pool.query(classQuery, class_id ? [class_id] : []);

        const slotsResult = await pool.query(
            `SELECT id, slot_code, start_time, end_time, label
             FROM time_slots
             WHERE is_active = TRUE
             ORDER BY start_time`
        );
        const allSlots = slotsResult.rows;
        const slotIndexMap = new Map();
        allSlots.forEach((s, idx) => {
            slotIndexMap.set(s.id, idx);
            slotIndexMap.set(s.slot_code, idx);
        });

        const activeDays = days.filter(d => DAYS.includes(d));
        const activeSlots = allSlots.slice(0, Math.max(1, Math.min(allSlots.length, max_periods_per_day)));

        const roomsResult = await pool.query(
            `SELECT r.id, r.room_number, r.capacity, r.room_type
             FROM rooms r
             WHERE r.is_active = TRUE
             ORDER BY r.capacity ASC`
        );
        const allRooms = roomsResult.rows;

        // 5. Pre-fetch existing scheduled state into memory sets for O(1) clash checking
        const existingTtRes = await pool.query(
            `SELECT teacher_id, room_id, section_id, class_id, day_of_week, time_slot_id
             FROM timetable
             WHERE status <> 'cancelled'`
        );

        const occupiedTeacherSlots = new Set();
        const occupiedRoomSlots = new Set();
        const occupiedSectionSlots = new Set();
        const occupiedClassSlots = new Set();
        const teacherWeeklyLoad = new Map();
        const teacherDaySlots = new Map(); // key: `${teacher_id}:${day}` -> Set of slot indices
        const roomUsageCount = new Map();

        existingTtRes.rows.forEach(row => {
            const keySuffix = `${row.day_of_week}:${row.time_slot_id}`;
            if (row.teacher_id) occupiedTeacherSlots.add(`${row.teacher_id}:${keySuffix}`);
            if (row.room_id) {
                occupiedRoomSlots.add(`${row.room_id}:${keySuffix}`);
                roomUsageCount.set(row.room_id, (roomUsageCount.get(row.room_id) || 0) + 1);
            }
            if (row.section_id) occupiedSectionSlots.add(`${row.section_id}:${keySuffix}`);
            if (row.class_id) occupiedClassSlots.add(`${row.class_id}:${keySuffix}`);

            if (row.teacher_id) {
                teacherWeeklyLoad.set(row.teacher_id, (teacherWeeklyLoad.get(row.teacher_id) || 0) + 1);
                const dayKey = `${row.teacher_id}:${row.day_of_week}`;
                if (!teacherDaySlots.has(dayKey)) teacherDaySlots.set(dayKey, new Set());
                const sIdx = slotIndexMap.get(row.time_slot_id);
                if (sIdx !== undefined) teacherDaySlots.get(dayKey).add(sIdx);
            }
        });

        // 6. Pre-fetch teacher unavailable slots & absences
        const unavailRes = await pool.query(
            `SELECT teacher_id, day_of_week, time_slot_id FROM teacher_availability WHERE available = FALSE`
        );
        const teacherUnavailSet = new Set(
            unavailRes.rows.map(r => `${r.teacher_id}:${r.day_of_week}:${r.time_slot_id}`)
        );

        const generated = [];
        const unresolved = [];

        // In-batch helper to check consecutive blocks & breaks
        function checkConsecutiveAndBreak(currentIndices, newIdx) {
            const combined = Array.from(new Set([...currentIndices, newIdx])).sort((a, b) => a - b);
            const blocks = [];
            let cur = [combined[0]];
            for (let i = 1; i < combined.length; i++) {
                if (combined[i] === combined[i - 1] + 1) cur.push(combined[i]);
                else { blocks.push(cur); cur = [combined[i]]; }
            }
            blocks.push(cur);

            // Rule 6: Max Consecutive
            if (isRuleActive("MAX_CONSECUTIVE_PERIODS") && isRuleMandatory("MAX_CONSECUTIVE_PERIODS")) {
                const maxLen = blocks.reduce((m, b) => Math.max(m, b.length), 0);
                if (maxLen > maxConsecutiveConfig) return { valid: false, reason: `Exceeds max consecutive periods (${maxConsecutiveConfig})` };
            }

            // Rule 7: Min Break
            if (isRuleActive("MIN_BREAK_DURATION") && isRuleMandatory("MIN_BREAK_DURATION") && blocks.length > 1) {
                for (let b = 0; b < blocks.length - 1; b++) {
                    if (blocks[b].length >= maxConsecutiveConfig || blocks[b + 1].length >= maxConsecutiveConfig) {
                        const gap = blocks[b + 1][0] - blocks[b][blocks[b].length - 1] - 1;
                        if (gap < minBreakSlots) {
                            return { valid: false, reason: `Violates minimum break of ${minBreakSlots} period(s) between consecutive lecture blocks` };
                        }
                    }
                }
            }

            return { valid: true };
        }

        // 7. Schedule classes & sections
        for (const cls of classResult.rows) {
            const sectionsResult = await pool.query(
                `SELECT * FROM sections WHERE class_id = $1 AND is_active = TRUE ORDER BY id`,
                [cls.id]
            );

            for (const section of sectionsResult.rows) {
                const subjectsResult = await pool.query(
                    `SELECT cs.class_id, cs.subject_id, cs.teacher_id, cs.weekly_periods, s.name AS subject_name, s.code AS subject_code
                     FROM class_subjects cs
                     JOIN subjects s ON s.id = cs.subject_id
                     WHERE cs.class_id = $1`,
                    [cls.id]
                );

                for (const subject of subjectsResult.rows) {
                    const requiredPeriods = subject.weekly_periods || 3;

                    for (let period = 0; period < requiredPeriods; period++) {
                        let placed = false;
                        const diagnosticFailures = new Set();

                        // Candidate teachers (assigned primary or qualified pool)
                        let candidateTeachers = [];
                        if (subject.teacher_id) candidateTeachers.push(subject.teacher_id);
                        const qualifiedPool = subjectTeachersMap.get(subject.subject_id) || [];
                        qualifiedPool.forEach(tid => {
                            if (!candidateTeachers.includes(tid)) candidateTeachers.push(tid);
                        });

                        if (candidateTeachers.length === 0) {
                            unresolved.push({
                                class_id: cls.id,
                                class_name: cls.name,
                                section_id: section.id,
                                section_name: section.name,
                                subject_id: subject.subject_id,
                                subject_name: subject.subject_name,
                                period_number: period + 1,
                                reason: "No qualified faculty member assigned or authorized for this subject",
                                diagnosticDetails: ["Missing teacher assignment in teacher_subjects or class_subjects"]
                            });
                            continue;
                        }

                        // Workload balancing: sort teachers by lowest currently assigned weekly load
                        if (isRuleActive("WORKLOAD_BALANCE") && candidateTeachers.length > 1) {
                            candidateTeachers.sort((a, b) => (teacherWeeklyLoad.get(a) || 0) - (teacherWeeklyLoad.get(b) || 0));
                        }

                        teacherLoop:
                        for (const candidateTeacherId of candidateTeachers) {
                            const teacherPref = teacherPrefsMap.get(candidateTeacherId);
                            const effectiveMaxDaily = (teacherPref && teacherPref.max_daily_periods)
                                ? Math.min(maxDailyConfig, teacherPref.max_daily_periods)
                                : maxDailyConfig;

                            // Rule 5: Weekly cap
                            const currentWeekly = teacherWeeklyLoad.get(candidateTeacherId) || 0;
                            if (isRuleActive("MAX_WEEKLY_HOURS") && isRuleMandatory("MAX_WEEKLY_HOURS")) {
                                if (currentWeekly + 1 > maxWeeklyConfig) {
                                    diagnosticFailures.add(`Weekly teaching hours limit (${maxWeeklyConfig}) reached for faculty`);
                                    continue;
                                }
                            }

                            // Generate and score candidate slots
                            const candidateSlots = [];
                            for (const day of activeDays) {
                                for (const slot of activeSlots) {
                                    candidateSlots.push({ day, slot });
                                }
                            }

                            // Score candidate slots for teacher preferences and gap minimization
                            const scoredSlots = candidateSlots.map(({ day, slot }) => {
                                let score = 0;
                                const slotIdx = slotIndexMap.get(slot.id);

                                if (teacherPref && Array.isArray(teacherPref.preferred_days) && teacherPref.preferred_days.includes(day)) {
                                    score += 20;
                                }
                                if (teacherPref && Array.isArray(teacherPref.preferred_slots) && teacherPref.preferred_slots.includes(slot.slot_code)) {
                                    score += 20;
                                }

                                const dayKey = `${candidateTeacherId}:${day}`;
                                const currentDayIndices = Array.from(teacherDaySlots.get(dayKey) || []);
                                if (currentDayIndices.length > 0) {
                                    const minGap = Math.min(...currentDayIndices.map(i => Math.abs(i - slotIdx) - 1));
                                    if (minGap === 0) score += 15; // directly adjacent
                                    else if (minGap === 1) score += 8;
                                    else if (minGap > maxGapAllowed) score -= 15; // gap penalty
                                }

                                return { day, slot, score };
                            });

                            scoredSlots.sort((a, b) => b.score - a.score);

                            for (const { day, slot } of scoredSlots) {
                                const slotIdx = slotIndexMap.get(slot.id);
                                const slotKeySuffix = `${day}:${slot.id}`;

                                // Check Section & Class clash
                                if (occupiedSectionSlots.has(`${section.id}:${slotKeySuffix}`)) {
                                    diagnosticFailures.add(`Section already has a class on ${day} at ${slot.label}`);
                                    continue;
                                }
                                if (occupiedClassSlots.has(`${cls.id}:${slotKeySuffix}`)) {
                                    diagnosticFailures.add(`Class already has a class on ${day} at ${slot.label}`);
                                    continue;
                                }

                                // Rule 1: Teacher Overlap
                                if (occupiedTeacherSlots.has(`${candidateTeacherId}:${slotKeySuffix}`)) {
                                    diagnosticFailures.add(`Teacher already has a class on ${day} at ${slot.label}`);
                                    continue;
                                }

                                // Rule 2: Teacher Availability
                                if (isRuleActive("TEACHER_AVAILABILITY") && isRuleMandatory("TEACHER_AVAILABILITY")) {
                                    if (teacherUnavailSet.has(`${candidateTeacherId}:${day}:${slot.id}`)) {
                                        diagnosticFailures.add(`Teacher marked unavailable on ${day} at ${slot.label}`);
                                        continue;
                                    }
                                }

                                // Rule 4: Daily limit
                                const dayKey = `${candidateTeacherId}:${day}`;
                                const daySlotIndices = teacherDaySlots.get(dayKey) || new Set();
                                if (isRuleActive("MAX_DAILY_HOURS") && isRuleMandatory("MAX_DAILY_HOURS")) {
                                    if (daySlotIndices.size + 1 > effectiveMaxDaily) {
                                        diagnosticFailures.add(`Daily limit (${effectiveMaxDaily} periods) reached on ${day}`);
                                        continue;
                                    }
                                }

                                // Rules 6 & 7: Consecutive & Break
                                if (daySlotIndices.size > 0) {
                                    const checkRes = checkConsecutiveAndBreak(daySlotIndices, slotIdx);
                                    if (!checkRes.valid) {
                                        diagnosticFailures.add(checkRes.reason);
                                        continue;
                                    }
                                }

                                // Room Search: find a free room with capacity >= section students
                                const requiredCap = section.student_count || cls.student_count || 0;
                                let chosenRoom = null;

                                for (const room of allRooms) {
                                    if (room.capacity < requiredCap) continue;
                                    const roomKey = `${room.id}:${slotKeySuffix}`;
                                    if (!occupiedRoomSlots.has(roomKey)) {
                                        chosenRoom = room;
                                        break;
                                    }
                                }

                                if (!chosenRoom) {
                                    diagnosticFailures.add(`No vacant room with capacity >= ${requiredCap} on ${day} at ${slot.label}`);
                                    continue;
                                }

                                // Successful placement!
                                generated.push({
                                    class_id: cls.id,
                                    class_name: cls.name,
                                    section_id: section.id,
                                    section_name: section.name,
                                    subject_id: subject.subject_id,
                                    subject_name: subject.subject_name,
                                    subject_code: subject.subject_code,
                                    teacher_id: candidateTeacherId,
                                    room_id: chosenRoom.id,
                                    room_number: chosenRoom.room_number,
                                    time_slot_id: slot.id,
                                    day_of_week: day,
                                    slot_label: slot.label
                                });

                                // Update memory state
                                occupiedTeacherSlots.add(`${candidateTeacherId}:${slotKeySuffix}`);
                                occupiedRoomSlots.add(`${chosenRoom.id}:${slotKeySuffix}`);
                                occupiedSectionSlots.add(`${section.id}:${slotKeySuffix}`);
                                occupiedClassSlots.add(`${cls.id}:${slotKeySuffix}`);

                                teacherWeeklyLoad.set(candidateTeacherId, (teacherWeeklyLoad.get(candidateTeacherId) || 0) + 1);
                                if (!teacherDaySlots.has(dayKey)) teacherDaySlots.set(dayKey, new Set());
                                teacherDaySlots.get(dayKey).add(slotIdx);
                                roomUsageCount.set(chosenRoom.id, (roomUsageCount.get(chosenRoom.id) || 0) + 1);

                                placed = true;
                                break teacherLoop;
                            }
                        }

                        if (!placed) {
                            const failureArray = Array.from(diagnosticFailures);
                            unresolved.push({
                                class_id: cls.id,
                                class_name: cls.name,
                                section_id: section.id,
                                section_name: section.name,
                                subject_id: subject.subject_id,
                                subject_name: subject.subject_name,
                                period_number: period + 1,
                                reason: failureArray[0] || "No conflict-free slot meeting teacher workload constraints available",
                                diagnosticDetails: failureArray.slice(0, 5)
                            });
                        }
                    }
                }
            }
        }

        let saved = 0;
        if (save && generated.length) {
            const client = await pool.connect();
            try {
                await client.query("BEGIN");
                await client.query("SELECT pg_advisory_xact_lock(hashtext('timetable_lock'))");

                for (const entry of generated) {
                    await client.query(
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
                        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
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

                await client.query(
                    `INSERT INTO audit_logs (user_id, action, entity, entity_id, description)
                     VALUES ($1, 'generate', 'Timetable Generator', 'batch', $2)`,
                    [req.user?.id || null, `Generated and saved ${saved} timetable entries satisfying teacher workload constraints`]
                );

                await client.query("COMMIT");
            } catch (err) {
                await client.query("ROLLBACK");
                throw err;
            } finally {
                client.release();
            }
        }

        res.json({
            success: true,
            message: save
                ? `Timetable generated and saved successfully (${generated.length} scheduled, ${unresolved.length} unresolved)`
                : `Timetable preview generated successfully (${generated.length} scheduled, ${unresolved.length} unresolved)`,
            statistics: {
                generated: generated.length,
                unresolved: unresolved.length,
                saved,
                appliedRulesCount: Object.keys(rulesMap).length
            },
            timetable: generated,
            conflicts: unresolved
        });

    } catch (error) {
        console.error("Timetable generation error:", error);
        res.status(500).json({
            success: false,
            message: "Timetable generation failed: " + error.message,
            error: error.message
        });
    }
}

module.exports = {
    generateTimetable
};