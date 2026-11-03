const pool = require("../db");

const DEFAULT_RULES = [
    {
        rule_key: "NO_OVERLAP",
        name: "Prevent Overlapping Classes",
        description: "Prevent teachers from being assigned to overlapping or concurrent classes during the same time slot.",
        category: "clash",
        is_enabled: true,
        is_mandatory: true,
        config: {}
    },
    {
        rule_key: "TEACHER_AVAILABILITY",
        name: "Respect Teacher Availability & Absences",
        description: "Respect faculty availability time slots, approved leave records, and recorded absences.",
        category: "availability",
        is_enabled: true,
        is_mandatory: true,
        config: {}
    },
    {
        rule_key: "SUBJECT_QUALIFICATION",
        name: "Assign Only Qualified / Authorized Faculty",
        description: "Assign teachers only to subjects they are qualified or authorized to teach based on curriculum and department assignments.",
        category: "qualification",
        is_enabled: true,
        is_mandatory: true,
        config: { allow_department_fallback: true }
    },
    {
        rule_key: "MAX_DAILY_HOURS",
        name: "Maximum Daily Teaching Hours",
        description: "Limit the maximum number of teaching periods a faculty member can conduct in a single day.",
        category: "workload",
        is_enabled: true,
        is_mandatory: true,
        config: { max_hours: 4 }
    },
    {
        rule_key: "MAX_WEEKLY_HOURS",
        name: "Maximum Weekly Teaching Hours",
        description: "Limit the maximum total number of teaching periods a faculty member can conduct in a week.",
        category: "workload",
        is_enabled: true,
        is_mandatory: true,
        config: { max_hours: 16 }
    },
    {
        rule_key: "MAX_CONSECUTIVE_PERIODS",
        name: "Maximum Consecutive Teaching Periods",
        description: "Limit the number of consecutive back-to-back teaching periods without an intervening break.",
        category: "workload",
        is_enabled: true,
        is_mandatory: true,
        config: { max_consecutive: 2 }
    },
    {
        rule_key: "MIN_BREAK_DURATION",
        name: "Minimum Break Between Lectures",
        description: "Require a mandatory rest or break period after reaching the consecutive teaching limit.",
        category: "workload",
        is_enabled: true,
        is_mandatory: true,
        config: { min_break_slots: 1 }
    },
    {
        rule_key: "SUBJECT_WEEKLY_QUOTA",
        name: "Ensure Required Weekly Lecture Counts",
        description: "Verify that all scheduled subjects fulfill their prescribed weekly curriculum periods.",
        category: "curriculum",
        is_enabled: true,
        is_mandatory: true,
        config: {}
    },
    {
        rule_key: "TEACHER_PREFERRED_SLOTS",
        name: "Preferred Teaching Days & Time Slots",
        description: "Schedule lectures according to faculty declared preferred days of the week and preferred slot windows.",
        category: "preference",
        is_enabled: true,
        is_mandatory: false,
        config: {
            preferred_days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
            preferred_time_range: "09:00 - 16:00"
        }
    },
    {
        rule_key: "MINIMIZE_GAPS",
        name: "Minimize Schedule Gaps",
        description: "Avoid scattered daily schedules with unnecessary non-teaching idle gaps between lectures.",
        category: "preference",
        is_enabled: true,
        is_mandatory: false,
        config: { max_allowed_gap_slots: 2 }
    },
    {
        rule_key: "WORKLOAD_BALANCE",
        name: "Fair Faculty Workload Distribution",
        description: "Distribute teaching loads equitably across qualified and eligible faculty members.",
        category: "workload",
        is_enabled: true,
        is_mandatory: false,
        config: {}
    },
    {
        rule_key: "MAKEUP_VALIDATION",
        name: "Validate Makeup Classes Against Hard Constraints",
        description: "Enforce all hard constraints (overlap, availability, daily/weekly limits, consecutive limits, break) on makeup classes.",
        category: "makeup",
        is_enabled: true,
        is_mandatory: true,
        config: {}
    }
];

/**
 * GET /api/rules
 * Fetch all configured timetable rules
 */
async function getRules(req, res) {
    try {
        const result = await pool.query(
            `SELECT id, rule_key, name, description, category, is_enabled, is_mandatory, config, updated_at
             FROM timetable_rules
             ORDER BY id ASC`
        );
        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (error) {
        console.error("Get rules error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch timetable rules" });
    }
}

