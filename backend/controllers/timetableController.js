const pool = require("../db");

/**
 * Helper to resolve slot ID and metadata from id or slot_code
 */
async function resolveTimeSlot(slotInput) {
    if (!slotInput) return null;
    const str = String(slotInput).trim();
    const result = await pool.query(
        `SELECT id, slot_code, start_time, end_time, label
         FROM time_slots
         WHERE (id::text = $1 OR slot_code = $1)
           AND is_active = TRUE
         LIMIT 1`,
        [str]
    );
    return result.rows.length ? result.rows[0] : null;
}

/**
 * Helper to derive day name from date string (YYYY-MM-DD)
 */
function getDayNameFromDate(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr + "T00:00:00");
    if (isNaN(d.getTime())) return null;
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return days[d.getDay()];
}

/**
 * findConflicts: Checks for room, teacher, class, section clashes and capacity issues
 */
/**
 * findConflicts: Comprehensive verification of room, teacher, section, class clashes,
 * capacity, availability, absences, qualifications, daily/weekly hours, consecutive limits,
 * breaks, quotas, preferred slots, and schedule gaps according to active timetable_rules.
 */
async function findConflicts(data, excludeId = null, client = null, activeRulesOverride = null) {
    const db = client || pool;
    const {
        teacher_id,
        room_id,
        class_id,
        section_id,
        subject_id,
        day_of_week,
        time_slot_id,
        timetable_date,
        room_capacity,
        student_count,
        entry_type
    } = data;

    const conflicts = [];
    const warnings = [];
    conflicts.warnings = warnings;

    // 0. Load active rules
    let rulesMap = activeRulesOverride;
    if (!rulesMap) {
        try {
            const rulesRes = await db.query(
                `SELECT rule_key, is_enabled, is_mandatory, config FROM timetable_rules`
            );
            rulesMap = {};
            rulesRes.rows.forEach(r => { rulesMap[r.rule_key] = r; });
        } catch (_) {
            rulesMap = {};
        }
    }

    const isRuleActive = (key) => rulesMap[key] ? Boolean(rulesMap[key].is_enabled) : true;
    const isRuleMandatory = (key) => rulesMap[key] ? Boolean(rulesMap[key].is_mandatory) : true;
    const getRuleConfig = (key) => rulesMap[key]?.config || {};

    function addFeedback(ruleKey, conflictObj) {
        const mandatory = isRuleMandatory(ruleKey);
        const enriched = {
            ...conflictObj,
            rule_key: ruleKey,
            is_mandatory: mandatory,
            severity: mandatory ? "error" : "warning"
        };
        if (mandatory) {
            conflicts.push(enriched);
        } else {
            warnings.push(enriched);
        }
    }

    // Resolve time slot if needed
    let resolvedSlotId = time_slot_id;
    let slotObj = null;
    if (time_slot_id) {
        slotObj = await resolveTimeSlot(time_slot_id);
        if (slotObj) resolvedSlotId = slotObj.id;
    }

    // Resolve day of week if only date provided
    let effectiveDay = day_of_week;
    if (!effectiveDay && timetable_date) {
        effectiveDay = getDayNameFromDate(timetable_date);
    }

    const dateVal = timetable_date ? timetable_date : null;

    // Fetch teacher preferences if teacher_id is provided
    let teacherPref = null;
    if (teacher_id) {
        try {
            const prefRes = await db.query(
                `SELECT * FROM teacher_preferences WHERE teacher_id = $1`,
                [teacher_id]
            );
            if (prefRes.rows.length) teacherPref = prefRes.rows[0];
        } catch (_) {}
    }

    // Build common filter for time slot and date/day overlap
    const baseWhere = `
        t.time_slot_id = $1
        AND t.status <> 'cancelled'
        AND (
            ($2::date IS NOT NULL AND t.timetable_date = $2::date)
            OR ($2::date IS NULL AND t.timetable_date IS NULL AND t.day_of_week = $3)
            OR ($2::date IS NOT NULL AND t.timetable_date IS NULL AND t.day_of_week = $3)
            OR ($2::date IS NULL AND t.timetable_date IS NOT NULL AND t.day_of_week = $3)
        )
        ${excludeId ? `AND t.id <> $4` : ""}
    `;

    const baseParams = excludeId
        ? [resolvedSlotId, dateVal, effectiveDay, excludeId]
        : [resolvedSlotId, dateVal, effectiveDay];

    // 1. Rule 1: Prevent Overlapping Classes (NO_OVERLAP)
    if (teacher_id && resolvedSlotId && (effectiveDay || dateVal)) {
        const teacherQuery = await db.query(
            `SELECT
                t.id,
                t.entry_type,
                t.timetable_date,
                s.code,
                s.name AS subject,
                r.room_number,
                c.name AS class_name,
                sec.name AS section_name,
                tr.full_name AS teacher_name
             FROM timetable t
             JOIN subjects s ON s.id = t.subject_id
             JOIN rooms r ON r.id = t.room_id
             JOIN classes c ON c.id = t.class_id
             JOIN sections sec ON sec.id = t.section_id
             JOIN teachers tr ON tr.id = t.teacher_id
             WHERE t.teacher_id = $${baseParams.length + 1}
               AND ${baseWhere}`,
            [...baseParams, teacher_id]
        );

        if (teacherQuery.rows.length) {
            const r = teacherQuery.rows[0];
            if (isRuleActive("NO_OVERLAP")) {
                addFeedback("NO_OVERLAP", {
                    type: "TEACHER_CONFLICT",
                    message: `Teacher ${r.teacher_name || ''} already has a class during this period with ${r.class_name} (${r.section_name}) in ${r.room_number} for ${r.subject}.`,
                    records: teacherQuery.rows
                });
            }
        }
    }

    // 2. Room Conflict (Physical barrier)
    if (room_id && resolvedSlotId && (effectiveDay || dateVal)) {
        const roomQuery = await db.query(
            `SELECT
                t.id,
                t.entry_type,
                t.timetable_date,
                c.name AS class_name,
                sec.name AS section_name,
                s.name AS subject,
                tr.full_name AS teacher_name
             FROM timetable t
             JOIN classes c ON c.id = t.class_id
             JOIN sections sec ON sec.id = t.section_id
             JOIN subjects s ON s.id = t.subject_id
             JOIN teachers tr ON tr.id = t.teacher_id
             WHERE t.room_id = $${baseParams.length + 1}
               AND ${baseWhere}`,
            [...baseParams, room_id]
        );

        if (roomQuery.rows.length) {
            const r = roomQuery.rows[0];
            conflicts.push({
                type: "ROOM_CONFLICT",
                rule_key: "ROOM_OCCUPIED",
                is_mandatory: true,
                severity: "error",
                message: `Room is already occupied by ${r.class_name} (${r.section_name}) with ${r.teacher_name} for ${r.subject}.`,
                records: roomQuery.rows
            });
        }
    }

    // 3. Class / Section Conflict
    if (section_id && resolvedSlotId && (effectiveDay || dateVal)) {
        const sectionQuery = await db.query(
            `SELECT
                t.id,
                t.entry_type,
                t.timetable_date,
                s.code,
                s.name AS subject,
                r.room_number,
                tr.full_name AS teacher_name
             FROM timetable t
             JOIN subjects s ON s.id = t.subject_id
             JOIN rooms r ON r.id = t.room_id
             JOIN teachers tr ON tr.id = t.teacher_id
             WHERE t.section_id = $${baseParams.length + 1}
               AND ${baseWhere}`,
            [...baseParams, section_id]
        );

        if (sectionQuery.rows.length) {
            const r = sectionQuery.rows[0];
            conflicts.push({
                type: "SECTION_CONFLICT",
                rule_key: "SECTION_CLASH",
                is_mandatory: true,
                severity: "error",
                message: `Section is already scheduled for ${r.subject} with ${r.teacher_name} in ${r.room_number}.`,
                records: sectionQuery.rows
            });
        }
    } else if (class_id && resolvedSlotId && (effectiveDay || dateVal)) {
        const classQuery = await db.query(
            `SELECT
                t.id,
                t.entry_type,
                t.timetable_date,
                s.code,
                s.name AS subject,
                sec.name AS section_name
             FROM timetable t
             JOIN subjects s ON s.id = t.subject_id
             JOIN sections sec ON sec.id = t.section_id
             WHERE t.class_id = $${baseParams.length + 1}
               AND ${baseWhere}`,
            [...baseParams, class_id]
        );

        if (classQuery.rows.length) {
            conflicts.push({
                type: "CLASS_CONFLICT",
                rule_key: "CLASS_CLASH",
                is_mandatory: true,
                severity: "error",
                message: `Class already has an entry at this time.`,
                records: classQuery.rows
            });
        }
    }

    // 4. Room Capacity Check
    if (room_capacity !== undefined && student_count !== undefined) {
        if (Number(room_capacity) < Number(student_count)) {
            conflicts.push({
                type: "ROOM_CAPACITY",
                rule_key: "ROOM_CAPACITY",
                is_mandatory: true,
                severity: "error",
                message: `Room capacity (${room_capacity}) is smaller than class strength (${student_count}).`
            });
        }
    } else if (room_id && section_id) {
        const capQuery = await db.query(
            `SELECT r.capacity, sec.student_count
             FROM rooms r, sections sec
             WHERE r.id = $1 AND sec.id = $2`,
            [room_id, section_id]
        );
        if (capQuery.rows.length) {
            const { capacity, student_count: sCount } = capQuery.rows[0];
            if (capacity && sCount && Number(capacity) < Number(sCount)) {
                conflicts.push({
                    type: "ROOM_CAPACITY",
                    rule_key: "ROOM_CAPACITY",
                    is_mandatory: true,
                    severity: "error",
                    message: `Room capacity (${capacity}) is smaller than section strength (${sCount}).`
                });
            }
        }
    }

    // 5. Room Availability Check (room_availability table)
    if (room_id && resolvedSlotId && effectiveDay) {
        const roomAvailability = await db.query(
            `SELECT available
             FROM room_availability
             WHERE room_id = $1
               AND day_of_week = $2
               AND time_slot_id = $3`,
            [room_id, effectiveDay, resolvedSlotId]
        );

        if (roomAvailability.rows.length && !roomAvailability.rows[0].available) {
            conflicts.push({
                type: "ROOM_UNAVAILABLE",
                rule_key: "ROOM_UNAVAILABLE",
                is_mandatory: true,
                severity: "error",
                message: `Room is marked unavailable on ${effectiveDay} at this time slot.`
            });
        }
    }

    // 6. Rule 2: Respect Teacher Availability & Recorded Absences (TEACHER_AVAILABILITY)
    if (isRuleActive("TEACHER_AVAILABILITY") && teacher_id) {
        // 6a. Check teacher_availability table
        if (resolvedSlotId && effectiveDay) {
            const teacherAvailability = await db.query(
                `SELECT available
                 FROM teacher_availability
                 WHERE teacher_id = $1
                   AND day_of_week = $2
                   AND time_slot_id = $3`,
                [teacher_id, effectiveDay, resolvedSlotId]
            );

            if (teacherAvailability.rows.length && !teacherAvailability.rows[0].available) {
                addFeedback("TEACHER_AVAILABILITY", {
                    type: "TEACHER_UNAVAILABLE",
                    message: `Teacher is marked unavailable on ${effectiveDay} at this time slot.`
                });
            }
        }

        // 6b. Check teacher_absences table
        if (dateVal) {
            const absenceRes = await db.query(
                `SELECT absence_date, reason
                 FROM teacher_absences
                 WHERE teacher_id = $1 AND absence_date = $2::date`,
                [teacher_id, dateVal]
            );
            if (absenceRes.rows.length) {
                const reasonText = absenceRes.rows[0].reason ? `: "${absenceRes.rows[0].reason}"` : "";
                addFeedback("TEACHER_AVAILABILITY", {
                    type: "TEACHER_ABSENT",
                    message: `Teacher is unavailable during the selected time due to approved leave / recorded absence on ${dateVal}${reasonText}.`
                });
            }
        }
    }

    // 7. Rule 3: Assign Teachers Only to Qualified or Authorized Subjects (SUBJECT_QUALIFICATION)
    if (isRuleActive("SUBJECT_QUALIFICATION") && teacher_id && subject_id) {
        const qualConfig = getRuleConfig("SUBJECT_QUALIFICATION");
        const qualRes = await db.query(
            `SELECT
                (SELECT 1 FROM teacher_subjects WHERE teacher_id = $1 AND subject_id = $2 LIMIT 1) AS in_teacher_subjects,
                (SELECT 1 FROM class_subjects WHERE teacher_id = $1 AND subject_id = $2 ${class_id ? `AND class_id = $3` : ""} LIMIT 1) AS in_class_subjects,
                (SELECT 1 FROM teachers t JOIN subjects s ON s.id = $2 WHERE t.id = $1 AND t.department_id IS NOT NULL AND t.department_id = s.department_id LIMIT 1) AS same_dept,
                (SELECT name FROM subjects WHERE id = $2 LIMIT 1) AS subject_name,
                (SELECT full_name FROM teachers WHERE id = $1 LIMIT 1) AS teacher_name`,
            class_id ? [teacher_id, subject_id, class_id] : [teacher_id, subject_id]
        );

        const qRow = qualRes.rows[0] || {};
        let isQualified = Boolean(qRow.in_teacher_subjects || qRow.in_class_subjects);
        if (!isQualified && qualConfig.allow_department_fallback && qRow.same_dept) {
            isQualified = true;
        }

        if (!isQualified) {
            addFeedback("SUBJECT_QUALIFICATION", {
                type: "SUBJECT_NOT_QUALIFIED",
                message: `Teacher is not assigned or qualified to teach this subject (${qRow.subject_name || 'Subject #' + subject_id}).`,
                teacherId: teacher_id,
                subjectId: subject_id
            });
        }
    }

    // 8. Rule 4: Maximum Daily Teaching Hours (MAX_DAILY_HOURS)
    if (isRuleActive("MAX_DAILY_HOURS") && teacher_id && effectiveDay) {
        const maxDailyConfig = Number(getRuleConfig("MAX_DAILY_HOURS").max_hours) || 4;
        let effectiveMaxDaily = maxDailyConfig;
        if (teacherPref && teacherPref.max_daily_periods && teacherPref.max_daily_periods < effectiveMaxDaily) {
            effectiveMaxDaily = teacherPref.max_daily_periods;
        }

        const dailyCountRes = await db.query(
            `SELECT COUNT(*) AS count
             FROM timetable t
             WHERE t.teacher_id = $1
               AND t.status <> 'cancelled'
               AND (
                   ($2::date IS NOT NULL AND t.timetable_date = $2::date)
                   OR ($2::date IS NULL AND t.timetable_date IS NULL AND t.day_of_week = $3)
                   OR ($2::date IS NOT NULL AND t.timetable_date IS NULL AND t.day_of_week = $3)
                   OR ($2::date IS NULL AND t.timetable_date IS NOT NULL AND t.day_of_week = $3)
               )
               ${excludeId ? `AND t.id <> $4` : ""}`,
            excludeId ? [teacher_id, dateVal, effectiveDay, excludeId] : [teacher_id, dateVal, effectiveDay]
        );

        const scheduledDaily = Number(dailyCountRes.rows[0]?.count || 0);
        if (scheduledDaily + 1 > effectiveMaxDaily) {
            addFeedback("MAX_DAILY_HOURS", {
                type: "DAILY_HOURS_EXCEEDED",
                message: `Daily teaching-hour limit exceeded (${scheduledDaily + 1}/${effectiveMaxDaily} periods on ${effectiveDay}).`,
                currentCount: scheduledDaily + 1,
                limit: effectiveMaxDaily
            });
        }
    }

    // 9. Rule 5: Maximum Weekly Teaching Hours (MAX_WEEKLY_HOURS)
    if (isRuleActive("MAX_WEEKLY_HOURS") && teacher_id) {
        const maxWeeklyConfig = Number(getRuleConfig("MAX_WEEKLY_HOURS").max_hours) || 16;
        const weeklyCountRes = await db.query(
            `SELECT COUNT(*) AS count
             FROM timetable t
             WHERE t.teacher_id = $1
               AND t.status <> 'cancelled'
               ${excludeId ? `AND t.id <> $2` : ""}`,
            excludeId ? [teacher_id, excludeId] : [teacher_id]
        );

        const scheduledWeekly = Number(weeklyCountRes.rows[0]?.count || 0);
        if (scheduledWeekly + 1 > maxWeeklyConfig) {
            addFeedback("MAX_WEEKLY_HOURS", {
                type: "WEEKLY_HOURS_EXCEEDED",
                message: `Weekly teaching-hour limit exceeded (${scheduledWeekly + 1}/${maxWeeklyConfig} periods this week).`,
                currentCount: scheduledWeekly + 1,
                limit: maxWeeklyConfig
            });
        }
    }

    // 10. Rules 6 & 7: Maximum Consecutive Periods & Minimum Break Duration
    if ((isRuleActive("MAX_CONSECUTIVE_PERIODS") || isRuleActive("MIN_BREAK_DURATION") || isRuleActive("MINIMIZE_GAPS")) &&
        teacher_id && effectiveDay && resolvedSlotId) {

        const allSlotsQuery = await db.query(
            `SELECT id, slot_code, start_time, end_time, label
             FROM time_slots
             WHERE is_active = TRUE
             ORDER BY start_time`
        );

        const slotIndexMap = new Map();
        allSlotsQuery.rows.forEach((s, idx) => {
            slotIndexMap.set(s.id, idx);
            slotIndexMap.set(s.slot_code, idx);
        });

        const daySlotsRes = await db.query(
            `SELECT t.time_slot_id
             FROM timetable t
             WHERE t.teacher_id = $1
               AND t.status <> 'cancelled'
               AND (
                   ($2::date IS NOT NULL AND t.timetable_date = $2::date)
                   OR ($2::date IS NULL AND t.timetable_date IS NULL AND t.day_of_week = $3)
                   OR ($2::date IS NOT NULL AND t.timetable_date IS NULL AND t.day_of_week = $3)
                   OR ($2::date IS NULL AND t.timetable_date IS NOT NULL AND t.day_of_week = $3)
               )
               ${excludeId ? `AND t.id <> $4` : ""}`,
            excludeId ? [teacher_id, dateVal, effectiveDay, excludeId] : [teacher_id, dateVal, effectiveDay]
        );

        const scheduledIndicesSet = new Set();
        daySlotsRes.rows.forEach(r => {
            const idx = slotIndexMap.get(r.time_slot_id);
            if (idx !== undefined) scheduledIndicesSet.add(idx);
        });

        const targetSlotIdx = slotIndexMap.get(resolvedSlotId);
        if (targetSlotIdx !== undefined) {
            scheduledIndicesSet.add(targetSlotIdx);
        }

        const sortedIndices = Array.from(scheduledIndicesSet).sort((a, b) => a - b);

        // Group into contiguous blocks
        const blocks = [];
        if (sortedIndices.length > 0) {
            let curBlock = [sortedIndices[0]];
            for (let i = 1; i < sortedIndices.length; i++) {
                if (sortedIndices[i] === sortedIndices[i - 1] + 1) {
                    curBlock.push(sortedIndices[i]);
                } else {
                    blocks.push(curBlock);
                    curBlock = [sortedIndices[i]];
                }
            }
            blocks.push(curBlock);
        }

        // 10a. Rule 6: Max Consecutive Periods
        const maxConsecutiveConfig = Number(getRuleConfig("MAX_CONSECUTIVE_PERIODS").max_consecutive) || 2;
        const maxBlockLen = blocks.reduce((max, b) => Math.max(max, b.length), 0);
        if (isRuleActive("MAX_CONSECUTIVE_PERIODS") && maxBlockLen > maxConsecutiveConfig) {
            addFeedback("MAX_CONSECUTIVE_PERIODS", {
                type: "CONSECUTIVE_LIMIT_EXCEEDED",
                message: `Maximum consecutive periods exceeded (${maxBlockLen} back-to-back periods; limit is ${maxConsecutiveConfig}).`,
                consecutiveCount: maxBlockLen,
                limit: maxConsecutiveConfig
            });
        }

        // 10b. Rule 7: Minimum Breaks Between Consecutive Lectures
        const minBreakSlots = Number(getRuleConfig("MIN_BREAK_DURATION").min_break_slots) || 1;
        if (isRuleActive("MIN_BREAK_DURATION") && blocks.length > 1) {
            for (let i = 0; i < blocks.length - 1; i++) {
                const b1 = blocks[i];
                const b2 = blocks[i + 1];
                if (b1.length >= maxConsecutiveConfig || b2.length >= maxConsecutiveConfig) {
                    const gap = b2[0] - b1[b1.length - 1] - 1;
                    if (gap < minBreakSlots) {
                        addFeedback("MIN_BREAK_DURATION", {
                            type: "BREAK_VIOLATION",
                            message: `Required break would be violated (requires minimum ${minBreakSlots} period rest between consecutive lecture blocks).`,
                            gapSlots: gap,
                            requiredBreak: minBreakSlots
                        });
                        break;
                    }
                }
            }
        }

        // 10c. Rule 10: Minimize Unnecessary Gaps
        if (isRuleActive("MINIMIZE_GAPS") && sortedIndices.length >= 2) {
            const maxGapAllowed = Number(getRuleConfig("MINIMIZE_GAPS").max_allowed_gap_slots) || 2;
            for (let i = 0; i < sortedIndices.length - 1; i++) {
                const gap = sortedIndices[i + 1] - sortedIndices[i] - 1;
                if (gap > maxGapAllowed) {
                    addFeedback("MINIMIZE_GAPS", {
                        type: "EXCESSIVE_SCHEDULE_GAP",
                        message: `Notice: Scheduling this slot results in an isolated non-teaching gap of ${gap} hours between lectures for this teacher.`
                    });
                    break;
                }
            }
        }
    }

    // 11. Rule 9: Preferred Teaching Days and Time Slots (TEACHER_PREFERRED_SLOTS)
    if (isRuleActive("TEACHER_PREFERRED_SLOTS") && teacherPref) {
        if (effectiveDay && Array.isArray(teacherPref.preferred_days) && teacherPref.preferred_days.length) {
            if (!teacherPref.preferred_days.includes(effectiveDay)) {
                addFeedback("TEACHER_PREFERRED_SLOTS", {
                    type: "OUTSIDE_PREFERRED_DAYS",
                    message: `Teacher preferred days do not include ${effectiveDay} (preferred: ${teacherPref.preferred_days.join(", ")}).`
                });
            }
        }
        if (slotObj && Array.isArray(teacherPref.preferred_slots) && teacherPref.preferred_slots.length) {
            if (!teacherPref.preferred_slots.includes(slotObj.slot_code) && !teacherPref.preferred_slots.includes(String(slotObj.id))) {
                addFeedback("TEACHER_PREFERRED_SLOTS", {
                    type: "OUTSIDE_PREFERRED_SLOTS",
                    message: `Time slot ${slotObj.label || slotObj.slot_code} is outside teacher declared preferred hours.`
                });
            }
        }
    }

    // 12. Rule 8: Ensure Required Weekly Lecture Counts for Subjects (SUBJECT_WEEKLY_QUOTA)
    if (isRuleActive("SUBJECT_WEEKLY_QUOTA") && class_id && subject_id && entry_type !== "makeup") {
        const quotaRes = await db.query(
            `SELECT cs.weekly_periods, s.weekly_periods AS s_weekly, s.code, s.name
             FROM subjects s
             LEFT JOIN class_subjects cs ON cs.subject_id = s.id AND cs.class_id = $1
             WHERE s.id = $2`,
            [class_id, subject_id]
        );
        if (quotaRes.rows.length) {
            const quota = quotaRes.rows[0].weekly_periods || quotaRes.rows[0].s_weekly || 3;
            const currentCountRes = await db.query(
                `SELECT COUNT(*) AS count
                 FROM timetable t
                 WHERE t.class_id = $1 AND t.subject_id = $2 AND t.status <> 'cancelled'
                   ${excludeId ? `AND t.id <> $3` : ""}`,
                excludeId ? [class_id, subject_id, excludeId] : [class_id, subject_id]
            );
            const scheduledCount = Number(currentCountRes.rows[0]?.count || 0);
            if (scheduledCount >= quota) {
                addFeedback("SUBJECT_WEEKLY_QUOTA", {
                    type: "QUOTA_EXCEEDED",
                    message: `Subject ${quotaRes.rows[0].code || ''} already fulfills prescribed weekly lecture count (${scheduledCount}/${quota} periods scheduled).`
                });
            }
        }
    }

    conflicts.isValid = (conflicts.length === 0);
    return conflicts;
}


