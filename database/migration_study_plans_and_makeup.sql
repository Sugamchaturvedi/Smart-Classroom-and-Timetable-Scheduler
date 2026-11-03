-- Migration: Add study_plans table, enhance timetable for makeup classes, expand slots and semesters
BEGIN;

-- 1. Create study_plans table
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

CREATE INDEX IF NOT EXISTS idx_study_plans_program ON study_plans(program_id);
CREATE INDEX IF NOT EXISTS idx_study_plans_dept ON study_plans(department_id);
CREATE INDEX IF NOT EXISTS idx_study_plans_sem ON study_plans(semester_number);
CREATE INDEX IF NOT EXISTS idx_study_plans_subject ON study_plans(subject_id);
CREATE INDEX IF NOT EXISTS idx_study_plans_teacher ON study_plans(teacher_id);

-- 2. Enhance timetable table for makeup classes
ALTER TABLE timetable ADD COLUMN IF NOT EXISTS entry_type VARCHAR(30) DEFAULT 'regular';
ALTER TABLE timetable ADD COLUMN IF NOT EXISTS original_timetable_id BIGINT REFERENCES timetable(id) ON DELETE SET NULL;
ALTER TABLE timetable ADD COLUMN IF NOT EXISTS original_date DATE;
ALTER TABLE timetable ADD COLUMN IF NOT EXISTS makeup_reason TEXT;
ALTER TABLE timetable ADD COLUMN IF NOT EXISTS makeup_teacher_id INT REFERENCES teachers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_timetable_entry_type ON timetable(entry_type);
CREATE INDEX IF NOT EXISTS idx_timetable_date ON timetable(timetable_date);
CREATE INDEX IF NOT EXISTS idx_timetable_original ON timetable(original_timetable_id);

-- 3. Expand semesters (2 through 8)
INSERT INTO semesters (academic_year_id, semester_number, name)
VALUES 
    (1, 2, 'Semester 2'),
    (1, 3, 'Semester 3'),
    (1, 4, 'Semester 4'),
    (1, 5, 'Semester 5'),
    (1, 6, 'Semester 6'),
    (1, 7, 'Semester 7'),
    (1, 8, 'Semester 8')
ON CONFLICT DO NOTHING;

-- 4. Expand time_slots
INSERT INTO time_slots (slot_code, start_time, end_time, label)
VALUES 
    ('s0', '08:00', '09:00', '8:00 - 9:00'),
    ('s4b', '13:00', '14:00', '1:00 - 2:00')
ON CONFLICT (slot_code) DO NOTHING;

