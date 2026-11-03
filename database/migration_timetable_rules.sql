-- Migration: Teacher Timetable Constraints, Rules and Preferences
BEGIN;

-- 1. Create timetable_rules table
CREATE TABLE IF NOT EXISTS timetable_rules (
    id SERIAL PRIMARY KEY,
    rule_key VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL DEFAULT 'workload',
    is_enabled BOOLEAN DEFAULT TRUE,
    is_mandatory BOOLEAN DEFAULT TRUE,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by INT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_timetable_rules_key ON timetable_rules(rule_key);
CREATE INDEX IF NOT EXISTS idx_timetable_rules_enabled ON timetable_rules(is_enabled);

-- 2. Create teacher_preferences table
CREATE TABLE IF NOT EXISTS teacher_preferences (
    id SERIAL PRIMARY KEY,
    teacher_id INT UNIQUE NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    preferred_days VARCHAR[] DEFAULT ARRAY['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    preferred_slots VARCHAR[] DEFAULT ARRAY['s1', 's2', 's3', 's4', 's5'],
    max_daily_periods INT DEFAULT 4,
    notes TEXT,
    status VARCHAR(30) DEFAULT 'Approved',
    reviewed_by INT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_teacher_pref_teacher ON teacher_preferences(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_pref_status ON teacher_preferences(status);

-- 3. Seed default configurable rules
INSERT INTO timetable_rules (rule_key, name, description, category, is_enabled, is_mandatory, config)
VALUES
    (
        'NO_OVERLAP',
        'Prevent Overlapping Classes',
        'Prevent teachers from being assigned to overlapping or concurrent classes during the same time slot.',
        'clash',
        TRUE,
        TRUE,
        '{}'::jsonb
    ),
    (
        'TEACHER_AVAILABILITY',
        'Respect Teacher Availability & Absences',
        'Respect faculty availability time slots, approved leave records, and recorded absences.',
        'availability',
        TRUE,
        TRUE,
        '{}'::jsonb
    ),
    (
        'SUBJECT_QUALIFICATION',
        'Assign Only Qualified / Authorized Faculty',
        'Assign teachers only to subjects they are qualified or authorized to teach based on curriculum and department assignments.',
        'qualification',
        TRUE,
        TRUE,
        '{"allow_department_fallback": true}'::jsonb
    ),
    (
        'MAX_DAILY_HOURS',
        'Maximum Daily Teaching Hours',
        'Limit the maximum number of teaching periods a faculty member can conduct in a single day.',
        'workload',
        TRUE,
        TRUE,
        '{"max_hours": 4}'::jsonb
    ),
    (
        'MAX_WEEKLY_HOURS',
        'Maximum Weekly Teaching Hours',
        'Limit the maximum total number of teaching periods a faculty member can conduct in a week.',
        'workload',
        TRUE,
        TRUE,
        '{"max_hours": 16}'::jsonb
    ),
    (
        'MAX_CONSECUTIVE_PERIODS',
        'Maximum Consecutive Teaching Periods',
        'Limit the number of consecutive back-to-back teaching periods without an intervening break.',
        'workload',
        TRUE,
        TRUE,
        '{"max_consecutive": 2}'::jsonb
    ),
    (
        'MIN_BREAK_DURATION',
        'Minimum Break Between Lectures',
        'Require a mandatory rest or break period after reaching the consecutive teaching limit.',
        'workload',
        TRUE,
        TRUE,
        '{"min_break_slots": 1}'::jsonb
    ),
    (
        'SUBJECT_WEEKLY_QUOTA',
        'Ensure Required Weekly Lecture Counts',
        'Verify that all scheduled subjects fulfill their prescribed weekly curriculum periods.',
        'curriculum',
        TRUE,
        TRUE,
        '{}'::jsonb
    ),
    (
        'TEACHER_PREFERRED_SLOTS',
        'Preferred Teaching Days & Time Slots',
        'Schedule lectures according to faculty declared preferred days of the week and preferred slot windows.',
        'preference',
        TRUE,
        FALSE,
        '{"preferred_days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], "preferred_time_range": "09:00 - 16:00"}'::jsonb
    ),
    (
        'MINIMIZE_GAPS',
        'Minimize Schedule Gaps',
        'Avoid scattered daily schedules with unnecessary non-teaching idle gaps between lectures.',
        'preference',
        TRUE,
        FALSE,
        '{"max_allowed_gap_slots": 2}'::jsonb
    ),
    (
        'WORKLOAD_BALANCE',
        'Fair Faculty Workload Distribution',
        'Distribute teaching loads equitably across qualified and eligible faculty members.',
        'workload',
        TRUE,
        FALSE,
        '{}'::jsonb
    ),
    (
        'MAKEUP_VALIDATION',
        'Validate Makeup Classes Against Hard Constraints',
        'Enforce all hard constraints (overlap, availability, daily/weekly limits, consecutive limits, break) on makeup classes.',
        'makeup',
        TRUE,
        TRUE,
        '{}'::jsonb
    )
ON CONFLICT (rule_key) DO UPDATE
SET 
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    category = EXCLUDED.category;

-- 4. Seed initial preferences for Faculty 1 (teacher@brightfield.edu, id=1) if not exists
INSERT INTO teacher_preferences (teacher_id, preferred_days, preferred_slots, max_daily_periods, notes, status)
VALUES (
    1,
    ARRAY['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    ARRAY['s1', 's2', 's3', 's4'],
    4,
    'Prefers morning lectures and consecutive blocks before 2:00 PM.',
    'Approved'
)
ON CONFLICT (teacher_id) DO NOTHING;

COMMIT;