/**
 * GET /api/timetable/slots
 * Returns all active time slots
 */
async function getTimeSlots(req, res) {
    try {
        const result = await pool.query(
            `SELECT id, slot_code AS "slotCode", start_time AS "startTime", end_time AS "endTime", label
             FROM time_slots
             WHERE is_active = TRUE
             ORDER BY start_time`
        );
        res.json({
            success: true,
            data: result.rows
        });
    } catch (error) {
        console.error("Get time slots error:", error);
        res.status(500).json({ success: false, message: "Unable to fetch time slots" });
    }
}

/**
 * GET /api/timetable/availability
 * Real-time availability checker for rooms, teachers, and class/sections at a given date/day & slot
 */
async function checkAvailability(req, res) {
    try {
        const {
            day_of_week,
            timetable_date,
            date,
            time_slot_id,
            slot_id,
            class_id,
            section_id,
            teacher_id,
            room_id,
            exclude_id
        } = req.query;

        const effectiveDate = timetable_date || date || null;
        let effectiveDay = day_of_week;
        if (!effectiveDay && effectiveDate) {
            effectiveDay = getDayNameFromDate(effectiveDate);
        }

        const slotParam = time_slot_id || slot_id;
        const slot = await resolveTimeSlot(slotParam);

        if (!slot) {
            return res.status(400).json({
                success: false,
                message: "Valid time slot is required"
            });
        }

        if (!effectiveDay && !effectiveDate) {
            return res.status(400).json({
                success: false,
                message: "Day of week or date is required"
            });
        }

        const exclude = exclude_id ? Number(exclude_id) : null;

        // Query all classes scheduled at this exact day/date & slot
        const scheduledQuery = await pool.query(
            `SELECT
                t.id,
                t.class_id AS "classId",
                c.name AS "className",
                t.section_id AS "sectionId",
                sec.name AS "sectionName",
                t.subject_id AS "subjectId",
                s.code AS "subjectCode",
                s.name AS "subjectName",
                t.teacher_id AS "teacherId",
                tr.full_name AS "teacherName",
                t.room_id AS "roomId",
                r.room_number AS "roomNumber",
                r.capacity AS "roomCapacity",
                r.room_type AS "roomType",
                t.day_of_week AS "day",
                t.timetable_date AS "timetableDate",
                t.entry_type AS "entryType",
                t.status,
                t.makeup_reason AS "makeupReason",
                ts.start_time AS "startTime",
                ts.end_time AS "endTime",
                ts.label AS "slotLabel"
             FROM timetable t
             JOIN classes c ON c.id = t.class_id
             JOIN sections sec ON sec.id = t.section_id
             JOIN subjects s ON s.id = t.subject_id
             JOIN teachers tr ON tr.id = t.teacher_id
             JOIN rooms r ON r.id = t.room_id
             JOIN time_slots ts ON ts.id = t.time_slot_id
             WHERE t.time_slot_id = $1
               AND t.status <> 'cancelled'
               AND (
                   ($2::date IS NOT NULL AND t.timetable_date = $2::date)
                   OR ($2::date IS NULL AND t.timetable_date IS NULL AND t.day_of_week = $3)
                   OR ($2::date IS NOT NULL AND t.timetable_date IS NULL AND t.day_of_week = $3)
                   OR ($2::date IS NULL AND t.timetable_date IS NOT NULL AND t.day_of_week = $3)
               )
               ${exclude ? "AND t.id <> $4" : ""}
             ORDER BY r.room_number`,
            exclude ? [slot.id, effectiveDate, effectiveDay, exclude] : [slot.id, effectiveDate, effectiveDay]
        );

        const scheduledClasses = scheduledQuery.rows;

        // Map occupied IDs
        const occupiedRoomMap = new Map();
        const occupiedTeacherMap = new Map();
        const occupiedSectionMap = new Map();

        scheduledClasses.forEach(item => {
            occupiedRoomMap.set(Number(item.roomId), item);
            occupiedTeacherMap.set(Number(item.teacherId), item);
            occupiedSectionMap.set(Number(item.sectionId), item);
        });

        // Query active rooms
        const roomsQuery = await pool.query(
            `SELECT r.id, r.room_number AS number, r.capacity, r.room_type AS type, b.name AS building
             FROM rooms r
             LEFT JOIN buildings b ON b.id = r.building_id
             WHERE r.is_active = TRUE
             ORDER BY r.room_number`
        );

        const roomAvailability = roomsQuery.rows.map(room => {
            const occupant = occupiedRoomMap.get(room.id);
            if (occupant) {
                return {
                    id: room.id,
                    number: room.number,
                    capacity: room.capacity,
                    type: room.type,
                    building: room.building,
                    isAvailable: false,
                    status: "Occupied",
                    occupiedBy: {
                        className: occupant.className,
                        sectionName: occupant.sectionName,
                        subjectName: occupant.subjectName,
                        subjectCode: occupant.subjectCode,
                        teacherName: occupant.teacherName,
                        entryType: occupant.entryType
                    }
                };
            }
            return {
                id: room.id,
                number: room.number,
                capacity: room.capacity,
                type: room.type,
                building: room.building,
                isAvailable: true,
                status: "Available",
                occupiedBy: null
            };
        });

        // Run targeted conflict check for the requested selection
        const conflictData = {
            teacher_id: teacher_id ? Number(teacher_id) : null,
            room_id: room_id ? Number(room_id) : null,
            class_id: class_id ? Number(class_id) : null,
            section_id: section_id ? Number(section_id) : null,
            subject_id: req.query.subject_id ? Number(req.query.subject_id) : null,
            day_of_week: effectiveDay,
            time_slot_id: slot.id,
            timetable_date: effectiveDate
        };

        const conflicts = await findConflicts(conflictData, exclude);

        // Detailed indicators for the selected resources
        const selectedResourceStatus = {
            room: room_id ? (occupiedRoomMap.has(Number(room_id)) ? "Occupied" : "Available") : null,
            teacher: teacher_id ? (occupiedTeacherMap.has(Number(teacher_id)) ? "Occupied" : "Available") : null,
            section: section_id ? (occupiedSectionMap.has(Number(section_id)) ? "Occupied" : "Available") : null
        };

        res.json({
            success: true,
            day: effectiveDay,
            date: effectiveDate,
            slot: {
                id: slot.id,
                slotCode: slot.slot_code,
                label: slot.label,
                startTime: slot.start_time,
                endTime: slot.end_time
            },
            isAvailable: conflicts.length === 0,
            conflicts,
            warnings: conflicts.warnings || [],
            selectedResourceStatus,
            scheduledClasses,
            summary: {
                totalRooms: roomsQuery.rows.length,
                availableRoomsCount: roomAvailability.filter(r => r.isAvailable).length,
                occupiedRoomsCount: roomAvailability.filter(r => !r.isAvailable).length,
                scheduledClassesCount: scheduledClasses.length
            },
            roomAvailability
        });
    } catch (error) {
        console.error("Check availability error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to check availability: " + error.message
        });
    }
}

