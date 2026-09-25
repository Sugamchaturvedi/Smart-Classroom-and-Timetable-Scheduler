DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS substitute_assignments CASCADE;
DROP TABLE IF EXISTS teacher_absences CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS announcements CASCADE;
DROP TABLE IF EXISTS timetable CASCADE;
DROP TABLE IF EXISTS room_availability CASCADE;
DROP TABLE IF EXISTS teacher_availability CASCADE;
DROP TABLE IF EXISTS class_subjects CASCADE;
DROP TABLE IF EXISTS teacher_subjects CASCADE;
DROP TABLE IF EXISTS subjects CASCADE;
DROP TABLE IF EXISTS sections CASCADE;
DROP TABLE IF EXISTS classes CASCADE;
DROP TABLE IF EXISTS students CASCADE;
DROP TABLE IF EXISTS rooms CASCADE;
DROP TABLE IF EXISTS buildings CASCADE;
DROP TABLE IF EXISTS semesters CASCADE;
DROP TABLE IF EXISTS academic_years CASCADE;
DROP TABLE IF EXISTS teachers CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS departments CASCADE;
DROP TABLE IF EXISTS programs CASCADE;
DROP TABLE IF EXISTS time_slots CASCADE;

CREATE TABLE programs (
    id SERIAL PRIMARY KEY,
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    degree_level VARCHAR(50),
    duration_years INT DEFAULT 4,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE departments (
    id SERIAL PRIMARY KEY,
    code VARCHAR(30) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    program_id INT REFERENCES programs(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(200) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(30) NOT NULL DEFAULT 'admin',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE teachers (
    id SERIAL PRIMARY KEY,
    teacher_code VARCHAR(50) UNIQUE NOT NULL,
    user_id INT REFERENCES users(id) ON DELETE SET NULL,
    full_name VARCHAR(150) NOT NULL,
    department_id INT REFERENCES departments(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE students (
    id SERIAL PRIMARY KEY,
    enrollment_no VARCHAR(100) UNIQUE,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(200),
    program_id INT REFERENCES programs(id),
    department_id INT REFERENCES departments(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE academic_years (
    id SERIAL PRIMARY KEY,
    name VARCHAR(30) UNIQUE NOT NULL,
    start_date DATE,
    end_date DATE,
    is_current BOOLEAN DEFAULT FALSE
);

CREATE TABLE semesters (
    id SERIAL PRIMARY KEY,
    academic_year_id INT REFERENCES academic_years(id) ON DELETE CASCADE,
    semester_number INT NOT NULL,
    name VARCHAR(50),
    UNIQUE(academic_year_id, semester_number)
);

CREATE TABLE classes (
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

CREATE TABLE sections (
    id SERIAL PRIMARY KEY,
    class_id INT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    name VARCHAR(20) NOT NULL,
    student_count INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE(class_id, name)
);

CREATE TABLE subjects (
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

CREATE TABLE teacher_subjects (
    teacher_id INT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    subject_id INT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    PRIMARY KEY(teacher_id, subject_id)
);

CREATE TABLE class_subjects (
    class_id INT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    subject_id INT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    teacher_id INT REFERENCES teachers(id) ON DELETE SET NULL,
    weekly_periods INT DEFAULT 3,
    PRIMARY KEY(class_id, subject_id)
);

CREATE TABLE buildings (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    code VARCHAR(30)
);

CREATE TABLE rooms (
    id SERIAL PRIMARY KEY,
    room_number VARCHAR(50) UNIQUE NOT NULL,
    building_id INT REFERENCES buildings(id) ON DELETE SET NULL,
    capacity INT NOT NULL DEFAULT 30,
    room_type VARCHAR(50) DEFAULT 'Lecture Hall',
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE time_slots (
    id SERIAL PRIMARY KEY,
    slot_code VARCHAR(20) UNIQUE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    label VARCHAR(50) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE teacher_availability (
    id SERIAL PRIMARY KEY,
    teacher_id INT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    day_of_week VARCHAR(15) NOT NULL,
    time_slot_id INT NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
    available BOOLEAN DEFAULT TRUE,
    UNIQUE(teacher_id, day_of_week, time_slot_id)
);

CREATE TABLE room_availability (
    id SERIAL PRIMARY KEY,
    room_id INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    day_of_week VARCHAR(15) NOT NULL,
    time_slot_id INT NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
    available BOOLEAN DEFAULT TRUE,
    UNIQUE(room_id, day_of_week, time_slot_id)
);

CREATE TABLE timetable (
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

    created_by INT REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE announcements (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(250) NOT NULL,
    description TEXT,
    priority VARCHAR(20) DEFAULT 'Medium',
    created_by INT REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE notifications (
    id BIGSERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    type VARCHAR(30) DEFAULT 'info',
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audit_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,
    entity VARCHAR(100),
    entity_id VARCHAR(100),
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE teacher_absences (
    id BIGSERIAL PRIMARY KEY,
    teacher_id INT NOT NULL REFERENCES teachers(id),
    absence_date DATE NOT NULL,
    reason TEXT,
    created_by INT REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE substitute_assignments (
    id BIGSERIAL PRIMARY KEY,
    absence_id BIGINT REFERENCES teacher_absences(id) ON DELETE CASCADE,
    timetable_id BIGINT REFERENCES timetable(id) ON DELETE CASCADE,
    substitute_teacher_id INT REFERENCES teachers(id),
    created_by INT REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_teachers_department
ON teachers(department_id);

CREATE INDEX idx_classes_program
ON classes(program_id);

CREATE INDEX idx_classes_department
ON classes(department_id);

CREATE INDEX idx_subjects_department
ON subjects(department_id);

CREATE INDEX idx_rooms_building
ON rooms(building_id);

CREATE INDEX idx_timetable_teacher_day_slot
ON timetable(teacher_id, day_of_week, time_slot_id);

CREATE INDEX idx_timetable_room_day_slot
ON timetable(room_id, day_of_week, time_slot_id);

CREATE INDEX idx_timetable_class_day_slot
ON timetable(class_id, day_of_week, time_slot_id);

CREATE INDEX idx_timetable_section_day_slot
ON timetable(section_id, day_of_week, time_slot_id);

CREATE INDEX idx_notifications_user_read
ON notifications(user_id, is_read);

CREATE INDEX idx_audit_entity
ON audit_logs(entity, entity_id);

INSERT INTO time_slots
(slot_code, start_time, end_time, label)
VALUES
('s1', '09:00', '10:00', '9:00 - 10:00'),
('s2', '10:00', '11:00', '10:00 - 11:00'),
('s3', '11:00', '12:00', '11:00 - 12:00'),
('s4', '12:00', '13:00', '12:00 - 1:00'),
('s5', '14:00', '15:00', '2:00 - 3:00'),
('s6', '15:00', '16:00', '3:00 - 4:00'),
('s7', '16:00', '17:00', '4:00 - 5:00');

INSERT INTO programs
(code, name, degree_level, duration_years)
VALUES
('BTECH', 'Bachelor of Technology', 'Undergraduate', 4),
('MTECH', 'Master of Technology', 'Postgraduate', 2),
('BBA', 'Bachelor of Business Administration', 'Undergraduate', 3),
('MBA', 'Master of Business Administration', 'Postgraduate', 2),
('BCA', 'Bachelor of Computer Applications', 'Undergraduate', 3),
('MCA', 'Master of Computer Applications', 'Postgraduate', 2),
('BA', 'Bachelor of Arts', 'Undergraduate', 3),
('MA', 'Master of Arts', 'Postgraduate', 2),
('PHD', 'Doctor of Philosophy', 'Doctoral', 5);