const RULE_ALIASES = {
    TEACHER_QUALIFICATION: "SUBJECT_QUALIFICATION",
    PREFERRED_DAYS_SLOTS: "TEACHER_PREFERRED_SLOTS",
    WORKLOAD_FAIR_DISTRIBUTION: "WORKLOAD_BALANCE",
    MAKEUP_CLASS_HARD_RULES: "MAKEUP_VALIDATION"
};

/**
 * GET /api/rules/:key
 * Fetch a single rule by rule_key
 */
async function getRuleByKey(req, res) {
    try {
        const key = RULE_ALIASES[req.params.key] || req.params.key;
        const result = await pool.query(
            `SELECT id, rule_key, name, description, category, is_enabled, is_mandatory, config, updated_at
             FROM timetable_rules
             WHERE rule_key = $1`,
            [key]
        );
        if (!result.rows.length) {
            return res.status(404).json({ success: false, message: `Rule '${req.params.key}' not found` });
        }
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error("Get rule error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch rule" });
    }
}

async function getSafeAuditUserId(userId) {
    if (!userId) return null;
    try {
        const res = await pool.query("SELECT id FROM users WHERE id = $1", [userId]);
        return res.rows.length ? res.rows[0].id : null;
    } catch (_) {
        return null;
    }
}

/**
 * PUT /api/rules/:key
 * Update an existing rule's configuration, toggle status, or enforcement mode (Admin only)
 */
async function updateRule(req, res) {
    try {
        const key = RULE_ALIASES[req.params.key] || req.params.key;
        const { is_enabled, is_mandatory, config, name, description } = req.body;

        const existing = await pool.query(
            `SELECT * FROM timetable_rules WHERE rule_key = $1`,
            [key]
        );

        if (!existing.rows.length) {
            return res.status(404).json({ success: false, message: `Rule '${req.params.key}' not found` });
        }

        const current = existing.rows[0];
        const newEnabled = is_enabled !== undefined ? Boolean(is_enabled) : current.is_enabled;
        const newMandatory = is_mandatory !== undefined ? Boolean(is_mandatory) : current.is_mandatory;
        const newConfig = config !== undefined ? { ...current.config, ...config } : current.config;
        const newName = name || current.name;
        const newDesc = description || current.description;

        const auditUserId = await getSafeAuditUserId(req.user?.id);

        const updateResult = await pool.query(
            `UPDATE timetable_rules
             SET is_enabled = $1, is_mandatory = $2, config = $3, name = $4, description = $5,
                 updated_at = NOW(), updated_by = $6
             WHERE rule_key = $7
             RETURNING *`,
            [newEnabled, newMandatory, JSON.stringify(newConfig), newName, newDesc, auditUserId, key]
        );

        // Audit log
        await pool.query(
            `INSERT INTO audit_logs (user_id, action, entity, entity_id, description)
             VALUES ($1, 'update_rule', 'Timetable Rule', $2, $3)`,
            [
                auditUserId,
                key,
                `Updated rule '${key}': enabled=${newEnabled}, mandatory=${newMandatory}, config=${JSON.stringify(newConfig)}`
            ]
        );

        res.json({
            success: true,
            message: `Rule '${key}' updated successfully`,
            data: updateResult.rows[0]
        });
    } catch (error) {
        console.error("Update rule error:", error);
        res.status(500).json({ success: false, message: "Failed to update rule: " + error.message });
    }
}

/**
 * POST /api/rules/reset-defaults
 * Reset all rules to university baseline defaults (Admin only)
 */
async function resetRulesToDefaults(req, res) {
    try {
        const auditUserId = await getSafeAuditUserId(req.user?.id);
        for (const rule of DEFAULT_RULES) {
            await pool.query(
                `INSERT INTO timetable_rules (rule_key, name, description, category, is_enabled, is_mandatory, config, updated_at, updated_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)
                 ON CONFLICT (rule_key) DO UPDATE
                 SET name = EXCLUDED.name,
                     description = EXCLUDED.description,
                     category = EXCLUDED.category,
                     is_enabled = EXCLUDED.is_enabled,
                     is_mandatory = EXCLUDED.is_mandatory,
                     config = EXCLUDED.config,
                     updated_at = NOW(),
                     updated_by = EXCLUDED.updated_by`,
                [
                    rule.rule_key,
                    rule.name,
                    rule.description,
                    rule.category,
                    rule.is_enabled,
                    rule.is_mandatory,
                    JSON.stringify(rule.config),
                    auditUserId
                ]
            );
        }

        // Audit log
        await pool.query(
            `INSERT INTO audit_logs (user_id, action, entity, entity_id, description)
             VALUES ($1, 'reset_rules', 'Timetable Rules', 'all', 'Reset all timetable rules to university defaults')`,
            [auditUserId]
        );

        const allRules = await pool.query(`SELECT * FROM timetable_rules ORDER BY id ASC`);

        res.json({
            success: true,
            message: "All timetable rules reset to university defaults",
            data: allRules.rows
        });
    } catch (error) {
        console.error("Reset rules error:", error);
        res.status(500).json({ success: false, message: "Failed to reset rules to defaults" });
    }
}

