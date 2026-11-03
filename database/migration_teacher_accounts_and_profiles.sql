-- Migration: Activate User Profile, Teacher Accounts & Role-Based Security
BEGIN;

-- 1. Extend users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS department_id INT REFERENCES departments(id) ON DELETE SET NULL;

-- Standardize roles to uppercase for existing users
UPDATE users SET role = UPPER(role) WHERE role IS NOT NULL;

-- 2. Extend teachers table
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS email VARCHAR(200);

-- Enforce 1-to-1 unique mapping between teacher and user account
CREATE UNIQUE INDEX IF NOT EXISTS idx_teachers_user_id ON teachers(user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_teachers_email ON teachers(LOWER(email)) WHERE email IS NOT NULL;

-- 3. Create timetable_change_requests table for teacher change / absence / makeup workflows
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

CREATE INDEX IF NOT EXISTS idx_change_requests_teacher ON timetable_change_requests(teacher_id);
CREATE INDEX IF NOT EXISTS idx_change_requests_status ON timetable_change_requests(status);

-- 4. Ensure demo administrator has full profile info
UPDATE users 
SET 
    full_name = 'University Administrator',
    department_id = (SELECT id FROM departments ORDER BY id LIMIT 1),
    phone = '+1 (555) 019-2834',
    last_login = NOW()
WHERE email = 'admin@brightfield.edu';

-- 5. Create default demo teacher account linked to Teacher 1 (FAC-0001, Faculty 1)
-- password: teacher123 (bcrypt hash: $2a$12$N7xVbU3/bQh9xHqY6ZvxduQ1V6xW7CqJ3f0N8g0h2kP3zP8zP8zP.)
-- We will use node to generate a valid bcrypt hash for 'teacher123' if not exists

COMMIT;