/**
 * GET /api/timetable
 * Fetch scheduled timetable entries with comprehensive filtering
 */
async function getTimetable(req, res) {
    try {
        const {
            day,
            teacher_id,
            room_id,
            class_id,
            section_id,
            entry_type,
            date,
            status,
            page = 1,
            limit = 100
        } = req.query;

        const conditions = [];
        const values = [];

        if (day) {
            values.push(day);
            conditions.push(`t.day_of_week = $${values.length}`);
        }

        if (req.user && req.user.role === "TEACHER") {
            if (teacher_id && String(teacher_id) !== String(req.user.teacherId)) {
                return res.status(403).json({
                    success: false,
                    message: "Forbidden: You are only permitted to access your own teaching schedule"
                });
            }
            values.push(req.user.teacherId);
            conditions.push(`(t.teacher_id = $${values.length} OR t.makeup_teacher_id = $${values.length})`);
        } else if (teacher_id) {
            values.push(teacher_id);
            conditions.push(`t.teacher_id = $${values.length}`);
        }

        if (room_id) {
            values.push(room_id);
            conditions.push(`t.room_id = $${values.length}`);
        }

        if (class_id) {
            values.push(class_id);
            conditions.push(`t.class_id = $${values.length}`);
        }

        if (section_id) {
            values.push(section_id);
            conditions.push(`t.section_id = $${values.length}`);
        }

        if (entry_type) {
            values.push(entry_type);
            conditions.push(`t.entry_type = $${values.length}`);
        }

        if (date) {
            values.push(date);
            conditions.push(`t.timetable_date = $${values.length}`);
        }

        if (status) {
            values.push(status);
            conditions.push(`t.status = $${values.length}`);
        }

        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

        values.push(Number(limit));
        const limitIndex = values.length;

        values.push((Number(page) - 1) * Number(limit));
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
                ts.slot_code AS "slotCode",
                ts.label AS "slotLabel",

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

             ${where}

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

             LIMIT $${limitIndex}
             OFFSET $${offsetIndex}`,
            values
        );

        res.json({
            success: true,
            data: result.rows
        });
    } catch (error) {
        console.error("Get timetable error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to fetch timetable"
        });
    }
}

/**
 * POST /api/timetable
 * Create a regular timetable entry with server-side conflict detection
 */
async function createTimetable(req, res) {
    try {
        const data = req.body;

        if (req.user && req.user.role === "TEACHER") {
            if (data.teacher_id && String(data.teacher_id) !== String(req.user.teacherId)) {
                return res.status(403).json({
                    success: false,
                    message: "Forbidden: You cannot schedule classes for other teachers."
                });
            }
            data.teacher_id = req.user.teacherId;
        }

        // Resolve time slot
        const slot = await resolveTimeSlot(data.time_slot_id || data.slotId || data.slot_code);
        if (!slot) {
            return res.status(400).json({
                success: false,
                message: "Invalid time slot"
            });
        }
        data.time_slot_id = slot.id;

        if (!data.day_of_week && data.day) data.day_of_week = data.day;
        if (!data.day_of_week && data.timetable_date) {
            data.day_of_week = getDayNameFromDate(data.timetable_date);
        }

        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            await client.query("SELECT pg_advisory_xact_lock(hashtext('timetable_lock'))");

            const conflicts = await findConflicts(data, null, client);

            if (conflicts.length) {
                await client.query("ROLLBACK");
                return res.status(409).json({
                    success: false,
                    message: conflicts[0].message || "Timetable conflict detected",
                    conflicts,
                    warnings: conflicts.warnings || []
                });
            }

            const result = await client.query(
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
                    status,
                    notes,
                    entry_type,
                    created_by
                )
                VALUES
                ($1,$2,$3,$4,$5,$6,$7,$8,$9,'scheduled',$10,$11,$12)
                RETURNING *`,
                [
                    data.academic_year_id || 1,
                    data.class_id,
                    data.section_id,
                    data.subject_id,
                    data.teacher_id,
                    data.room_id,
                    slot.id,
                    data.day_of_week,
                    data.timetable_date || null,
                    data.notes || null,
                    data.entry_type || 'regular',
                    req.user?.id || null
                ]
            );

            // Audit log
            await client.query(
                `INSERT INTO audit_logs (user_id, action, entity, entity_id, description)
                 VALUES ($1, 'create', 'Timetable Entry', $2, $3)`,
                [
                    req.user?.id || null,
                    String(result.rows[0].id),
                    `Scheduled class on ${data.day_of_week} at ${slot.label}`
                ]
            );

            await client.query("COMMIT");

            res.status(201).json({
                success: true,
                message: "Timetable entry created",
                data: result.rows[0],
                warnings: conflicts.warnings || []
            });
        } catch (innerErr) {
            await client.query("ROLLBACK");
            throw innerErr;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error("Create timetable error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to create timetable entry: " + error.message
        });
    }
}