/**
 * GET /api/rules/teacher-preferences/:teacherId
 * Fetch preferred hours and slot settings for a faculty member
 */
async function getTeacherPreferences(req, res) {
    try {
        const { teacherId } = req.params;

        const prefQuery = await pool.query(
            `SELECT tp.*, t.full_name AS teacher_name, t.teacher_code, d.name AS department_name
             FROM teachers t
             LEFT JOIN departments d ON d.id = t.department_id
             LEFT JOIN teacher_preferences tp ON tp.teacher_id = t.id
             WHERE t.id = $1`,
            [teacherId]
        );

        if (!prefQuery.rows.length) {
            return res.status(404).json({ success: false, message: "Teacher not found" });
        }

        let pref = prefQuery.rows[0];

        // If no preference record exists yet, return default structure
        if (!pref.id) {
            pref = {
                teacher_id: Number(teacherId),
                teacher_name: pref.teacher_name,
                teacher_code: pref.teacher_code,
                department_name: pref.department_name,
                preferred_days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
                preferred_slots: ["s1", "s2", "s3", "s4", "s5"],
                max_daily_periods: 4,
                notes: "",
                status: "Approved",
                created_at: null,
                updated_at: null
            };
        }

        res.json({
            success: true,
            data: pref
        });
    } catch (error) {
        console.error("Get teacher preferences error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch teacher preferences" });
    }
}

/**
 * POST /api/rules/teacher-preferences
 * Submit or update teacher scheduling preferences
 */
async function saveTeacherPreferences(req, res) {
    try {
        const { teacher_id, preferred_days, preferred_slots, max_daily_periods, notes } = req.body;

        const effectiveTeacherId = Number(teacher_id || req.user?.teacherId);

        if (!effectiveTeacherId) {
            return res.status(400).json({ success: false, message: "teacher_id is required" });
        }

        // Authorization check: Teacher can only update their own, Admin can update any
        if (req.user?.role !== "ADMIN" && String(req.user?.teacherId) !== String(effectiveTeacherId)) {
            return res.status(403).json({
                success: false,
                message: "Forbidden: You are not authorized to update another teacher's preferences"
            });
        }

        const days = Array.isArray(preferred_days) && preferred_days.length
            ? preferred_days
            : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

        const slots = Array.isArray(preferred_slots) && preferred_slots.length
            ? preferred_slots
            : ["s1", "s2", "s3", "s4", "s5"];

        const maxDaily = max_daily_periods ? Math.max(1, Math.min(8, Number(max_daily_periods))) : 4;

        // Status: Admin directly approves; Teacher request status is Approved by default or Pending if university policy requires review
        const status = req.user?.role === "ADMIN" ? "Approved" : "Approved";

        const result = await pool.query(
            `INSERT INTO teacher_preferences (teacher_id, preferred_days, preferred_slots, max_daily_periods, notes, status, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             ON CONFLICT (teacher_id) DO UPDATE
             SET preferred_days = EXCLUDED.preferred_days,
                 preferred_slots = EXCLUDED.preferred_slots,
                 max_daily_periods = EXCLUDED.max_daily_periods,
                 notes = EXCLUDED.notes,
                 status = EXCLUDED.status,
                 updated_at = NOW()
             RETURNING *`,
            [effectiveTeacherId, days, slots, maxDaily, notes || null, status]
        );

        // Audit log
        const auditUserId = await getSafeAuditUserId(req.user?.id);
        await pool.query(
            `INSERT INTO audit_logs (user_id, action, entity, entity_id, description)
             VALUES ($1, 'save_teacher_preference', 'Teacher Preference', $2, $3)`,
            [
                auditUserId,
                String(effectiveTeacherId),
                `Saved scheduling preferences for Teacher ID ${effectiveTeacherId}: days=[${days.join(",")}], slots=[${slots.join(",")}], maxDaily=${maxDaily}`
            ]
        );

        res.json({
            success: true,
            message: "Teacher preferences saved successfully",
            data: result.rows[0]
        });
    } catch (error) {
        console.error("Save teacher preferences error:", error);
        res.status(500).json({ success: false, message: "Failed to save teacher preferences: " + error.message });
    }
}

