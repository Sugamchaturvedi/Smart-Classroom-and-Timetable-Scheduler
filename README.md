# Smart Classroom and Timetable Scheduler

A full-stack university timetable management and scheduling system built with **HTML, CSS, Vanilla JavaScript, Node.js, Express.js, and PostgreSQL**.

The system manages university academic resources, creates and edits timetables, detects scheduling conflicts, and automatically generates timetables while storing data centrally in PostgreSQL.

## Features

- Full-stack university timetable management
- PostgreSQL-backed persistent data
- JWT authentication and bcrypt password hashing
- Teacher, class, section, subject, room, and program management
- Timetable create, update, view, and delete operations
- Teacher conflict detection
- Classroom/room conflict detection
- Class and section conflict detection
- Teacher and room availability validation
- Room capacity validation
- Automatic timetable generation
- Multiple-room distribution
- Searchable subject and teacher selection
- Unplaced-period reporting
- Analytics API
- Responsive frontend
- PWA files with manifest and service worker
- Modular Express routes and controllers

## Technology Stack

### Frontend
- HTML5
- CSS3
- Vanilla JavaScript
- Responsive UI
- PWA manifest and service worker

### Backend
- Node.js
- Express.js
- REST API
- CORS
- dotenv
- bcryptjs
- JSON Web Token

### Database
- PostgreSQL

### Development
- Visual Studio Code
- Git
- GitHub
- PowerShell

## Architecture

```text
Frontend
HTML + CSS + JavaScript
        |
        | REST API
        v
Node.js + Express
        |
        +-- Authentication
        +-- Timetable API
        +-- Scheduler API
        +-- Resource APIs
        +-- Analytics API
        +-- Conflict Detection
        |
        v
PostgreSQL
        |
        +-- Programs
        +-- Departments
        +-- Teachers
        +-- Students
        +-- Classes
        +-- Sections
        +-- Subjects
        +-- Rooms
        +-- Time Slots
        +-- Timetable
        +-- Availability
        +-- Notifications
        +-- Audit Logs
        +-- Absences / Substitutes
```

## Project Structure

```text
Smart Classroom and Timetable Scheduler/
|
+-- backend/
|   +-- controllers/
|   |   +-- analyticsController.js
|   |   +-- authController.js
|   |   +-- schedulerController.js
|   |   +-- sectionController.js
|   |   +-- timetableController.js
|   |
|   +-- middleware/
|   |   +-- auth.js
|   |
|   +-- routes/
|   |   +-- analytics.js
|   |   +-- auth.js
|   |   +-- classes.js
|   |   +-- programs.js
|   |   +-- rooms.js
|   |   +-- scheduler.js
|   |   +-- sections.js
|   |   +-- subjects.js
|   |   +-- teachers.js
|   |   +-- timetable.js
|   |
|   +-- .env
|   +-- .gitignore
|   +-- db.js
|   +-- package.json
|   +-- package-lock.json
|   +-- server.js
|
+-- database/
|   +-- schema.sql
|   +-- seed.sql
|
+-- frontend/
|   +-- index.html
|   +-- manifest.json
|   +-- README.md
|   +-- script.js
|   +-- service-worker.js
|   +-- style.css
|
+-- .gitignore
+-- package.json
+-- package-lock.json
```

`backend/.env` and `node_modules` are intentionally excluded from GitHub.

## Database

The database contains tables for:

- Programs
- Departments
- Users
- Teachers
- Students
- Classes
- Sections
- Subjects
- Teacher-subject relationships
- Class-subject relationships
- Buildings
- Rooms
- Time slots
- Teacher availability
- Room availability
- Timetable
- Announcements
- Notifications
- Audit logs
- Teacher absences
- Substitute assignments

The development seed contains large academic datasets for testing university-scale scheduling.

## Conflict Detection

Conflict detection is a core part of timetable creation and updating.

```text
Class
Section
Subject
Teacher
Room
Day
Time Slot
   |
   v
Conflict Validation
   |
   +-- Teacher conflict?
   +-- Room conflict?
   +-- Class conflict?
   +-- Section conflict?
   +-- Teacher unavailable?
   +-- Room unavailable?
   +-- Room capacity insufficient?
   |
   v
Valid --> Save to PostgreSQL
Conflict --> Reject with warning
```

The backend performs these checks before saving a timetable entry.