/**
 * PUT /api/timetable/:id
 * Update an existing timetable entry
 */
async function updateTimetable(req, res) {
    try {
        const id = req.params.id;

        if (!/^\d+$/.test(id)) {
            return res.status(404).json({
                success: false,
                message: "Timetable entry not found"
            });
        }

        const existing = await pool.query("SELECT * FROM timetable WHERE id = $1", [id]);
        if (!existing.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Timetable entry not found"
            });
        }

        const old = existing.rows[0];

        if (req.user && req.user.role === "TEACHER") {
            const isOwner = Number(old.teacher_id) === Number(req.user.teacherId) || Number(old.makeup_teacher_id) === Number(req.user.teacherId);
            if (!isOwner) {
                return res.status(403).json({
                    success: false,
                    message: "Forbidden: You are only permitted to modify your own schedule entries."
                });
            }
        }

        const data = { ...old, ...req.body };

        // Resolve time slot if changing
        if (data.time_slot_id || data.slotId || data.slot_code) {
            const slot = await resolveTimeSlot(data.time_slot_id || data.slotId || data.slot_code);
            if (slot) data.time_slot_id = slot.id;
        }

        if (!data.day_of_week && data.day) data.day_of_week = data.day;
        if (!data.day_of_week && data.timetable_date) {
            data.day_of_week = getDayNameFromDate(data.timetable_date);
        }

        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            await client.query("SELECT pg_advisory_xact_lock(hashtext('timetable_lock'))");

            const conflicts = await findConflicts(data, id, client);

            if (conflicts.length) {
                await client.query("ROLLBACK");
                return res.status(409).json({
                    success: false,
                    message: conflicts[0].message || "Timetable conflict detected",
                    conflicts,
                    warnings: conflicts.warnings || []
                });
            }

            const result = await client.query(
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

            // Audit log
            await client.query(
                `INSERT INTO audit_logs (user_id, action, entity, entity_id, description)
                 VALUES ($1, 'update', 'Timetable Entry', $2, $3)`,
                [
                    req.user?.id || null,
                    String(id),
                    `Updated timetable entry on ${data.day_of_week}`
                ]
            );

            await client.query("COMMIT");

            res.json({
                success: true,
                message: "Timetable entry updated",
                data: result.rows[0],
                warnings: conflicts.warnings || []
            });
        } catch (innerErr) {
            await client.query("ROLLBACK");
            throw innerErr;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error("Update timetable error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to update timetable: " + error.message
        });
    }
}