/**
 * GET /api/rules/all-teacher-preferences
 * Admin overview of all teachers with custom preferences
 */
async function getAllTeacherPreferences(req, res) {
    try {
        const result = await pool.query(
            `SELECT tp.*, t.full_name AS teacher_name, t.teacher_code, d.name AS department_name
             FROM teacher_preferences tp
             JOIN teachers t ON t.id = tp.teacher_id
             LEFT JOIN departments d ON d.id = t.department_id
             ORDER BY tp.updated_at DESC`
        );
        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (error) {
        console.error("Get all preferences error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch teacher preferences" });
    }
}

/**
 * PUT /api/rules/teacher-preferences/:id/status
 * Admin update preference status (Approve / Reject)
 */
async function updatePreferenceStatus(req, res) {
    try {
        const { id } = req.params;
        const { status, admin_notes } = req.body;

        if (!["Approved", "Pending", "Rejected"].includes(status)) {
            return res.status(400).json({ success: false, message: "Status must be Approved, Pending, or Rejected" });
        }

        const result = await pool.query(
            `UPDATE teacher_preferences
             SET status = $1, reviewed_by = $2, updated_at = NOW()
             WHERE id = $3
             RETURNING *`,
            [status, req.user?.id || null, id]
        );

        if (!result.rows.length) {
            return res.status(404).json({ success: false, message: "Preference record not found" });
        }

        res.json({
            success: true,
            message: `Preference status updated to ${status}`,
            data: result.rows[0]
        });
    } catch (error) {
        console.error("Update preference status error:", error);
        res.status(500).json({ success: false, message: "Failed to update preference status" });
    }
}

/**
 * GET /api/rules/workload-stats/:teacherId
 * Detailed workload analytics & compliance against configured rules for a teacher
 */
