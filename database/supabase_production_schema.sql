-- ==============================================================================
-- SMART CLASSROOM & TIMETABLE SCHEDULER - SUPABASE PRODUCTION SCHEMA
-- ==============================================================================

-- 1. BASE ACADEMIC & INSTITUTIONAL STRUCTURE
CREATE TABLE IF NOT EXISTS programs (
    id SERIAL PRIMARY KEY,
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    degree_level VARCHAR(50),
    duration_years INT DEFAULT 4,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS departments (
    id SERIAL PRIMARY KEY,
    code VARCHAR(30) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    program_id INT REFERENCES programs(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(200) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(30) NOT NULL DEFAULT 'ADMIN',
    is_active BOOLEAN DEFAULT TRUE,
    phone VARCHAR(50),
    avatar_url TEXT,
    department_id INT REFERENCES departments(id) ON DELETE SET NULL,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS teachers (
    id SERIAL PRIMARY KEY,
    teacher_code VARCHAR(50) UNIQUE NOT NULL,
    user_id INT REFERENCES users(id) ON DELETE SET NULL,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(200),
    department_id INT REFERENCES departments(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS students (
    id SERIAL PRIMARY KEY,
    enrollment_no VARCHAR(100) UNIQUE,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(200),
    program_id INT REFERENCES programs(id),
    department_id INT REFERENCES departments(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS academic_years (
    id SERIAL PRIMARY KEY,
    name VARCHAR(30) UNIQUE NOT NULL,
    start_date DATE,
    end_date DATE,
    is_current BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS semesters (
    id SERIAL PRIMARY KEY,
    academic_year_id INT REFERENCES academic_years(id) ON DELETE CASCADE,
    semester_number INT NOT NULL,
    name VARCHAR(50),
    UNIQUE(academic_year_id, semester_number)
);

CREATE TABLE IF NOT EXISTS classes (
    id SERIAL PRIMARY KEY,
    class_code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    program_id INT REFERENCES programs(id),
    department_id INT REFERENCES departments(id),
    semester_id INT REFERENCES semesters(id),
    student_count INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sections (
    id SERIAL PRIMARY KEY,
    class_id INT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    name VARCHAR(20) NOT NULL,
    student_count INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE(class_id, name)
);

CREATE TABLE IF NOT EXISTS subjects (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    department_id INT REFERENCES departments(id),
    credits INT DEFAULT 3,
    weekly_periods INT DEFAULT 3,
    subject_type VARCHAR(30) DEFAULT 'Theory',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS teacher_subjects (
    teacher_id INT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    subject_id INT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    PRIMARY KEY(teacher_id, subject_id)
);

CREATE TABLE IF NOT EXISTS class_subjects (
    class_id INT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    subject_id INT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    teacher_id INT REFERENCES teachers(id) ON DELETE SET NULL,
    weekly_periods INT DEFAULT 3,
    PRIMARY KEY(class_id, subject_id)
);

CREATE TABLE IF NOT EXISTS buildings (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    code VARCHAR(30)
);

CREATE TABLE IF NOT EXISTS rooms (
    id SERIAL PRIMARY KEY,
    room_number VARCHAR(50) UNIQUE NOT NULL,
    building_id INT REFERENCES buildings(id) ON DELETE SET NULL,
    capacity INT NOT NULL DEFAULT 30,
    room_type VARCHAR(50) DEFAULT 'Lecture Hall',
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS time_slots (
    id SERIAL PRIMARY KEY,
    slot_code VARCHAR(20) UNIQUE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    label VARCHAR(50) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS teacher_availability (
    id SERIAL PRIMARY KEY,
    teacher_id INT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    day_of_week VARCHAR(15) NOT NULL,
    time_slot_id INT NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
    available BOOLEAN DEFAULT TRUE,
    UNIQUE(teacher_id, day_of_week, time_slot_id)
);

CREATE TABLE IF NOT EXISTS room_availability (
    id SERIAL PRIMARY KEY,
    room_id INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    day_of_week VARCHAR(15) NOT NULL,
    time_slot_id INT NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
    available BOOLEAN DEFAULT TRUE,
    UNIQUE(room_id, day_of_week, time_slot_id)
);

CREATE TABLE IF NOT EXISTS timetable (
    id BIGSERIAL PRIMARY KEY,
    academic_year_id INT REFERENCES academic_years(id),
    class_id INT NOT NULL REFERENCES classes(id),
    section_id INT NOT NULL REFERENCES sections(id),
    subject_id INT NOT NULL REFERENCES subjects(id),
    teacher_id INT NOT NULL REFERENCES teachers(id),
    room_id INT NOT NULL REFERENCES rooms(id),
    time_slot_id INT NOT NULL REFERENCES time_slots(id),
    day_of_week VARCHAR(15) NOT NULL,
    timetable_date DATE,
    status VARCHAR(30) DEFAULT 'scheduled',
    notes TEXT,
    entry_type VARCHAR(30) DEFAULT 'regular',
    original_timetable_id BIGINT REFERENCES timetable(id) ON DELETE SET NULL,
    original_date DATE,
    makeup_reason TEXT,
    makeup_teacher_id INT REFERENCES teachers(id) ON DELETE SET NULL,
    created_by INT REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS announcements (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(250) NOT NULL,
    description TEXT,
    priority VARCHAR(20) DEFAULT 'Medium',
    created_by INT REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
    id BIGSERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    type VARCHAR(30) DEFAULT 'info',
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,
    entity VARCHAR(100),
    entity_id VARCHAR(100),
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS teacher_absences (
    id BIGSERIAL PRIMARY KEY,
    teacher_id INT NOT NULL REFERENCES teachers(id),
    absence_date DATE NOT NULL,
    reason TEXT,
    created_by INT REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS substitute_assignments (
    id BIGSERIAL PRIMARY KEY,
    absence_id BIGINT REFERENCES teacher_absences(id) ON DELETE CASCADE,
    timetable_id BIGINT REFERENCES timetable(id) ON DELETE CASCADE,
    substitute_teacher_id INT REFERENCES teachers(id),
    created_by INT REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS timetable_change_requests (
    id SERIAL PRIMARY KEY,
    teacher_id INT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    timetable_id BIGINT REFERENCES timetable(id) ON DELETE CASCADE,
    request_type VARCHAR(50) NOT NULL DEFAULT 'makeup',
    proposed_date DATE,
    proposed_slot_id INT REFERENCES time_slots(id),
    proposed_room_id INT REFERENCES rooms(id),
    reason TEXT,
    status VARCHAR(30) DEFAULT 'Pending',
    admin_notes TEXT,
    reviewed_by INT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS study_plans (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    program_id INT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    department_id INT REFERENCES departments(id) ON DELETE SET NULL,
    academic_year_id INT REFERENCES academic_years(id) ON DELETE SET NULL,
    semester_id INT REFERENCES semesters(id) ON DELETE SET NULL,
    semester_number INT DEFAULT 1,
    subject_id INT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    teacher_id INT REFERENCES teachers(id) ON DELETE SET NULL,
    academic_year VARCHAR(30) DEFAULT '2026-27',
    credits INT DEFAULT 3,
    status VARCHAR(30) DEFAULT 'Active',
    description TEXT,
    objectives TEXT,
    modules JSONB DEFAULT '[]'::jsonb,
    created_by INT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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

-- ==============================================================================
-- INDEXES FOR PERFORMANCE AND DATA INTEGRITY
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_teachers_department ON teachers(department_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_teachers_user_id ON teachers(user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_teachers_email ON teachers(LOWER(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_classes_program ON classes(program_id);
CREATE INDEX IF NOT EXISTS idx_classes_department ON classes(department_id);
CREATE INDEX IF NOT EXISTS idx_subjects_department ON subjects(department_id);
CREATE INDEX IF NOT EXISTS idx_rooms_building ON rooms(building_id);
CREATE INDEX IF NOT EXISTS idx_timetable_teacher_day_slot ON timetable(teacher_id, day_of_week, time_slot_id);
CREATE INDEX IF NOT EXISTS idx_timetable_room_day_slot ON timetable(room_id, day_of_week, time_slot_id);
CREATE INDEX IF NOT EXISTS idx_timetable_class_day_slot ON timetable(class_id, day_of_week, time_slot_id);
CREATE INDEX IF NOT EXISTS idx_timetable_section_day_slot ON timetable(section_id, day_of_week, time_slot_id);
CREATE INDEX IF NOT EXISTS idx_timetable_entry_type ON timetable(entry_type);
CREATE INDEX IF NOT EXISTS idx_timetable_date ON timetable(timetable_date);
CREATE INDEX IF NOT EXISTS idx_timetable_original ON timetable(original_timetable_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_change_requests_teacher ON timetable_change_requests(teacher_id);
CREATE INDEX IF NOT EXISTS idx_change_requests_status ON timetable_change_requests(status);
CREATE INDEX IF NOT EXISTS idx_study_plans_program ON study_plans(program_id);
CREATE INDEX IF NOT EXISTS idx_study_plans_dept ON study_plans(department_id);
CREATE INDEX IF NOT EXISTS idx_study_plans_sem ON study_plans(semester_number);
CREATE INDEX IF NOT EXISTS idx_study_plans_subject ON study_plans(subject_id);
CREATE INDEX IF NOT EXISTS idx_study_plans_teacher ON study_plans(teacher_id);
CREATE INDEX IF NOT EXISTS idx_timetable_rules_key ON timetable_rules(rule_key);
CREATE INDEX IF NOT EXISTS idx_timetable_rules_enabled ON timetable_rules(is_enabled);
CREATE INDEX IF NOT EXISTS idx_teacher_pref_teacher ON teacher_preferences(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_pref_status ON teacher_preferences(status);

