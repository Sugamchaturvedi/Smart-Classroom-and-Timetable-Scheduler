INSERT INTO academic_years
(name, start_date, end_date, is_current)
VALUES
('2026-27', '2026-07-01', '2027-06-30', TRUE)
ON CONFLICT (name) DO NOTHING;

INSERT INTO semesters
(academic_year_id, semester_number, name)
SELECT
    id,
    1,
    'Semester 1'
FROM academic_years
WHERE name = '2026-27'
ON CONFLICT DO NOTHING;

INSERT INTO departments
(code, name, program_id)
SELECT
    p.code || '_CS',
    p.name || ' - Computer Science',
    p.id
FROM programs p
ON CONFLICT (code) DO NOTHING;

INSERT INTO departments
(code, name, program_id)
SELECT
    p.code || '_MGMT',
    p.name || ' - Management',
    p.id
FROM programs p
WHERE p.code IN ('BBA', 'MBA')
ON CONFLICT (code) DO NOTHING;

INSERT INTO departments
(code, name, program_id)
SELECT
    p.code || '_ARTS',
    p.name || ' - Arts',
    p.id
FROM programs p
WHERE p.code IN ('BA', 'MA')
ON CONFLICT (code) DO NOTHING;

INSERT INTO buildings
(name, code)
VALUES
('Main Block', 'MB'),
('Technology Block', 'TB'),
('Management Block', 'MG'),
('Research Block', 'RB')
ON CONFLICT (name) DO NOTHING;

INSERT INTO rooms
(room_number, building_id, capacity, room_type)
SELECT
    'R-' || LPAD(gs::TEXT, 3, '0'),
    CASE
        WHEN gs <= 250 THEN 1
        WHEN gs <= 500 THEN 2
        WHEN gs <= 750 THEN 3
        ELSE 4
    END,
    CASE
        WHEN gs % 10 = 0 THEN 120
        WHEN gs % 5 = 0 THEN 60
        ELSE 40
    END,
    CASE
        WHEN gs % 10 = 0 THEN 'Seminar Hall'
        WHEN gs % 4 = 0 THEN 'Computer Lab'
        WHEN gs % 3 = 0 THEN 'Laboratory'
        ELSE 'Lecture Hall'
    END
FROM generate_series(1, 500) gs
ON CONFLICT (room_number) DO NOTHING;

INSERT INTO teachers
(teacher_code, full_name, department_id)
SELECT
    'FAC-' || LPAD(gs::TEXT, 4, '0'),
    CASE
        WHEN gs % 5 = 0 THEN 'Dr. Faculty ' || gs
        ELSE 'Faculty ' || gs
    END,
    (
        SELECT id
        FROM departments
        ORDER BY id
        LIMIT 1
        OFFSET ((gs - 1) % (SELECT COUNT(*) FROM departments))
    )
FROM generate_series(1, 1000) gs
ON CONFLICT (teacher_code) DO NOTHING;

INSERT INTO subjects
(code, name, department_id, credits, weekly_periods, subject_type)
SELECT
    'SUB' || LPAD(gs::TEXT, 4, '0'),
    'University Course ' || gs,
    (
        SELECT id
        FROM departments
        ORDER BY id
        LIMIT 1
        OFFSET ((gs - 1) % (SELECT COUNT(*) FROM departments))
    ),
    3,
    CASE
        WHEN gs % 4 = 0 THEN 4
        WHEN gs % 3 = 0 THEN 2
        ELSE 3
    END,
    CASE
        WHEN gs % 5 = 0 THEN 'Laboratory'
        ELSE 'Theory'
    END
FROM generate_series(1, 1000) gs
ON CONFLICT (code) DO NOTHING;

INSERT INTO classes
(class_code, name, program_id, department_id, semester_id, student_count)
SELECT
    'CLS-' || LPAD(gs::TEXT, 4, '0'),
    p.code || ' Class ' || gs,
    p.id,
    (
        SELECT id
        FROM departments
        WHERE program_id = p.id
        ORDER BY id
        LIMIT 1
    ),
    (
        SELECT id
        FROM semesters
        ORDER BY id
        LIMIT 1
    ),
    40 + (gs % 30)
FROM generate_series(1, 1000) gs
CROSS JOIN LATERAL (
    SELECT *
    FROM programs
    ORDER BY id
    LIMIT 1
    OFFSET ((gs - 1) % (SELECT COUNT(*) FROM programs))
) p
ON CONFLICT (class_code) DO NOTHING;

INSERT INTO sections
(class_id, name, student_count)
SELECT
    id,
    'A',
    student_count
FROM classes
ON CONFLICT DO NOTHING;

INSERT INTO sections
(class_id, name, student_count)
SELECT
    id,
    'B',
    GREATEST(student_count - 5, 20)
FROM classes
WHERE id <= 500
ON CONFLICT DO NOTHING;

INSERT INTO teacher_subjects
(teacher_id, subject_id)
SELECT
    t.id,
    s.id
FROM teachers t
JOIN subjects s
ON s.id = ((t.id - 1) % (SELECT COUNT(*) FROM subjects)) + 1
ON CONFLICT DO NOTHING;

INSERT INTO class_subjects
(class_id, subject_id, teacher_id, weekly_periods)
SELECT
    c.id,
    s.id,
    t.id,
    s.weekly_periods
FROM classes c
JOIN LATERAL (
    SELECT *
    FROM subjects
    ORDER BY id
    LIMIT 5
    OFFSET ((c.id - 1) % 100)
) s ON TRUE
JOIN teachers t
ON t.id = ((c.id + s.id - 2) % 1000) + 1
ON CONFLICT DO NOTHING;

INSERT INTO teacher_availability
(teacher_id, day_of_week, time_slot_id, available)
SELECT
    t.id,
    d.day_name,
    ts.id,
    TRUE
FROM teachers t
CROSS JOIN (
    VALUES
    ('Monday'),
    ('Tuesday'),
    ('Wednesday'),
    ('Thursday'),
    ('Friday'),
    ('Saturday')
) d(day_name)
CROSS JOIN time_slots ts
ON CONFLICT DO NOTHING;

INSERT INTO room_availability
(room_id, day_of_week, time_slot_id, available)
SELECT
    r.id,
    d.day_name,
    ts.id,
    TRUE
FROM rooms r
CROSS JOIN (
    VALUES
    ('Monday'),
    ('Tuesday'),
    ('Wednesday'),
    ('Thursday'),
    ('Friday'),
    ('Saturday')
) d(day_name)
CROSS JOIN time_slots ts
ON CONFLICT DO NOTHING;