## Automatic Timetable Scheduler

The scheduler attempts to assign selected subjects to available combinations of:

```text
Teacher + Room + Day + Time Slot
```

It:

- checks scheduling conflicts
- assigns teachers
- distributes entries across selected rooms
- uses multiple days and time slots
- reports periods that could not be placed
- avoids creating thousands of unnecessary teacher dropdown elements
- supports large datasets more efficiently in the browser

## API

The backend runs by default at:

```text
http://localhost:5000
```

### Health

```http
GET /api/health
```

### Authentication

```http
POST /api/auth/login
```

### Resources

```http
GET /api/programs
GET /api/teachers
GET /api/classes
GET /api/subjects
GET /api/rooms
GET /api/sections?class_id=<class_id>
```

### Timetable

```http
GET    /api/timetable
POST   /api/timetable
PUT    /api/timetable/:id
DELETE /api/timetable/:id
```

### Scheduler

```http
/api/scheduler
```

### Analytics

```http
/api/analytics
```

Protected endpoints use:

```http
Authorization: Bearer <JWT_TOKEN>
```

## Installation

### Prerequisites

Install:

- Node.js
- PostgreSQL
- Git
- Visual Studio Code

### Clone

```powershell
git clone https://github.com/Sugamchaturvedi/Smart-Classroom-and-Timetable-Scheduler.git
cd "Smart Classroom and Timetable Scheduler"
```

### Install root dependencies

```powershell
npm install
```

### Install backend dependencies

```powershell
cd backend
npm install
cd ..
```

### Create the database

Create a PostgreSQL database named:

```text
university_timetable
```

Run:

```text
database/schema.sql
database/seed.sql
```

using PostgreSQL.

### Environment configuration

Create:

```text
backend/.env
```

Example:

```env
PORT=5000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=university_timetable
DB_USER=postgres
DB_PASSWORD=YOUR_POSTGRES_PASSWORD
JWT_SECRET=YOUR_SECRET_KEY
```

Never commit `.env` to GitHub.

## Run the Backend

Open PowerShell:

```powershell
cd "C:\Users\sugam chaturvedi\OneDrive\Desktop\Smart Classroom and Timetable Scheduler\backend"
npm run dev
```

The API should run at:

```text
http://localhost:5000
```

Test:

```text
http://localhost:5000/api/health
```

## Run the Frontend

Open the `frontend` directory with Visual Studio Code and run `index.html` through a local development server such as Live Server.

The frontend communicates with the Express API running on port `5000`.

## Security

- Passwords are hashed using bcrypt.
- JWT is used for API authentication.
- Protected API routes require authentication.
- Database credentials are stored in `.env`.
- `.env` is ignored by Git.
- `node_modules` is ignored by Git.

For production, HTTPS, secure secret management, rate limiting, stronger access control, and production database configuration should be added.

## Scalability

The architecture is designed for university-wide scheduling rather than a single-browser demo.

It supports large collections of:

- Teachers
- Classes
- Sections
- Subjects
- Rooms
- Timetable entries
- Academic programs

PostgreSQL provides centralized persistent storage, while the Express API separates the frontend from the database.

## Git Development History

The project was organized into meaningful development milestones:

```text
Initialize full-stack project structure
Add PostgreSQL database schema and seed data
Add backend API and authentication
Add timetable management and conflict detection
Add automatic timetable scheduler
Add analytics and university resource management
```

## Future Enhancements

Possible future improvements:

- Student timetable view
- Teacher personal timetable
- Drag-and-drop timetable editing
- Timetable health score
- Free-room finder
- Substitute teacher recommendations
- Calendar/ICS export
- Advanced notifications
- Audit trail UI
- Advanced role-based access control
- Automated testing
- CI/CD
- Cloud deployment

## Project Objective

The goal is to provide a centralized university timetable platform that can:

1. Manage academic resources.
2. Store timetable data centrally.
3. Detect scheduling conflicts.
4. Generate timetables automatically.
5. Distribute classroom resources.
6. Provide scheduling analytics.
7. Support a scalable university-wide architecture.

## Author

**Sugam Chaturvedi**

B.Tech Computer Science and Engineering

GitHub: https://github.com/Sugamchaturvedi

Project: https://github.com/Sugamchaturvedi/Smart-Classroom-and-Timetable-Scheduler

## License

This project is intended for educational and academic purposes.