async function getTeacherWorkloadStats(req, res) {
    try {
        const { teacherId } = req.params;

        // Fetch teacher
        const tResult = await pool.query(
            `SELECT t.id, t.full_name, t.teacher_code, d.name AS department_name
             FROM teachers t
             LEFT JOIN departments d ON d.id = t.department_id
             WHERE t.id = $1`,
            [teacherId]
        );

        if (!tResult.rows.length) {
            return res.status(404).json({ success: false, message: "Teacher not found" });
        }

        const teacher = tResult.rows[0];

        // Fetch active rules limits
        const rulesRes = await pool.query(
            `SELECT rule_key, is_enabled, is_mandatory, config
             FROM timetable_rules`
        );
        const rulesMap = {};
        rulesRes.rows.forEach(r => { rulesMap[r.rule_key] = r; });

        const maxDailyConfig = (rulesMap["MAX_DAILY_HOURS"]?.config?.max_hours) || 4;
        const maxWeeklyConfig = (rulesMap["MAX_WEEKLY_HOURS"]?.config?.max_hours) || 16;
        const maxConsecutiveConfig = (rulesMap["MAX_CONSECUTIVE_PERIODS"]?.config?.max_consecutive) || 2;
        const minBreakConfig = (rulesMap["MIN_BREAK_DURATION"]?.config?.min_break_slots) || 1;

        // Fetch scheduled slots for this teacher
        const scheduled = await pool.query(
            `SELECT t.id, t.day_of_week, t.time_slot_id, ts.slot_code, ts.start_time, ts.end_time, ts.label,
                    s.name AS subject_name, c.name AS class_name, sec.name AS section_name, r.room_number
             FROM timetable t
             JOIN time_slots ts ON ts.id = t.time_slot_id
             JOIN subjects s ON s.id = t.subject_id
             JOIN classes c ON c.id = t.class_id
             JOIN sections sec ON sec.id = t.section_id
             JOIN rooms r ON r.id = t.room_id
             WHERE t.teacher_id = $1 AND t.status <> 'cancelled'
             ORDER BY t.day_of_week, ts.start_time`,
            [teacherId]
        );

        const totalWeekly = scheduled.rows.length;

        // Daily breakdown
        const dailyCounts = {
            Monday: 0,
            Tuesday: 0,
            Wednesday: 0,
            Thursday: 0,
            Friday: 0,
            Saturday: 0
        };

        const slotsPerDay = {
            Monday: [],
            Tuesday: [],
            Wednesday: [],
            Thursday: [],
            Friday: [],
            Saturday: []
        };

        scheduled.rows.forEach(row => {
            const day = row.day_of_week;
            if (dailyCounts[day] !== undefined) {
                dailyCounts[day]++;
                slotsPerDay[day].push(row);
            }
        });

        // Compute max consecutive periods achieved
        let peakConsecutive = 0;
        Object.keys(slotsPerDay).forEach(day => {
            const list = slotsPerDay[day];
            if (list.length <= 1) {
                peakConsecutive = Math.max(peakConsecutive, list.length);
                return;
            }
            // Sort by slot start_time
            list.sort((a, b) => a.start_time.localeCompare(b.start_time));
            let currentRun = 1;
            for (let i = 1; i < list.length; i++) {
                if (list[i].start_time === list[i - 1].end_time) {
                    currentRun++;
                } else {
                    peakConsecutive = Math.max(peakConsecutive, currentRun);
                    currentRun = 1;
                }
            }
            peakConsecutive = Math.max(peakConsecutive, currentRun);
        });

        // Qualified subjects
        const subjectsRes = await pool.query(
            `SELECT DISTINCT s.id, s.code, s.name
             FROM subjects s
             LEFT JOIN teacher_subjects ts ON ts.subject_id = s.id AND ts.teacher_id = $1
             LEFT JOIN class_subjects cs ON cs.subject_id = s.id AND cs.teacher_id = $1
             WHERE ts.teacher_id = $1 OR cs.teacher_id = $1`,
            [teacherId]
        );

        // Teacher preferences
        const prefRes = await pool.query(
            `SELECT * FROM teacher_preferences WHERE teacher_id = $1`,
            [teacherId]
        );

        // Warnings / Rule compliance checks
        const warnings = [];
        if (totalWeekly > maxWeeklyConfig) {
            warnings.push({
                type: "WEEKLY_HOURS_EXCEEDED",
                message: `Teacher currently scheduled for ${totalWeekly} periods, exceeding university weekly limit of ${maxWeeklyConfig}.`
            });
        }

        Object.entries(dailyCounts).forEach(([day, count]) => {
            if (count > maxDailyConfig) {
                warnings.push({
                    type: "DAILY_HOURS_EXCEEDED",
                    message: `Teacher has ${count} periods scheduled on ${day}, exceeding daily limit of ${maxDailyConfig}.`
                });
            }
        });

        if (peakConsecutive > maxConsecutiveConfig) {
            warnings.push({
                type: "CONSECUTIVE_LIMIT_EXCEEDED",
                message: `Teacher has ${peakConsecutive} back-to-back periods scheduled, exceeding consecutive limit of ${maxConsecutiveConfig}.`
            });
        }

        const metricsObj = {
            total_weekly_periods: totalWeekly,
            peak_consecutive_periods: peakConsecutive,
            daily_counts: dailyCounts,
            is_weekly_compliant: totalWeekly <= maxWeeklyConfig,
            is_daily_compliant: Object.values(dailyCounts).every(c => c <= maxDailyConfig),
            is_consecutive_compliant: peakConsecutive <= maxConsecutiveConfig
        };

        res.json({
            success: true,
            data: {
                teacher,
                total_weekly_periods: totalWeekly,
                peak_consecutive_periods: peakConsecutive,
                daily_counts: dailyCounts,
                limits: {
                    max_daily_hours: maxDailyConfig,
                    max_weekly_hours: maxWeeklyConfig,
                    max_consecutive_periods: maxConsecutiveConfig,
                    min_break_slots: minBreakConfig
                },
                metrics: metricsObj,
                preferences: prefRes.rows.length ? prefRes.rows[0] : null,
                qualified_subjects: subjectsRes.rows,
                warnings
            }
        });
    } catch (error) {
        console.error("Get workload stats error:", error);
        res.status(500).json({ success: false, message: "Failed to calculate teacher workload stats" });
    }
}

module.exports = {
    getRules,
    getRuleByKey,
    updateRule,
    resetRulesToDefaults,
    getTeacherPreferences,
    saveTeacherPreferences,
    getAllTeacherPreferences,
    updatePreferenceStatus,
    getTeacherWorkloadStats,
    DEFAULT_RULES
};