-- 5. Seed realistic study plans for programs
INSERT INTO study_plans 
(title, program_id, department_id, semester_number, subject_id, teacher_id, academic_year, credits, status, description, objectives, modules)
VALUES
(
    'B.Tech CS - Database Systems & Architecture Plan',
    (SELECT id FROM programs WHERE code = 'BTECH' LIMIT 1),
    (SELECT id FROM departments WHERE code = 'BTECH_CS' LIMIT 1),
    3,
    (SELECT id FROM subjects ORDER BY id LIMIT 1),
    (SELECT id FROM teachers ORDER BY id LIMIT 1),
    '2026-27',
    4,
    'Active',
    'Comprehensive study plan covering relational database design, SQL querying, transaction management, ACID properties, indexing, and NoSQL fundamentals.',
    '1. Understand ER modeling and normal forms (1NF through BCNF).\n2. Master complex SQL queries and index optimization.\n3. Implement ACID transaction isolation levels.\n4. Design scalable schema architectures for high concurrency.',
    '[{"unit": "Unit 1", "title": "Relational Data Models & Normalization", "weeks": 3}, {"unit": "Unit 2", "title": "SQL Deep Dive & Query Optimization", "weeks": 4}, {"unit": "Unit 3", "title": "Transaction Processing & Concurrency Control", "weeks": 3}, {"unit": "Unit 4", "title": "Distributed Databases & NoSQL Storage", "weeks": 4}]'::jsonb
),
(
    'B.Tech CS - Algorithms Design & Complexity Analysis',
    (SELECT id FROM programs WHERE code = 'BTECH' LIMIT 1),
    (SELECT id FROM departments WHERE code = 'BTECH_CS' LIMIT 1),
    4,
    (SELECT id FROM subjects ORDER BY id LIMIT 1 OFFSET 1),
    (SELECT id FROM teachers ORDER BY id LIMIT 1 OFFSET 1),
    '2026-27',
    4,
    'Active',
    'Rigorous curriculum in asymptotic analysis, divide and conquer, greedy methods, dynamic programming, graph algorithms, and NP-completeness.',
    '1. Formulate recurrences and master asymptotic notation.\n2. Design optimal greedy and dynamic programming solutions.\n3. Implement shortest-path and network flow algorithms.\n4. Analyze algorithmic complexity in real-world scenarios.',
    '[{"unit": "Unit 1", "title": "Asymptotic Analysis & Recurrence Relations", "weeks": 3}, {"unit": "Unit 2", "title": "Divide & Conquer and Greedy Paradigms", "weeks": 4}, {"unit": "Unit 3", "title": "Dynamic Programming & Memorization", "weeks": 4}, {"unit": "Unit 4", "title": "Graph Algorithms & NP-Completeness", "weeks": 3}]'::jsonb
),
(
    'M.Tech CS - Advanced Cloud Computing & Distributed Systems',
    (SELECT id FROM programs WHERE code = 'MTECH' LIMIT 1),
    (SELECT id FROM departments WHERE code = 'MTECH_CS' LIMIT 1),
    1,
    (SELECT id FROM subjects ORDER BY id LIMIT 1 OFFSET 2),
    (SELECT id FROM teachers ORDER BY id LIMIT 1 OFFSET 2),
    '2026-27',
    4,
    'Active',
    'Postgraduate research-oriented study plan focusing on consensus protocols (Paxos, Raft), microservices orchestration, Kubernetes, and serverless compute.',
    '1. Evaluate distributed consensus algorithms.\n2. Architect resilient multi-region cloud infrastructures.\n3. Analyze latency vs consistency trade-offs (CAP theorem).',
    '[{"unit": "Unit 1", "title": "Consensus & State Machine Replication", "weeks": 3}, {"unit": "Unit 2", "title": "Distributed Storage Systems", "weeks": 4}, {"unit": "Unit 3", "title": "Container Orchestration & Service Meshes", "weeks": 4}]'::jsonb
),
(
    'BBA - Strategic Financial Management & Valuation',
    (SELECT id FROM programs WHERE code = 'BBA' LIMIT 1),
    (SELECT id FROM departments WHERE code = 'BBA_MGMT' LIMIT 1),
    2,
    (SELECT id FROM subjects ORDER BY id LIMIT 1 OFFSET 3),
    (SELECT id FROM teachers ORDER BY id LIMIT 1 OFFSET 3),
    '2026-27',
    3,
    'Active',
    'Foundational curriculum for corporate valuation, capital budgeting, working capital optimization, and financial statement modeling.',
    '1. Conduct discounted cash flow (DCF) valuations.\n2. Assess risk-adjusted capital costs (WACC).\n3. Prepare managerial finance forecasts.',
    '[{"unit": "Unit 1", "title": "Financial Statement Analysis", "weeks": 4}, {"unit": "Unit 2", "title": "Capital Budgeting & Cost of Capital", "weeks": 4}, {"unit": "Unit 3", "title": "Working Capital & Short-term Financing", "weeks": 4}]'::jsonb
),
(
    'MBA - Executive Leadership & Organizational Strategy',
    (SELECT id FROM programs WHERE code = 'MBA' LIMIT 1),
    (SELECT id FROM departments WHERE code = 'MBA_MGMT' LIMIT 1),
    3,
    (SELECT id FROM subjects ORDER BY id LIMIT 1 OFFSET 4),
    (SELECT id FROM teachers ORDER BY id LIMIT 1 OFFSET 4),
    '2026-27',
    3,
    'Active',
    'Advanced MBA study plan addressing global corporate strategy, organizational change, talent development, and ethical executive governance.',
    '1. Formulate competitive business strategies.\n2. Navigate complex corporate restructurings.\n3. Champion ethical leadership in multicultural environments.',
    '[{"unit": "Unit 1", "title": "Competitive Strategy Formulation", "weeks": 3}, {"unit": "Unit 2", "title": "Organizational Dynamics & Change", "weeks": 4}, {"unit": "Unit 3", "title": "Executive Ethics & Corporate Governance", "weeks": 3}]'::jsonb
),
(
    'BCA - Web Application Architecture & Full-Stack Development',
    (SELECT id FROM programs WHERE code = 'BCA' LIMIT 1),
    (SELECT id FROM departments WHERE code = 'BCA_CS' LIMIT 1),
    2,
    (SELECT id FROM subjects ORDER BY id LIMIT 1 OFFSET 5),
    (SELECT id FROM teachers ORDER BY id LIMIT 1 OFFSET 5),
    '2026-27',
    3,
    'Active',
    'Practical curriculum covering modern HTML5/CSS, asynchronous JavaScript, REST APIs, database integration, and deployment pipelines.',
    '1. Build responsive and accessible client interfaces.\n2. Construct modular REST endpoints with Node.js and Express.\n3. Integrate relational and NoSQL storage layers securely.',
    '[{"unit": "Unit 1", "title": "Modern Frontend Core", "weeks": 4}, {"unit": "Unit 2", "title": "REST API Engineering", "weeks": 4}, {"unit": "Unit 3", "title": "Database Integration & Testing", "weeks": 4}]'::jsonb
),
(
    'MCA - Enterprise Software Engineering & System Design',
    (SELECT id FROM programs WHERE code = 'MCA' LIMIT 1),
    (SELECT id FROM departments WHERE code = 'MCA_CS' LIMIT 1),
    1,
    (SELECT id FROM subjects ORDER BY id LIMIT 1 OFFSET 6),
    (SELECT id FROM teachers ORDER BY id LIMIT 1 OFFSET 6),
    '2026-27',
    4,
    'Active',
    'Enterprise software patterns, UML architectural modeling, CI/CD automation, clean code practices, and large-scale microservice decomposition.',
    '1. Apply Gang of Four design patterns.\n2. Model complex systems using standard UML.\n3. Establish automated testing and continuous integration.',
    '[{"unit": "Unit 1", "title": "Design Patterns & SOLID Principles", "weeks": 4}, {"unit": "Unit 2", "title": "Microservices & Message Queues", "weeks": 4}, {"unit": "Unit 3", "title": "DevOps & CI/CD Pipelines", "weeks": 4}]'::jsonb
),
(
    'BA - Modern Contemporary Literature & Critical Theory',
    (SELECT id FROM programs WHERE code = 'BA' LIMIT 1),
    (SELECT id FROM departments WHERE code = 'BA_ARTS' LIMIT 1),
    1,
    (SELECT id FROM subjects ORDER BY id LIMIT 1 OFFSET 7),
    (SELECT id FROM teachers ORDER BY id LIMIT 1 OFFSET 7),
    '2026-27',
    3,
    'Active',
    'Exploration of 20th and 21st-century literary movements, post-colonial discourse, feminist criticism, and narrative deconstruction.',
    '1. Critically analyze seminal literary works.\n2. Apply modern theoretical frameworks.\n3. Compose academic analytical essays.',
    '[{"unit": "Unit 1", "title": "Modernist Fiction & Poetry", "weeks": 4}, {"unit": "Unit 2", "title": "Postcolonial & Cultural Studies", "weeks": 4}, {"unit": "Unit 3", "title": "Contemporary World Literature", "weeks": 4}]'::jsonb
),
(
    'MA - Advanced Sociological Research Methodologies',
    (SELECT id FROM programs WHERE code = 'MA' LIMIT 1),
    (SELECT id FROM departments WHERE code = 'MA_ARTS' LIMIT 1),
    2,
    (SELECT id FROM subjects ORDER BY id LIMIT 1 OFFSET 8),
    (SELECT id FROM teachers ORDER BY id LIMIT 1 OFFSET 8),
    '2026-27',
    4,
    'Active',
    'Quantitative and qualitative research design, statistical inference, ethnographic fieldwork, and ethical considerations in social science research.',
    '1. Formulate testable sociological hypotheses.\n2. Execute mixed-method empirical investigations.\n3. Analyze qualitative transcripts and survey data.',
    '[{"unit": "Unit 1", "title": "Epistemology & Research Design", "weeks": 3}, {"unit": "Unit 2", "title": "Quantitative Survey & Statistical Analysis", "weeks": 4}, {"unit": "Unit 3", "title": "Qualitative Fieldwork & Ethnography", "weeks": 4}]'::jsonb
),
(
    'PhD - Advanced Doctoral Research Seminar & Dissertation Roadmap',
    (SELECT id FROM programs WHERE code = 'PHD' LIMIT 1),
    (SELECT id FROM departments WHERE code = 'PHD_CS' LIMIT 1),
    1,
    (SELECT id FROM subjects ORDER BY id LIMIT 1 OFFSET 9),
    (SELECT id FROM teachers ORDER BY id LIMIT 1 OFFSET 9),
    '2026-27',
    6,
    'Active',
    'Doctoral level independent research framework, literature synthesis, dissertation proposal formulation, peer review, and academic journal publishing.',
    '1. Synthesize state-of-the-art literature.\n2. Formulate original research contributions.\n3. Prepare manuscripts for peer-reviewed academic journals.',
    '[{"unit": "Unit 1", "title": "Comprehensive Literature Synthesis", "weeks": 6}, {"unit": "Unit 2", "title": "Methodology Defense & Empirical Setup", "weeks": 6}, {"unit": "Unit 3", "title": "Dissertation Drafting & Peer Review", "weeks": 6}]'::jsonb
)
ON CONFLICT DO NOTHING;

COMMIT;
