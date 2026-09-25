# Smart Classroom & Timetable Scheduler

A complete, front-end-only college timetable scheduling system built with **HTML5, CSS3 and Vanilla JavaScript (ES6+)** — no frameworks, no backend, no build step.

## 1. How to run it

1. Keep `index.html`, `style.css`, and `script.js` in the **same folder**.
2. Double-click `index.html` (or right-click → Open with → your browser).
3. That's it — the app runs entirely client-side. No server, npm install, or internet connection is required (the Google Fonts link is optional and fails gracefully offline).

## 2. Demo login credentials

| Role | Email | Password |
|---|---|---|
| Administrator | `admin@brightfield.edu` | `admin123` |
| Teacher | `teacher@brightfield.edu` | `teacher123` |

Click **"Use demo login"** on the login page to auto-fill the admin credentials, or check **"Remember me"** to stay logged in across browser sessions (via `localStorage`).

## 3. Main features

- **Dashboard** — live counts of classes, teachers, rooms, subjects, today's classes, conflicts, and an upcoming-classes feed, plus a **Timetable Health Score**.
- **Timetable Management** — a Monday–Saturday × 7-slot grid. Add/edit/delete entries inline, search, filter by class/teacher/room/day, and **drag any class card onto a new day/slot** to reschedule it instantly.
- **Smart Conflict Detection** — every save (and every drag-and-drop move) is checked for teacher, room, and class double-bookings before it's written to storage (see §4).
- **Automatic Timetable Generator** — pick a class, its subjects/teachers, available rooms, and periods-per-day; the engine proposes a clash-free layout (see §5).
- **Classes, Teachers, Subjects, Classrooms** — full CRUD with search/filter, validation, and (for teachers) availability by day/slot.
- **Calendar View** — week-by-week visual grid with previous/today/next navigation and today's column highlighted.
- **Analytics** — pure-CSS bar charts for teacher workload, classes/day, subject distribution, room utilisation, free-room counts, and a conflict summary.
- **Announcements & Notifications** — admin broadcasts with priority levels; a notification feed with unread badges in the sidebar and top bar.
- **Export / Print** — "Print Timetable" uses the browser's native print dialog; "Export CSV" and "Export to Calendar (.ics)" build files client-side and download them — no server involved.
- **Light / Dark mode** — toggle in the top bar or Settings page; the choice is remembered in `localStorage`.

### What makes this build different from a standard UMS clone