/**
 * DELETE /api/timetable/:id
/**
 * DELETE /api/timetable/clear or /api/timetable/all or /api/timetable
 * Bulk delete timetable entries (either for a specific class or entire timetable)
 */
async function clearTimetable(req, res) {
    try {
        const classId = req.query.class_id || req.body?.class_id || req.body?.classId;
        const all = req.query.all === "true" || req.body?.all === true || !classId;

        if (req.user && req.user.role === "TEACHER") {
            return res.status(403).json({
                success: false,
                message: "Forbidden: Clearing university regular timetables requires administrator authorization."
            });
        }

        let queryText;
        let queryParams = [];

        if (classId && !all) {
            queryText = `DELETE FROM timetable WHERE class_id = $1 RETURNING id`;
            queryParams = [classId];
        } else {
            queryText = `DELETE FROM timetable RETURNING id`;
        }

        const result = await pool.query(queryText, queryParams);
        const count = result.rows.length;

        // Audit log
        await pool.query(
            `INSERT INTO audit_logs (user_id, action, entity, entity_id, description)
             VALUES ($1, 'delete', 'Timetable Batch', $2, $3)`,
            [
                req.user?.id || null,
                classId ? String(classId) : 'all',
                classId
                    ? `Cleared ${count} timetable entries for class #${classId}`
                    : `Cleared entire timetable (${count} entries removed)`
            ]
        );

        res.json({
            success: true,
            message: classId
                ? `Cleared ${count} timetable entries for the selected class.`
                : `Cleared all timetable entries (${count} removed).`,
            count
        });
    } catch (error) {
        console.error("Clear timetable error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to clear timetable: " + error.message
        });
    }
}

/**
 * DELETE /api/timetable/:id
 * Delete a timetable entry
 */
async function deleteTimetable(req, res) {
    try {
        const rawId = req.params.id;

        // Check for clear/all keyword routing
        if (rawId === "clear" || rawId === "all") {
            return clearTimetable(req, res);
        }

        // If client generated ID (e.g. tt_12345), handle gracefully
        if (!/^\d+$/.test(rawId)) {
            return res.json({
                success: true,
                message: "Timetable entry deleted"
            });
        }

        if (req.user && req.user.role === "TEACHER") {
            const entryCheck = await pool.query(
                "SELECT teacher_id, makeup_teacher_id, entry_type FROM timetable WHERE id = $1",
                [rawId]
            );
            if (!entryCheck.rows.length) {
                return res.status(404).json({ success: false, message: "Timetable entry not found" });
            }
            const entry = entryCheck.rows[0];
            const isOwner = Number(entry.teacher_id) === Number(req.user.teacherId) || Number(entry.makeup_teacher_id) === Number(req.user.teacherId);
            if (!isOwner || entry.entry_type !== "makeup") {
                return res.status(403).json({
                    success: false,
                    message: "Forbidden: Teachers can only delete their own makeup classes. University regular schedule modifications require administrator authorization."
                });
            }
        }

        const result = await pool.query(
            `DELETE FROM timetable WHERE id = $1 RETURNING id`,
            [rawId]
        );

        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Timetable entry not found"
            });
        }

        // Audit log
        await pool.query(
            `INSERT INTO audit_logs (user_id, action, entity, entity_id, description)
             VALUES ($1, 'delete', 'Timetable Entry', $2, $3)`,
            [
                req.user?.id || null,
                String(rawId),
                `Deleted timetable entry #${rawId}`
            ]
        );

        res.json({
            success: true,
            message: "Timetable entry deleted"
        });
    } catch (error) {
        console.error("Delete timetable error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to delete timetable entry"
        });
    }
}