| Feature | What it does | Where to find it |
|---|---|---|
| 🩺 **Timetable Health Score** | A single 0–100 score blending conflict-free rate, teacher workload balance, room-usage balance, and schedule compactness, plus 2–4 plain-English suggestions (e.g. "move X to close a gap"). | Dashboard, top card |
| 🔎 **"Ask the Scheduler" smart search** | A small rule-based natural-language parser in the header search box. Try `free rooms Monday 10am`, a teacher's name, `conflicts`, `<teacher> workload`, a room number, or a class name — it answers directly instead of just listing keyword matches. | Header search bar |
| 🖱 **Drag-and-drop rescheduling** | Grab any class card on the Timetable grid and drag it to a new day/slot. The target cell highlights **blue** if the move is clash-free or **red** if it would clash — before you even drop it. | Timetable page |
| 🔁 **Substitute teacher finder** | Report a teacher absent for a day; for each of their affected periods it lists other teachers who teach that subject (or department), are free at that exact slot, and match their declared availability — one click assigns the cover. | Teachers → "🩺 Report Absence" |
| 📅 **Calendar export (.ics)** | Generates a real iCalendar file with weekly-recurring events, ready to import into Google Calendar or Outlook — not just CSV/print. | Timetable → "📅 Export to Calendar" |
| 📴 **Installable, offline-capable app (PWA)** | A web app manifest + service worker cache the app shell so it can be "installed" and keep working without a connection. *(Only active when served over http/https — see note below; it's inert when opened as a plain `file://` page.)* | Automatic — install prompt appears when hosted |
| 🕘 **Audit log** | Every create, edit, delete, override, generated-timetable save, and substitute assignment is time-stamped and recorded — "who changed what, and when." | Sidebar → "Audit Log" |
| ⌘K **Command palette** | Press `Ctrl/Cmd + K` (or click the ⌘K button) for a searchable list of every page and quick action — add a teacher, export the timetable, toggle dark mode, and more, all from the keyboard. | Anywhere in the app |

**Note on the offline/installable feature:** service workers are a browser security feature that only activate on `http://` or `https://` origins — never on a plain double-clicked `file://` page. To actually see the "Install app" prompt and try working offline, serve the folder with any static server, e.g.:
```
python -m http.server 8000
```
then open `http://localhost:8000` in your browser. Everything else in the app works identically either way.



## 4. How conflict detection works

Every timetable entry has a `day`, `slotId`, `classId`, `teacherId`, and `roomId`. Before an entry is saved (whether added manually or edited), `findConflicts()` scans all *other* entries sharing the same `day` + `slotId` and checks three rules:

1. **Teacher conflict** — same `teacherId` already booked in that slot for a different class.
2. **Room conflict** — same `roomId` already booked in that slot for a different class.
3. **Class conflict** — the same `classId` already has a subject in that slot (a class can't be in two places at once).

If any rule fires, a **"⚠ Scheduling Conflict Detected"** dialog lists exactly what clashes and with what. The user can **Cancel** (go back and change the slot/room/teacher) or **Override & Save**, which persists the entry anyway and flags it. Overridden/conflicting entries are also highlighted in red directly on the timetable grid, and the Dashboard and Analytics pages both surface a live conflict count so nothing is ever silently broken.

## 5. How the timetable generator works

The generator (`generateTimetableFor`) takes a class, a list of `{subject, teacher, weekly periods}` requests, a pool of candidate rooms, and a max-periods-per-day limit. It:

1. Builds the pool of valid `(day, slot)` combinations allowed by the periods-per-day limit.
2. Expands the subject list into individual "periods to place" (e.g. a 4-period subject becomes four jobs).
3. Runs up to 25 randomized attempts: each attempt shuffles the job order and, for every job, shuffles the candidate slots and greedily places the job in the first slot where the class is free, the teacher is free (checked against both existing timetable data *and* what's been placed so far this attempt), and at least one candidate room is free.
4. Keeps the attempt with the fewest unplaced periods (this is the "backtracking-lite" part — random restarts stand in for full backtracking while staying simple, fast, and dependency-free).
5. If every period was placed, you get a fully clash-free timetable. If some couldn't be placed, the UI clearly lists which subject/periods failed and shows: *"Unable to schedule all classes. Please modify available rooms/teachers/time slots."*

Nothing is written to storage until you click **"Save generated timetable"** — you can review or discard the proposal first.

## 6. How localStorage is used

All application state lives in the browser's `localStorage` under namespaced keys (`sct_teachers`, `sct_subjects`, `sct_rooms`, `sct_classes`, `sct_timetable`, `sct_announcements`, `sct_notifications`, `sct_audit`, `sct_theme`, `sct_auth`, `sct_profile`). A thin `Store` wrapper handles JSON encode/decode with try/catch guards. On first load, if no data is found, realistic demo data is seeded automatically (8 teachers, 8 subjects, 6 rooms, 4 class sections, 26 timetable entries, announcements and notifications). Refreshing the page — or closing and reopening the browser — keeps everything exactly as you left it, since it's all read back from `localStorage` on load. Settings → "Reset to demo data" wipes and reseeds everything if you want a clean slate.

## 7. Project structure

```
index.html          Semantic HTML5 structure: login page, sidebar/topbar app
                     shell, one <section> per feature area, reusable <dialog>
                     modals (form, confirm, conflict, substitute finder), and
                     the command-palette overlay.
style.css            CSS variables for light/dark theming, Flexbox + Grid
                     layout, responsive breakpoints, animations/transitions,
                     and component styling (cards, tables, charts, toasts,
                     modals, drag-and-drop highlights, health gauge).
script.js            Vanilla JS, organised into clearly commented modules:
                     Storage → Demo data → Toasts → Modals → Auth → Router →
                     per-page renderers → Conflict engine → Drag-and-drop →
                     Generator → Substitute finder → Ask-the-Scheduler smart
                     search → Health score → Audit log → Command palette →
                     Theme → PWA registration → Init.
manifest.json        Web app manifest (name, icons, theme colour) for the
                     installable/offline experience.
service-worker.js    Cache-first service worker for the app shell; only
                     active when served over http/https (see note above).
```

## 8. Notes

- Everything runs and persists locally; no data ever leaves the browser.
- Tested layout breakpoints: desktop, laptop, tablet (≤900px collapses the sidebar into a slide-out drawer), and mobile (≤480px stacks stat cards to a single column).
- Every visible button performs a real action — there are no placeholder/do-nothing controls.