/**
 * GET /api/timetable/makeup
 * Retrieve makeup classes with rich details
 */
async function getMakeupClasses(req, res) {
    try {
        const {
            date,
            from_date,
            to_date,
            teacher_id,
            class_id,
            section_id,
            status,
            page = 1,
            limit = 50
        } = req.query;

        const conditions = ["t.entry_type = 'makeup'"];
        const values = [];

        if (date) {
            values.push(date);
            conditions.push(`t.timetable_date = $${values.length}`);
        }

        if (from_date) {
            values.push(from_date);
            conditions.push(`t.timetable_date >= $${values.length}`);
        }

        if (to_date) {
            values.push(to_date);
            conditions.push(`t.timetable_date <= $${values.length}`);
        }

        if (teacher_id) {
            values.push(teacher_id);
            conditions.push(`(t.teacher_id = $${values.length} OR t.makeup_teacher_id = $${values.length})`);
        }

        if (class_id) {
            values.push(class_id);
            conditions.push(`t.class_id = $${values.length}`);
        }

        if (section_id) {
            values.push(section_id);
            conditions.push(`t.section_id = $${values.length}`);
        }

        if (status) {
            values.push(status);
            conditions.push(`t.status = $${values.length}`);
        }

        const where = `WHERE ${conditions.join(" AND ")}`;

        values.push(Number(limit));
        const limitIndex = values.length;
        values.push((Number(page) - 1) * Number(limit));
        const offsetIndex = values.length;

        const result = await pool.query(
            `SELECT
                t.id,
                t.class_id AS "classId",
                c.name AS "className",
                p.name AS "programName",
                p.code AS "programCode",

                t.section_id AS "sectionId",
                sec.name AS "sectionName",

                t.subject_id AS "subjectId",
                s.code AS "subjectCode",
                s.name AS "subjectName",

                t.teacher_id AS "teacherId",
                tr.full_name AS "teacherName",

                t.makeup_teacher_id AS "makeupTeacherId",
                mtr.full_name AS "makeupTeacherName",

                t.room_id AS "roomId",
                r.room_number AS "roomNumber",
                r.room_type AS "roomType",

                t.time_slot_id AS "slotId",
                ts.slot_code AS "slotCode",
                ts.label AS "slotLabel",
                ts.start_time AS "startTime",
                ts.end_time AS "endTime",

                t.day_of_week AS "day",
                t.timetable_date AS "timetableDate",

                t.status,
                t.notes,
                t.entry_type AS "entryType",
                t.original_timetable_id AS "originalTimetableId",
                t.original_date AS "originalDate",
                t.makeup_reason AS "makeupReason",
                orig_s.name AS "originalSubjectName",
                orig_t.day_of_week AS "originalDay",
                orig_ts.label AS "originalSlotLabel",

                t.created_at AS "createdAt"

             FROM timetable t
             JOIN classes c ON c.id = t.class_id
             JOIN programs p ON p.id = c.program_id
             JOIN sections sec ON sec.id = t.section_id
             JOIN subjects s ON s.id = t.subject_id
             JOIN teachers tr ON tr.id = t.teacher_id
             JOIN rooms r ON r.id = t.room_id
             JOIN time_slots ts ON ts.id = t.time_slot_id
             LEFT JOIN teachers mtr ON mtr.id = t.makeup_teacher_id
             LEFT JOIN timetable orig_t ON orig_t.id = t.original_timetable_id
             LEFT JOIN subjects orig_s ON orig_s.id = orig_t.subject_id
             LEFT JOIN time_slots orig_ts ON orig_ts.id = orig_t.time_slot_id

             ${where}

             ORDER BY t.timetable_date DESC, ts.start_time
             LIMIT $${limitIndex}
             OFFSET $${offsetIndex}`,
            values
        );

        res.json({
            success: true,
            data: result.rows
        });
    } catch (error) {
        console.error("Get makeup classes error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to fetch makeup classes"
        });
    }
}

/**
 * POST /api/timetable/makeup
 * Schedule a makeup class with database transaction and conflict prevention
 */
async function createMakeupClass(req, res) {
    const client = await pool.connect();
    try {
        const {
            original_timetable_id,
            class_id,
            section_id,
            subject_id,
            teacher_id,
            makeup_teacher_id,
            makeup_date,
            time_slot_id,
            slot_id,
            room_id,
            makeup_reason = "Teacher Absence",
            notes = ""
        } = req.body;

        const effectiveOrigId = original_timetable_id || req.body.originalTimetableId || null;
        const effectiveClassId = class_id || req.body.classId;
        const effectiveSectionId = section_id || req.body.sectionId;
        const effectiveSubjectId = subject_id || req.body.subjectId;
        const effectiveTeacherId = teacher_id || req.body.teacherId;
        const effectiveMakeupTeacherId = makeup_teacher_id || req.body.makeupTeacherId || effectiveTeacherId;
        const effectiveDate = makeup_date || req.body.makeupDate;
        const effectiveRoomId = room_id || req.body.roomId;
        const effectiveReason = req.body.makeup_reason || req.body.makeupReason || "Teacher Absence";
        const effectiveNotes = req.body.notes || "";

        if (!effectiveDate) {
            return res.status(400).json({ success: false, message: "Makeup date is required" });
        }

        const slotParam = time_slot_id || slot_id || req.body.slotId;
        const slot = await resolveTimeSlot(slotParam);
        if (!slot) {
            return res.status(400).json({ success: false, message: "Valid time slot is required" });
        }

        if (!effectiveClassId || !effectiveSectionId || !effectiveSubjectId || !effectiveRoomId) {
            return res.status(400).json({
                success: false,
                message: "Class, section, subject, and room are required"
            });
        }

        const assignedTeacherId = effectiveMakeupTeacherId || effectiveTeacherId;
        if (!assignedTeacherId) {
            return res.status(400).json({ success: false, message: "Teacher is required" });
        }

        const dayOfWeek = getDayNameFromDate(effectiveDate);

        const conflictData = {
            teacher_id: assignedTeacherId,
            room_id: Number(effectiveRoomId),
            class_id: Number(effectiveClassId),
            section_id: Number(effectiveSectionId),
            subject_id: Number(effectiveSubjectId),
            day_of_week: dayOfWeek,
            time_slot_id: slot.id,
            timetable_date: effectiveDate,
            entry_type: 'makeup'
        };

        const conflicts = await findConflicts(conflictData);
        if (conflicts.length) {
            // Find available rooms at this time to suggest to the user
            const freeRoomsQuery = await client.query(
                `SELECT r.id, r.room_number, r.capacity, r.room_type
                 FROM rooms r
                 WHERE r.is_active = TRUE
                   AND r.id NOT IN (
                       SELECT room_id FROM timetable
                       WHERE time_slot_id = $1
                         AND status <> 'cancelled'
                         AND (
                             (timetable_date IS NOT NULL AND timetable_date = $2::date)
                             OR (timetable_date IS NULL AND day_of_week = $3)
                         )
                   )
                 ORDER BY r.room_number
                 LIMIT 5`,
                [slot.id, effectiveDate, dayOfWeek]
            );

            return res.status(409).json({
                success: false,
                message: conflicts[0].message || "Scheduling conflict detected for makeup class",
                conflicts,
                warnings: conflicts.warnings || [],
                suggestedRooms: freeRoomsQuery.rows
            });
        }

        // Determine original class date / metadata if referencing existing entry
        let origDate = null;
        if (effectiveOrigId) {
            const origRes = await client.query(
                `SELECT timetable_date, day_of_week FROM timetable WHERE id = $1`,
                [effectiveOrigId]
            );
            if (origRes.rows.length) {
                origDate = origRes.rows[0].timetable_date || null;
            }
        }

        // Use transaction to ensure safe concurrent booking
        await client.query("BEGIN");

        const insertQuery = `
            INSERT INTO timetable
            (
                academic_year_id,
                class_id,
                section_id,
                subject_id,
                teacher_id,
                makeup_teacher_id,
                room_id,
                time_slot_id,
                day_of_week,
                timetable_date,
                status,
                notes,
                entry_type,
                original_timetable_id,
                original_date,
                makeup_reason,
                created_by
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'scheduled', $11, 'makeup', $12, $13, $14, $15)
            RETURNING *
        `;

        const result = await client.query(insertQuery, [
            1, // academic_year_id
            effectiveClassId,
            effectiveSectionId,
            effectiveSubjectId,
            effectiveTeacherId || assignedTeacherId,
            effectiveMakeupTeacherId || assignedTeacherId,
            effectiveRoomId,
            slot.id,
            dayOfWeek,
            effectiveDate,
            effectiveNotes,
            effectiveOrigId || null,
            origDate,
            effectiveReason,
            req.user?.id || null
        ]);

        const newEntry = result.rows[0];

        // Audit log
        await client.query(
            `INSERT INTO audit_logs (user_id, action, entity, entity_id, description)
             VALUES ($1, 'makeup_scheduled', 'Makeup Class', $2, $3)`,
            [
                req.user?.id || null,
                String(newEntry.id),
                `Scheduled makeup class on ${effectiveDate} (${dayOfWeek}) at ${slot.label}. Reason: ${effectiveReason}`
            ]
        );

        // System notification
        const subRes = await client.query("SELECT name FROM subjects WHERE id = $1", [effectiveSubjectId]);
        const subName = subRes.rows[0]?.name || "Class";

        await client.query(
            `INSERT INTO notifications (user_id, message, type)
             VALUES ($1, $2, 'warning')`,
            [
                req.user?.id || null,
                `Makeup class scheduled: ${subName} on ${effectiveDate} (${dayOfWeek}) at ${slot.label}. (${effectiveReason})`
            ]
        );

        await client.query("COMMIT");

        res.status(201).json({
            success: true,
            message: "Makeup class scheduled successfully",
            data: newEntry,
            warnings: conflicts.warnings || []
        });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Create makeup class error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to schedule makeup class: " + error.message
        });
    } finally {
        client.release();
    }
}

/**
 * PUT /api/timetable/makeup/:id
 * Update an existing makeup class
 */
async function updateMakeupClass(req, res) {
    try {
        const { id } = req.params;

        const existing = await pool.query(
            `SELECT * FROM timetable WHERE id = $1 AND entry_type = 'makeup'`,
            [id]
        );

        if (!existing.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Makeup class entry not found"
            });
        }

        const old = existing.rows[0];
        const data = { ...old, ...req.body };

        if (data.makeup_date) {
            data.timetable_date = data.makeup_date;
            data.day_of_week = getDayNameFromDate(data.makeup_date);
        }

        if (data.time_slot_id || data.slotId || data.slot_code) {
            const slot = await resolveTimeSlot(data.time_slot_id || data.slotId || data.slot_code);
            if (slot) data.time_slot_id = slot.id;
        }

        const conflictData = {
            teacher_id: data.makeup_teacher_id || data.teacher_id,
            room_id: data.room_id,
            class_id: data.class_id,
            section_id: data.section_id,
            subject_id: data.subject_id,
            day_of_week: data.day_of_week,
            time_slot_id: data.time_slot_id,
            timetable_date: data.timetable_date,
            entry_type: 'makeup'
        };

        const conflicts = await findConflicts(conflictData, id);
        if (conflicts.length) {
            return res.status(409).json({
                success: false,
                message: conflicts[0].message || "Scheduling conflict detected for updated makeup class",
                conflicts,
                warnings: conflicts.warnings || []
            });
        }

        const result = await pool.query(
            `UPDATE timetable
             SET
                room_id = $1,
                time_slot_id = $2,
                day_of_week = $3,
                timetable_date = $4,
                makeup_teacher_id = $5,
                makeup_reason = $6,
                notes = $7,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $8
             RETURNING *`,
            [
                data.room_id,
                data.time_slot_id,
                data.day_of_week,
                data.timetable_date,
                data.makeup_teacher_id || data.teacher_id,
                data.makeup_reason || old.makeup_reason,
                data.notes || old.notes,
                id
            ]
        );

        await pool.query(
            `INSERT INTO audit_logs (user_id, action, entity, entity_id, description)
             VALUES ($1, 'makeup_updated', 'Makeup Class', $2, $3)`,
            [
                req.user?.id || null,
                String(id),
                `Updated makeup class for ${data.timetable_date}`
            ]
        );

        res.json({
            success: true,
            message: "Makeup class updated successfully",
            data: result.rows[0],
            warnings: conflicts.warnings || []
        });
    } catch (error) {
        console.error("Update makeup class error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to update makeup class: " + error.message
        });
    }
}

/**
 * POST /api/timetable/makeup/:id/cancel
 * Cancel a scheduled makeup class (preserves history, marks status as cancelled)
 */
async function cancelMakeupClass(req, res) {
    try {
        const { id } = req.params;

        const result = await pool.query(
            `UPDATE timetable
             SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND entry_type = 'makeup'
             RETURNING *`,
            [id]
        );

        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Makeup class entry not found"
            });
        }

        const cancelled = result.rows[0];

        // Audit log
        await pool.query(
            `INSERT INTO audit_logs (user_id, action, entity, entity_id, description)
             VALUES ($1, 'makeup_cancelled', 'Makeup Class', $2, $3)`,
            [
                req.user?.id || null,
                String(id),
                `Cancelled makeup class originally scheduled on ${cancelled.timetable_date}`
            ]
        );

        // Notification
        await pool.query(
            `INSERT INTO notifications (user_id, message, type)
             VALUES ($1, $2, 'info')`,
            [
                req.user?.id || null,
                `Makeup class on ${cancelled.timetable_date} has been cancelled.`
            ]
        );

        res.json({
            success: true,
            message: "Makeup class cancelled successfully",
            data: cancelled
        });
    } catch (error) {
        console.error("Cancel makeup class error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to cancel makeup class"
        });
    }
}

module.exports = {
    getTimetable,
    createTimetable,
    updateTimetable,
    deleteTimetable,
    clearTimetable,
    getTimeSlots,
    checkAvailability,
    getMakeupClasses,
    createMakeupClass,
    updateMakeupClass,
    cancelMakeupClass,
    findConflicts
};
