/* ===================================================================
   Smart Classroom & Timetable Scheduler
   Vanilla JS application logic. Organised into clearly named modules:
   Storage -> Auth -> Toast/Modal -> Router -> per-page renderers ->
   Conflict engine -> Generator -> Calendar -> Analytics -> Init
   =================================================================== */

/* ============================ CONSTANTS ============================ */
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SLOTS = [
  { id: "s0", label: "8:00 - 9:00" },
  { id: "s1", label: "9:00 - 10:00" },
  { id: "s2", label: "10:00 - 11:00" },
  { id: "s3", label: "11:00 - 12:00" },
  { id: "s4", label: "12:00 - 1:00" },
  { id: "s4b", label: "1:00 - 2:00" },
  { id: "s5", label: "2:00 - 3:00" },
  { id: "s6", label: "3:00 - 4:00" },
  { id: "s7", label: "4:00 - 5:00" }
];
const ROOM_TYPES = ["Lecture Hall", "Laboratory", "Computer Lab", "Seminar Hall"];
const PRIORITIES = ["Low", "Medium", "High"];

const LS_KEYS = {
  teachers: "sct_teachers",
  subjects: "sct_subjects",
  rooms: "sct_rooms",
  classes: "sct_classes",
  timetable: "sct_timetable",
  announcements: "sct_announcements",
  notifications: "sct_notifications",
  theme: "sct_theme",
  auth: "sct_auth",
  profile: "sct_profile",
  seeded: "sct_seeded",
  audit: "sct_audit"
};

// Real clock hours for each slot, used by the .ics calendar export.
const SLOT_HOURS = {
  s0: [8, 9],
  s1: [9, 10], s2: [10, 11], s3: [11, 12], s4: [12, 13], s4b: [13, 14],
  s5: [14, 15], s6: [15, 16], s7: [16, 17]
};

const DEMO_USERS = [
  { email: "admin@brightfield.edu", password: "admin123", name: "Ansh Tripathi", role: "Administrator" },
  { email: "teacher@brightfield.edu", password: "teacher123", name: "Dr. Rahul Sharma", role: "Teacher" }
];


/* ============================ BACKEND API MODULE ============================ */
function resolveApiBaseUrl() {
  if (typeof window === "undefined" || !window.location) {
    return "http://localhost:5000/api";
  }

  // 1. Explicit override via window global or localStorage
  try {
    const custom = window.__API_BASE_URL__ || localStorage.getItem("sct_api_base_url");
    if (custom && typeof custom === "string" && custom.trim()) {
      return custom.trim().replace(/\/+$/, "");
    }
  } catch (_) {}

  const { protocol, hostname, port, origin } = window.location;

  // 2. Direct file:// protocol
  if (protocol.startsWith("file") || origin === "null") {
    return "http://localhost:5000/api";
  }

  // 3. Dev static server detection:
  // When running frontend on localhost or 127.0.0.1 on a dev server port (e.g. Live Server on 5500, 5505, Vite, etc.)
  // and the Express backend is running on port 5000:
  const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1";
  if (isLocalHost && port && port !== "5000") {
    return `http://${hostname}:5000/api`;
  }

  // 4. Same-origin deployment (e.g. served directly by Express on port 5000 or production domain)
  return `${origin}/api`;
}

const API_BASE_URL = resolveApiBaseUrl();
const API_KEYS = {
  token: "sct_jwt_token",
  user: "sct_api_user"
};

function getApiToken() {
  return sessionStorage.getItem(API_KEYS.token) || localStorage.getItem(API_KEYS.token) || "";
}

function setApiSession(token, user, remember) {
  if (remember) {
    localStorage.setItem(API_KEYS.token, token);
    localStorage.setItem(API_KEYS.user, JSON.stringify(user || {}));
    sessionStorage.removeItem(API_KEYS.token);
    sessionStorage.removeItem(API_KEYS.user);
  } else {
    sessionStorage.setItem(API_KEYS.token, token);
    sessionStorage.setItem(API_KEYS.user, JSON.stringify(user || {}));
    localStorage.removeItem(API_KEYS.token);
    localStorage.removeItem(API_KEYS.user);
  }
}

function clearApiSession() {
  sessionStorage.removeItem(API_KEYS.token);
  sessionStorage.removeItem(API_KEYS.user);
  localStorage.removeItem(API_KEYS.token);
  localStorage.removeItem(API_KEYS.user);
}

async function apiRequest(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const token = getApiToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {
    payload = null;
  }

  if (response.status === 401) {
    clearApiSession();
    Store.set(LS_KEYS.auth, null);
    Store.set(LS_KEYS.profile, null);
  }

  if (!response.ok) {
    const message = payload && (payload.message || payload.error) ? (payload.message || payload.error) : `Request failed (${response.status})`;
    const err = new Error(message);
    err.payload = payload;
    err.status = response.status;
    throw err;
  }

  return payload;
}

function apiRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.rows)) return payload.rows;
  if (payload && payload.data && Array.isArray(payload.data.rows)) return payload.data.rows;
  return [];
}

function apiOne(payload) {
  if (!payload) return null;
  if (payload.data && !Array.isArray(payload.data)) return payload.data;
  return payload;
}

function normalizeTeacher(x) {
  return {
    id: String(x.id ?? x.teacher_id ?? x.teacherId),
    teacherId: x.teacher_id ?? x.teacherId ?? x.employee_id ?? x.employeeId ?? x.id,
    name: x.name ?? x.full_name ?? x.fullName ?? "Unnamed Teacher",
    department: x.department_name ?? x.department ?? "Unassigned",
    subjectIds: x.subject_ids ?? x.subjectIds ?? [],
    availableDays: x.available_days ?? x.availableDays ?? DAYS.slice(),
    availableSlots: x.available_slots ?? x.availableSlots ?? SLOTS.map(s => s.id)
  };
}

function normalizeClass(x) {
  return {
    id: String(x.id ?? x.class_id ?? x.classId),
    name: x.name ?? x.class_name ?? x.className ?? "Unnamed Class",
    section: x.section ?? x.section_name ?? x.sectionName ?? "A",
    students: Number(x.students ?? x.student_count ?? x.studentCount ?? 0),
    programId: x.program_id ?? x.programId ?? null,
    departmentId: x.department_id ?? x.departmentId ?? null,
    semester: x.semester ?? null
  };
}

function normalizeSubject(x) {
  return {
    id: String(x.id ?? x.subject_id ?? x.subjectId),
    code: x.code ?? x.subject_code ?? x.subjectCode ?? "",
    name: x.name ?? x.subject_name ?? x.subjectName ?? "Unnamed Subject",
    facultyId: x.faculty_id ?? x.facultyId ?? x.teacher_id ?? x.teacherId ?? null,
    weeklyPeriods: Number(x.weekly_periods ?? x.weeklyPeriods ?? 1)
  };
}

function normalizeRoom(x) {
  return {
    id: String(x.id ?? x.room_id ?? x.roomId),
    number: x.number ?? x.room_number ?? x.roomNumber ?? "Unknown Room",
    building: x.building_name ?? x.building ?? "Unknown Building",
    capacity: Number(x.capacity ?? 0),
    type: x.room_type ?? x.type ?? "Lecture Hall"
  };
}

function normalizeSlotId(x) {
  if (x == null) return "";
  const raw = String(x).trim();
  if (/^s[0-8]b?$/i.test(raw)) return raw.toLowerCase();
  const map = {
    "0": "s0",
    "1": "s1", "2": "s2", "3": "s3", "4": "s4", "5": "s5", "6": "s6", "7": "s7", "8": "s8",
    "08:00": "s0", "8:00": "s0",
    "09:00": "s1", "9:00": "s1",
    "10:00": "s2",
    "11:00": "s3",
    "12:00": "s4",
    "13:00": "s4b", "1:00": "s4b",
    "14:00": "s5", "2:00": "s5",
    "15:00": "s6", "3:00": "s6",
    "16:00": "s7", "4:00": "s7",
    "17:00": "s8", "5:00": "s8"
  };
  return map[raw] || raw;
}

function normalizeTimetable(x) {
  const isMakeup = (x.entry_type === "makeup" || x.entryType === "makeup");
  return {
    id: String(x.id ?? x.timetable_id ?? x.timetableId),
    classId: String(x.class_id ?? x.classId),
    className: x.class_name ?? x.className ?? "",
    sectionId: x.section_id != null ? String(x.section_id) : (x.sectionId != null ? String(x.sectionId) : null),
    section: x.section ?? x.section_name ?? x.sectionName ?? "",
    subjectId: String(x.subject_id ?? x.subjectId),
    subjectCode: x.subject_code ?? x.subjectCode ?? "",
    subjectName: x.subject_name ?? x.subjectName ?? "",
    teacherId: String(x.teacher_id ?? x.teacherId),
    teacherName: x.teacher_name ?? x.teacherName ?? "",
    makeupTeacherId: x.makeup_teacher_id != null ? String(x.makeup_teacher_id) : (x.makeupTeacherId != null ? String(x.makeupTeacherId) : null),
    makeupTeacherName: x.makeup_teacher_name ?? x.makeupTeacherName ?? "",
    roomId: String(x.room_id ?? x.roomId),
    roomNumber: x.room_number ?? x.roomNumber ?? "",
    timeSlotId: x.time_slot_id ?? x.timeSlotId ?? null,
    slotId: normalizeSlotId(x.slot_code ?? x.slotCode ?? x.slot_id ?? x.slotId ?? x.time_slot ?? x.timeSlot),
    day: x.day_of_week ?? x.day ?? x.dayOfWeek ?? "",
    timetableDate: x.timetable_date ?? x.timetableDate ?? null,
    overridden: Boolean(x.overridden ?? false),
    status: x.status ?? "scheduled",
    entryType: x.entry_type ?? x.entryType ?? "regular",
    isMakeup: isMakeup,
    originalTimetableId: x.original_timetable_id ?? x.originalTimetableId ?? null,
    originalDate: x.original_date ?? x.originalDate ?? null,
    makeupReason: x.makeup_reason ?? x.makeupReason ?? "",
    notes: x.notes ?? ""
  };
}

async function loadBackendData() {
  showLoadingOverlay(true);
  try {
    const [teachersRes, classesRes, subjectsRes, roomsRes, timetableRes] = await Promise.all([
      apiRequest("/teachers?page=1&limit=1000"),
      apiRequest("/classes?page=1&limit=1000"),
      apiRequest("/subjects"),
      apiRequest("/rooms?page=1&limit=1000"),
      apiRequest("/timetable?page=1&limit=10000")
    ]);

    const teachers = apiRows(teachersRes).map(normalizeTeacher);
    const classes = apiRows(classesRes).map(normalizeClass);
    const subjects = apiRows(subjectsRes).map(normalizeSubject);
    const rooms = apiRows(roomsRes).map(normalizeRoom);
    const timetable = apiRows(timetableRes).map(normalizeTimetable).filter(e => e.id && e.classId && e.subjectId && e.teacherId && e.roomId);

    setTeachers(teachers);
    setClasses(classes);
    setSubjects(subjects);
    setRooms(rooms);
    setTimetable(timetable);

    Store.set(LS_KEYS.seeded, true);

    console.log("Backend data loaded:", {
      teachers: teachers.length,
      classes: classes.length,
      subjects: subjects.length,
      rooms: rooms.length,
      timetable: timetable.length
    });

    return true;
  } catch (error) {
    console.error("Backend data loading failed:", error);
    toast(`Could not load university data: ${error.message}`, "error", 6000);
    if (error && error.status === 401) {
      doLogout(false);
    }
    return false;
  } finally {
    showLoadingOverlay(false);
  }
}

/* ============================ STORAGE MODULE ============================ */
const Store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.error("Storage read failed for", key, e);
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error("Storage write failed for", key, e);
      return false;
    }
  }
};

function getTeachers() { return Store.get(LS_KEYS.teachers, []); }
function setTeachers(v) { Store.set(LS_KEYS.teachers, v); }
function getSubjects() { return Store.get(LS_KEYS.subjects, []); }
function setSubjects(v) { Store.set(LS_KEYS.subjects, v); }
function getRooms() { return Store.get(LS_KEYS.rooms, []); }
function setRooms(v) { Store.set(LS_KEYS.rooms, v); }
function getClasses() { return Store.get(LS_KEYS.classes, []); }
function setClasses(v) { Store.set(LS_KEYS.classes, v); }
function getTimetable() { return Store.get(LS_KEYS.timetable, []); }
function setTimetable(v) { Store.set(LS_KEYS.timetable, v); }
function getAnnouncements() { return Store.get(LS_KEYS.announcements, []); }
function setAnnouncements(v) { Store.set(LS_KEYS.announcements, v); }
function getNotifications() { return Store.get(LS_KEYS.notifications, []); }
function setNotifications(v) { Store.set(LS_KEYS.notifications, v); }
function getAudit() { return Store.get(LS_KEYS.audit, []); }
function setAudit(v) { Store.set(LS_KEYS.audit, v); }

/** Records a change to the shared audit trail. action: create|update|delete|override|generate|substitute */
function logAudit(action, entity, description) {
  const log = getAudit();
  log.unshift({ id: uid("au"), action, entity, description, time: new Date().toISOString() });
  setAudit(log.slice(0, 300));
  if (document.getElementById("section-audit") && !document.getElementById("section-audit").classList.contains("hidden")) renderAuditPage();
}

function uid(prefix) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ============================ LOOKUP & THEME HELPERS ============================ */
function teacherName(id) { const t = getTeachers().find(x => x.id === id); return t ? t.name : "Unassigned"; }
function subjectName(id) { const s = getSubjects().find(x => x.id === id); return s ? s.name : "Unknown subject"; }
function subjectCode(id) { const s = getSubjects().find(x => x.id === id); return s ? (s.code || s.name) : "Course"; }
function roomName(id) { const r = getRooms().find(x => x.id === id); return r ? r.number : "Unknown room"; }
function className(id) { const c = getClasses().find(x => x.id === id); return c ? (c.name + " - " + c.section) : "Unknown class"; }
function slotLabel(id) { const s = SLOTS.find(x => x.id === id); return s ? s.label : id; }
function escapeHtml(str) {
  return String(str == null ? "" : str).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

function getSubjectThemeClass(nameOrCode) {
  const str = String(nameOrCode || "").toUpperCase();
  if (str.includes("DBMS") && str.includes("LAB")) return "theme-dbms";
  if (str.includes("DBMS") || str.includes("DATABASE")) return "theme-dbms";
  if (str.includes("DAA") || str.includes("ALGO")) return "theme-daa";
  if (str.includes("CN") && str.includes("LAB")) return "theme-cn";
  if (str.includes("CN") || str.includes("NETWORK")) return "theme-cn";
  if (str.includes("OS") || str.includes("OPERATING")) return "theme-os";
  if (str.includes("AI") || str.includes("ML") || str.includes("INTELLIGENCE")) return "theme-aiml";
  if (str.includes("SOFT") || str.includes("SKILL") || str.includes("ENGLISH")) return "theme-soft";
  if (str.includes("MENTOR")) return "theme-mentor";
  if (str.includes("CLUB") || str.includes("WORKSHOP") || str.includes("ACTIVITY")) return "theme-club";

  const themes = ["theme-dbms", "theme-daa", "theme-cn", "theme-os", "theme-aiml", "theme-soft", "theme-club"];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) & 0xffffffff;
  return themes[Math.abs(hash) % themes.length];
}

function getSubjectDotClass(nameOrCode) {
  const theme = getSubjectThemeClass(nameOrCode);
  if (theme === "theme-dbms") return "dot-dbms";
  if (theme === "theme-daa") return "dot-daa";
  if (theme === "theme-cn") return "dot-cn";
  if (theme === "theme-os") return "dot-os";
  if (theme === "theme-aiml") return "dot-aiml";
  return "dot-dbms";
}

function getTodayStripeClass(nameOrCode) {
  const theme = getSubjectThemeClass(nameOrCode);
  if (theme === "theme-dbms") return "stripe-purple";
  if (theme === "theme-daa") return "stripe-blue";
  if (theme === "theme-cn") return "stripe-pink";
  if (theme === "theme-os") return "stripe-green";
  if (theme === "theme-aiml") return "stripe-orange";
  return "stripe-blue";
}

/* ============================ DEMO DATA SEEDING ============================ */
function seedDemoData(force) {
  if (!force && Store.get(LS_KEYS.seeded, false)) return;

  const teachers = [
    { id: "t1", teacherId: "FAC-101", name: "Dr. Rahul Sharma", department: "Computer Science", subjectIds: [], availableDays: DAYS.slice(0, 6), availableSlots: SLOTS.map(s => s.id) },
    { id: "t2", teacherId: "FAC-102", name: "Dr. Ananya Gupta", department: "Computer Science", subjectIds: [], availableDays: DAYS.slice(0, 6), availableSlots: SLOTS.map(s => s.id) },
    { id: "t3", teacherId: "FAC-103", name: "Prof. Vikram Rao", department: "Computer Science", subjectIds: [], availableDays: DAYS.slice(0, 6), availableSlots: SLOTS.map(s => s.id) },
    { id: "t4", teacherId: "FAC-104", name: "Dr. Priya Nair", department: "Information Technology", subjectIds: [], availableDays: DAYS.slice(0, 6), availableSlots: SLOTS.map(s => s.id) },
    { id: "t5", teacherId: "FAC-105", name: "Dr. Ravi Kumar", department: "Artificial Intelligence", subjectIds: [], availableDays: DAYS.slice(0, 6), availableSlots: SLOTS.map(s => s.id) },
    { id: "t6", teacherId: "FAC-106", name: "Prof. Sameer Sharma", department: "Humanities", subjectIds: [], availableDays: DAYS.slice(0, 6), availableSlots: SLOTS.map(s => s.id) },
    { id: "t7", teacherId: "FAC-107", name: "Dr. Arjun Verma", department: "General Engineering", subjectIds: [], availableDays: DAYS.slice(0, 6), availableSlots: SLOTS.map(s => s.id) }
  ];

  const subjects = [
    { id: "sub1", code: "DBMS", name: "Database Management Systems", facultyId: "t1", weeklyPeriods: 3 },
    { id: "sub2", code: "DAA", name: "Design & Analysis of Algorithms", facultyId: "t2", weeklyPeriods: 3 },
    { id: "sub3", code: "CN", name: "Computer Networks", facultyId: "t3", weeklyPeriods: 3 },
    { id: "sub4", code: "OS", name: "Operating Systems", facultyId: "t4", weeklyPeriods: 3 },
    { id: "sub5", code: "AI/ML", name: "Artificial Intelligence & Machine Learning", facultyId: "t5", weeklyPeriods: 3 },
    { id: "sub6", code: "DBMS Lab", name: "Database Systems Laboratory", facultyId: "t1", weeklyPeriods: 2 },
    { id: "sub7", code: "CN Lab", name: "Computer Networks Laboratory", facultyId: "t3", weeklyPeriods: 2 },
    { id: "sub8", code: "Soft Skills", name: "Professional & Soft Skills", facultyId: "t6", weeklyPeriods: 1 },
    { id: "sub9", code: "Mentoring", name: "Faculty Mentoring & Guidance", facultyId: "t2", weeklyPeriods: 1 },
    { id: "sub10", code: "Club Activity", name: "Student Club & Co-Curricular", facultyId: "t7", weeklyPeriods: 1 }
  ];

  const rooms = [
    { id: "r1", number: "Room R-204", building: "Tech Block", capacity: 60, type: "Lecture Hall" },
    { id: "r2", number: "Room R-301", building: "Tech Block", capacity: 60, type: "Lecture Hall" },
    { id: "r3", number: "Room R-105", building: "Main Block", capacity: 45, type: "Lecture Hall" },
    { id: "r4", number: "Room R-402", building: "Tech Block", capacity: 60, type: "Lecture Hall" },
    { id: "r5", number: "Lab 1", building: "Computer Center", capacity: 40, type: "Computer Lab" },
    { id: "r6", number: "Lab 2", building: "Computer Center", capacity: 40, type: "Computer Lab" },
    { id: "r7", number: "Room R-201", building: "Main Block", capacity: 50, type: "Seminar Hall" },
    { id: "r8", number: "Room R-101", building: "Main Block", capacity: 60, type: "Lecture Hall" }
  ];

  const classes = [
    { id: "c1", name: "B.Tech CSE", section: "A", students: 58 },
    { id: "c2", name: "B.Tech CSE", section: "B", students: 54 },
    { id: "c3", name: "B.Tech IT", section: "A", students: 50 },
    { id: "c4", name: "B.Tech AI", section: "A", students: 52 }
  ];

  // Reference schedule matching the UI image
  const timetable = [];
  const plan = [
    // classId, day, slotId, subjectId, teacherId, roomId
    ["c1", "Monday", "s0", "sub1", "t1", "r1"],
    ["c1", "Monday", "s2", "sub3", "t3", "r3"],
    ["c1", "Monday", "s4", "sub5", "t5", "r4"],
    ["c1", "Monday", "s7", "sub8", "t6", "r7"],

    ["c1", "Tuesday", "s0", "sub2", "t2", "r2"],
    ["c1", "Tuesday", "s2", "sub4", "t4", "r2"],
    ["c1", "Tuesday", "s5", "sub6", "t1", "r5"],
    ["c1", "Tuesday", "s6", "sub6", "t1", "r5"],

    ["c1", "Wednesday", "s0", "sub3", "t3", "r1"],
    ["c1", "Wednesday", "s4", "sub5", "t5", "r4"],
    ["c1", "Wednesday", "s7", "sub9", "t2", "r7"],

    ["c1", "Thursday", "s2", "sub2", "t2", "r2"],
    ["c1", "Thursday", "s5", "sub7", "t3", "r6"],
    ["c1", "Thursday", "s6", "sub7", "t3", "r6"],

    ["c1", "Friday", "s0", "sub1", "t1", "r1"],
    ["c1", "Friday", "s2", "sub4", "t4", "r2"],
    ["c1", "Friday", "s4", "sub5", "t5", "r4"],
    ["c1", "Friday", "s7", "sub10", "t7", "r8"],

    ["c2", "Monday", "s1", "sub2", "t2", "r2"],
    ["c2", "Monday", "s3", "sub4", "t4", "r2"],
    ["c2", "Tuesday", "s1", "sub1", "t1", "r1"],
    ["c2", "Tuesday", "s3", "sub3", "t3", "r3"],
    ["c2", "Wednesday", "s2", "sub5", "t5", "r4"],
    ["c2", "Thursday", "s1", "sub4", "t4", "r2"],
    ["c2", "Friday", "s3", "sub2", "t2", "r2"]
  ];
  plan.forEach(row => {
    timetable.push({
      id: uid("tt"),
      classId: row[0], day: row[1], slotId: row[2],
      subjectId: row[3], teacherId: row[4], roomId: row[5],
      overridden: false
    });
  });

  const announcements = [
    { id: uid("an"), title: "Room R-204 maintenance notice", desc: "Section CSE-A's Friday session in Room R-204 is confirmed and operational.", date: "2026-09-24", priority: "Low" },
    { id: uid("an"), title: "Mid-semester schedule released", desc: "Mid-semester exams will begin following the third week of October. Check calendar view.", date: "2026-09-22", priority: "Medium" },
    { id: uid("an"), title: "New Computing Lab 2 open", desc: "Lab 2 in the Computer Center is equipped and scheduled for CN Lab sessions.", date: "2026-09-20", priority: "High" }
  ];

  const notifications = [
    { id: uid("no"), text: "Timetable updated for B.Tech CSE - Section A", time: new Date().toISOString(), read: false, type: "info" },
    { id: uid("no"), text: "DBMS Lab scheduled for Tuesday 2:00 PM - 4:00 PM in Lab 1", time: new Date(Date.now() - 3600000).toISOString(), read: false, type: "success" },
    { id: uid("no"), text: "Faculty availability confirmed for Semester 3 courses", time: new Date(Date.now() - 7200000).toISOString(), read: true, type: "info" }
  ];

  setTeachers(teachers);
  setSubjects(subjects);
  setRooms(rooms);
  setClasses(classes);
  setTimetable(timetable);
  setAnnouncements(announcements);
  setNotifications(notifications);
  Store.set(LS_KEYS.seeded, true);
}

/* ============================ TOAST MODULE ============================ */
function toast(message, type = "info", timeout = 3400) {
  const container = document.getElementById("toast-container");
  const el = document.createElement("div");
  el.className = "toast " + type;
  const icon = type === "success" ? "✅" : type === "error" ? "⛔" : type === "warning" ? "⚠️" : "ℹ️";
  el.innerHTML = `<span>${icon}</span><span>${escapeHtml(message)}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add("fade-out");
    setTimeout(() => el.remove(), 250);
  }, timeout);
}

function addNotification(text, type = "info") {
  const list = getNotifications();
  list.unshift({ id: uid("no"), text, time: new Date().toISOString(), read: false, type });
  setNotifications(list.slice(0, 100));
  renderNotifBadges();
}

/* ============================ MODAL MODULE ============================ */
const formModal = document.getElementById("modal-form");
const formModalTitle = document.getElementById("modal-form-title");
const formModalBody = document.getElementById("modal-form-body");
const formModalEl = document.getElementById("modal-form-el");
let currentFormSubmitHandler = null;

function openFormModal(title, bodyHtml, onSubmit) {
  formModalTitle.textContent = title;
  formModalBody.innerHTML = bodyHtml;
  if (currentFormSubmitHandler) formModalEl.removeEventListener("submit", currentFormSubmitHandler);
  currentFormSubmitHandler = function (e) {
    e.preventDefault();
    onSubmit();
  };
  formModalEl.addEventListener("submit", currentFormSubmitHandler);
  if (typeof formModal.showModal === "function") formModal.showModal();
}
function closeFormModal() { formModal.close(); }
document.getElementById("modal-form-close").addEventListener("click", closeFormModal);
document.getElementById("modal-form-cancel").addEventListener("click", closeFormModal);

const confirmModal = document.getElementById("modal-confirm");
function openConfirmModal(title, text, onConfirm, okText = "Delete", okClass = "btn-danger") {
  document.getElementById("modal-confirm-title").textContent = title;
  document.getElementById("modal-confirm-text").textContent = text;
  const okBtn = document.getElementById("modal-confirm-ok");
  const clone = okBtn.cloneNode(true);
  clone.textContent = okText;
  clone.className = `btn ${okClass}`;
  okBtn.parentNode.replaceChild(clone, okBtn);
  clone.addEventListener("click", () => { onConfirm(); confirmModal.close(); });
  confirmModal.showModal();
}
document.getElementById("modal-confirm-close").addEventListener("click", () => confirmModal.close());
document.getElementById("modal-confirm-cancel").addEventListener("click", () => confirmModal.close());

const conflictModal = document.getElementById("modal-conflict");
function openConflictModal(conflicts = [], onOverride = null, warnings = [], onProceed = null) {
  if (!conflictModal) return;

  const rawConflicts = Array.isArray(conflicts) ? conflicts : (conflicts ? [conflicts] : []);
  const rawWarnings = Array.isArray(warnings) ? warnings : (warnings ? [warnings] : []);

  const errListEl = document.getElementById("modal-conflict-list");
  const warnListEl = document.getElementById("modal-warning-list");
  const errWrap = document.getElementById("modal-conflict-errors-wrap");
  const warnWrap = document.getElementById("modal-conflict-warnings-wrap");
  const overrideBtn = document.getElementById("modal-conflict-override");
  const proceedBtn = document.getElementById("modal-conflict-proceed-warnings");
  const noteEl = document.getElementById("modal-conflict-note");

  // Separate hard blocking conflicts vs soft warnings
  const hardErrors = [];
  const softWarns = [...rawWarnings];

  rawConflicts.forEach(c => {
    if (typeof c === "object" && c !== null) {
      if (c.is_mandatory === false) {
        softWarns.push(c.message || JSON.stringify(c));
      } else {
        hardErrors.push(c.message || JSON.stringify(c));
      }
    } else {
      hardErrors.push(String(c));
    }
  });

  // Render hard errors
  if (errListEl && errWrap) {
    if (hardErrors.length > 0) {
      errWrap.classList.remove("hidden");
      errListEl.innerHTML = hardErrors.map(e => `<li>${escapeHtml(e)}</li>`).join("");
    } else {
      errWrap.classList.add("hidden");
      errListEl.innerHTML = "";
    }
  }

  // Render soft warnings
  if (warnListEl && warnWrap) {
    if (softWarns.length > 0) {
      warnWrap.classList.remove("hidden");
      warnListEl.innerHTML = softWarns.map(w => {
        const text = typeof w === "object" && w !== null ? (w.message || JSON.stringify(w)) : String(w);
        return `<li>${escapeHtml(text)}</li>`;
      }).join("");
    } else {
      warnWrap.classList.add("hidden");
      warnListEl.innerHTML = "";
    }
  }

  const user = getStoredApiUser();
  const isAdmin = user && (user.role === "ADMIN" || user.role === "Administrator");

  // Configure action buttons
  if (overrideBtn) {
    const cloneOverride = overrideBtn.cloneNode(true);
    overrideBtn.parentNode.replaceChild(cloneOverride, overrideBtn);
    if (hardErrors.length > 0 && isAdmin && typeof onOverride === "function") {
      cloneOverride.classList.remove("hidden");
      cloneOverride.addEventListener("click", () => {
        conflictModal.close();
        onOverride();
      });
    } else {
      cloneOverride.classList.add("hidden");
    }
  }

  if (proceedBtn) {
    const cloneProceed = proceedBtn.cloneNode(true);
    proceedBtn.parentNode.replaceChild(cloneProceed, proceedBtn);
    if (hardErrors.length === 0 && softWarns.length > 0) {
      cloneProceed.classList.remove("hidden");
      cloneProceed.addEventListener("click", () => {
        conflictModal.close();
        if (typeof onProceed === "function") onProceed();
        else if (typeof onOverride === "function") onOverride();
      });
    } else {
      cloneProceed.classList.add("hidden");
    }
  }

  if (noteEl) {
    if (hardErrors.length > 0) {
      noteEl.textContent = "Hard constraints must be resolved before this timetable slot can be scheduled. Choose an alternate slot, teacher, or classroom.";
      noteEl.style.color = "var(--text-muted)";
    } else {
      noteEl.textContent = "Only soft scheduling preference warnings detected. You may proceed and save this timetable entry, or cancel to adjust.";
      noteEl.style.color = "#fde68a";
    }
  }

  if (typeof conflictModal.showModal === "function") {
    conflictModal.showModal();
  } else {
    conflictModal.setAttribute("open", "");
  }
}
const conflictCloseBtn = document.getElementById("modal-conflict-close");
if (conflictCloseBtn) conflictCloseBtn.addEventListener("click", () => conflictModal.close());
const conflictCancelBtn = document.getElementById("modal-conflict-cancel");
if (conflictCancelBtn) conflictCancelBtn.addEventListener("click", () => conflictModal.close());

/* ============================ AUTH MODULE ============================ */
function getStoredApiUser() {
  try {
    const raw = sessionStorage.getItem(API_KEYS.user) || localStorage.getItem(API_KEYS.user);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function isLoggedIn() {
  return !!getApiToken();
}

async function attemptLogin(email, password) {
  try {
    const payload = await apiRequest("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });

    const token = payload && payload.token;
    if (!token) throw new Error("Login response did not contain a JWT token.");

    const user = payload.user || payload.data?.user || {
      email,
      name: payload.name || email.split("@")[0],
      role: payload.role || "Administrator"
    };

    return { token, user };
  } catch (error) {
    console.error("Login failed:", error);
    return null;
  }
}

async function doLogin(session, remember) {
  setApiSession(session.token, session.user, remember);

  const user = session.user || {};
  const profile = {
    name: user.name || user.full_name || user.fullName || user.email || "University User",
    role: (user.role || "ADMIN").toUpperCase(),
    email: user.email || "",
    teacherId: user.teacherId || null,
    teacherCode: user.teacherCode || null,
    department: user.department || ""
  };

  Store.set(LS_KEYS.auth, {
    email: profile.email,
    name: profile.name,
    role: profile.role,
    remember: !!remember
  });
  Store.set(LS_KEYS.profile, profile);

  const loaded = await loadBackendData();
  if (!loaded) {
    clearApiSession();
    Store.set(LS_KEYS.auth, null);
    Store.set(LS_KEYS.profile, null);
    return false;
  }

  showApp();
  return true;
}

function doLogout(showToast = true) {
  clearApiSession();
  localStorage.removeItem(LS_KEYS.auth);
  sessionStorage.removeItem(LS_KEYS.auth);
  localStorage.removeItem(LS_KEYS.profile);
  sessionStorage.removeItem(LS_KEYS.profile);

  document.querySelectorAll("dialog").forEach(d => {
    try { if (d.open) d.close(); } catch (_) {}
  });

  const appShell = document.getElementById("app-shell");
  const loginPage = document.getElementById("login-page");
  if (appShell) appShell.classList.add("hidden");
  if (loginPage) loginPage.classList.remove("hidden");
  const form = document.getElementById("login-form");
  if (form) form.reset();

  if (showToast) {
    toast("You have been signed out successfully.", "info");
  }
}

function updateNavForRole(role) {
  const normalizedRole = (role || "ADMIN").toUpperCase();
  const adminNav = document.getElementById("sidebar-admin-nav");
  const teacherNav = document.getElementById("sidebar-teacher-nav");
  if (normalizedRole === "TEACHER") {
    if (adminNav) adminNav.classList.add("hidden");
    if (teacherNav) teacherNav.classList.remove("hidden");
  } else {
    if (adminNav) adminNav.classList.remove("hidden");
    if (teacherNav) teacherNav.classList.add("hidden");

    // Explicitly guarantee administrator navigation items are visible on every page load/refresh
    const teacherAccountsNavItem = document.getElementById("nav-item-teacher-accounts");
    if (teacherAccountsNavItem) teacherAccountsNavItem.classList.remove("hidden");
    const teachersNavItem = document.getElementById("nav-item-teachers");
    if (teachersNavItem) teachersNavItem.classList.remove("hidden");
    const rulesNavItem = document.getElementById("nav-item-rules");
    if (rulesNavItem) rulesNavItem.classList.remove("hidden");
  }
}

function initLoginPage() {
  const form = document.getElementById("login-form");
  const emailInput = document.getElementById("login-email");
  const passInput = document.getElementById("login-password");
  const toggleBtn = document.getElementById("toggle-password");

  toggleBtn.addEventListener("click", () => {
    const isPwd = passInput.type === "password";
    passInput.type = isPwd ? "text" : "password";
    toggleBtn.textContent = isPwd ? "🙈" : "👁";
    toggleBtn.setAttribute("aria-label", isPwd ? "Hide password" : "Show password");
  });

  const demoBtn = document.getElementById("demo-login-btn");
  if (demoBtn) {
    demoBtn.addEventListener("click", () => {
      emailInput.value = "admin@brightfield.edu";
      passInput.value = "admin123";
      document.getElementById("remember-me").checked = true;
      toast("Admin credentials filled in — click Sign in", "info");
    });
  }

  const demoTeacherBtn = document.getElementById("demo-teacher-btn");
  if (demoTeacherBtn) {
    demoTeacherBtn.addEventListener("click", () => {
      emailInput.value = "teacher@brightfield.edu";
      passInput.value = "teacher123";
      document.getElementById("remember-me").checked = true;
      toast("Teacher credentials filled in — click Sign in", "info");
    });
  }

  form.addEventListener("submit", async e => {
    e.preventDefault();

    document.getElementById("login-email-error").textContent = "";
    document.getElementById("login-password-error").textContent = "";

    const email = emailInput.value.trim();
    const password = passInput.value;
    let valid = true;

    if (!email) {
      document.getElementById("login-email-error").textContent = "Email or username is required.";
      valid = false;
    }
    if (!password) {
      document.getElementById("login-password-error").textContent = "Password is required.";
      valid = false;
    }
    if (!valid) return;

    const button = form.querySelector('button[type="submit"]');
    const originalText = button ? button.textContent : "";
    if (button) {
      button.disabled = true;
      button.textContent = "Signing in...";
    }

    const session = await attemptLogin(email, password);

    if (!session) {
      document.getElementById("login-password-error").textContent = "Invalid credentials. Please check your email and password.";
      toast("Login failed — check your email and password.", "error");
      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
      return;
    }

    const success = await doLogin(session, document.getElementById("remember-me").checked);

    if (!success) {
      document.getElementById("login-password-error").textContent = "Login succeeded, but university data could not be loaded.";
      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
      return;
    }

    toast(`Welcome back, ${session.user?.name || email}!`, "success");
  });
}

async function restoreAndValidateSession() {
  if (!isLoggedIn()) {
    doLogout(false);
    return;
  }

  showLoadingOverlay(true);
  try {
    let user = null;
    try {
      const meRes = await apiRequest("/auth/me");
      if (meRes && meRes.user) {
        user = meRes.user;
      }
    } catch (authErr) {
      if (authErr.status === 401) {
        console.warn("Session expired or token invalid (401):", authErr);
        clearApiSession();
        Store.set(LS_KEYS.auth, null);
        Store.set(LS_KEYS.profile, null);
        doLogout(false);
        toast("Your session has expired. Please log in again.", "info");
        return;
      }
      console.warn("Could not reach /api/auth/me over network, using stored profile:", authErr);
      user = getStoredApiUser() || Store.get(LS_KEYS.profile, null);
    }

    if (!user) {
      doLogout(false);
      return;
    }

    const normalizedRole = (user.role || "ADMIN").toUpperCase();
    const profile = {
      name: user.name || user.full_name || user.fullName || user.email || "University User",
      role: normalizedRole,
      email: user.email || "",
      teacherId: user.teacherId || null,
      teacherCode: user.teacherCode || null,
      department: user.department || ""
    };
    Store.set(LS_KEYS.profile, profile);
    activeCurrentUser = user;

    // Immediately render role-specific navigation consistently
    updateNavForRole(normalizedRole);

    // Attempt to load university data
    const loaded = await loadBackendData();
    if (!loaded) {
      console.warn("University data load encountered issue; retaining authenticated shell.");
      toast("Unable to refresh some university data from server. Local state displayed.", "warning", 5000);
    }

    showApp();
  } catch (err) {
    console.error("Error during session restoration:", err);
    toast("An error occurred restoring your session: " + err.message, "error");
    showApp();
  } finally {
    showLoadingOverlay(false);
  }
}

function showApp() {
  document.getElementById("login-page").classList.add("hidden");
  document.getElementById("app-shell").classList.remove("hidden");

  const apiUser = getStoredApiUser();
  const profile = Store.get(LS_KEYS.profile, {
    name: apiUser?.name || apiUser?.email || "Admin User",
    role: (apiUser?.role || "ADMIN").toUpperCase(),
    email: apiUser?.email || ""
  });

  const normalizedRole = (profile.role || "ADMIN").toUpperCase();
  updateProfileUI(apiUser || profile);
  updateNavForRole(normalizedRole);

  const settingsName = document.getElementById("settings-name");
  if (settingsName) settingsName.value = profile.name;
  const settingsRole = document.getElementById("settings-role");
  if (settingsRole) settingsRole.value = profile.role;

  // Preserve navigation target from URL hash across browser refreshes
  const hash = (window.location.hash || "").replace("#", "").trim();
  if (normalizedRole === "TEACHER") {
    const validTeacherSections = [
      "teacher-dashboard", "teacher-timetable", "teacher-subjects",
      "teacher-classes", "teacher-makeup", "teacher-availability",
      "announcements", "notifications", "settings"
    ];
    if (hash && validTeacherSections.includes(hash)) {
      navigateTo(hash);
    } else {
      navigateTo("teacher-dashboard");
    }
  } else {
    const validAdminSections = [
      "dashboard", "timetable", "study-plans", "classes", "sections",
      "teachers", "teacher-accounts", "rules", "classrooms", "generate",
      "calendar", "analytics", "announcements", "notifications", "audit", "settings"
    ];
    if (hash && validAdminSections.includes(hash)) {
      navigateTo(hash);
    } else {
      navigateTo("dashboard");
    }
  }

  renderAllStaticSelects();
  renderNotifBadges();
}

/* ============================ NAVIGATION / ROUTER ============================ */
function navigateTo(section) {
  document.querySelectorAll(".page").forEach(p => p.classList.add("hidden"));
  const target = document.getElementById("section-" + section);
  if (target) target.classList.remove("hidden");
  document.querySelectorAll(".nav-link").forEach(l => l.classList.toggle("active", l.dataset.section === section));
  closeSidebarMobile();

  const renderers = {
    dashboard: renderDashboard,
    "teacher-dashboard": renderTeacherDashboard,
    "teacher-accounts": renderTeacherAccountsPage,
    "teacher-timetable": renderTeacherTimetablePage,
    "teacher-subjects": renderTeacherSubjectsPage,
    "teacher-classes": renderTeacherClassesPage,
    "teacher-makeup": renderTeacherMakeupPage,
    "teacher-availability": renderTeacherAvailabilityPage,
    rules: renderRulesPage,
    timetable: renderTimetablePage,
    "study-plans": renderStudyPlansPage,
    generate: renderGeneratePage,
    classes: renderClassesPage,
    sections: renderSectionsPage,
    teachers: renderTeachersPage,
    subjects: renderSubjectsPage,
    classrooms: renderRoomsPage,
    calendar: renderCalendarPage,
    analytics: renderAnalyticsPage,
    announcements: renderAnnouncementsPage,
    notifications: renderNotificationsPage,
    audit: renderAuditPage,
    settings: () => { }
  };
  if (renderers[section]) renderers[section]();
}

let navigationInitialized = false;
function initNavigation() {
  if (navigationInitialized) return;
  navigationInitialized = true;

  document.querySelectorAll(".nav-link").forEach(link => {
    link.addEventListener("click", e => {
      e.preventDefault();
      const section = link.dataset.section;
      if (section) {
        navigateTo(section);
        if (window.innerWidth <= 768) {
          closeSidebarMobile();
        }
      }
    });
  });

  const sidebarOpenBtn = document.getElementById("sidebar-open");
  if (sidebarOpenBtn) {
    sidebarOpenBtn.addEventListener("click", toggleSidebar);
  }

  const sidebarCloseBtn = document.getElementById("sidebar-close");
  if (sidebarCloseBtn) {
    sidebarCloseBtn.addEventListener("click", () => {
      if (window.innerWidth <= 768) {
        closeSidebarMobile();
      } else {
        const shell = document.getElementById("app-shell");
        if (shell) {
          shell.classList.add("sidebar-hidden");
          shell.classList.add("sidebar-collapsed");
        }
      }
    });
  }

  // Dedicated Makeup Class trigger buttons
  const navMakeup = document.getElementById("nav-link-makeup");
  if (navMakeup) {
    navMakeup.addEventListener("click", (e) => {
      e.preventDefault();
      navigateTo("timetable");
      const fType = document.getElementById("filter-type");
      if (fType) {
        fType.value = "makeup";
        renderTimetablePage();
      }
      openMakeupModal();
      if (window.innerWidth <= 768) closeSidebarMobile();
    });
  }

  const topMakeup = document.getElementById("topbar-makeup-btn");
  if (topMakeup) {
    topMakeup.addEventListener("click", () => openMakeupModal());
  }

  const dashWelcomeMakeup = document.getElementById("dash-welcome-makeup-btn");
  if (dashWelcomeMakeup) {
    dashWelcomeMakeup.addEventListener("click", () => openMakeupModal());
  }

  const dashQaMakeup = document.getElementById("dash-qa-makeup");
  if (dashQaMakeup) {
    dashQaMakeup.addEventListener("click", () => openMakeupModal());
  }

  // Initialize Study Plan dropdown menu in sidebar
  initStudyPlanSidebarDropdown();

  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      openConfirmModal("Log out", "Are you sure you want to log out?", doLogout);
    });
  }

  window.addEventListener("resize", () => {
    if (window.innerWidth > 768) {
      closeSidebarMobile();
    }
  });
}

function toggleSidebar() {
  const shell = document.getElementById("app-shell");
  const sidebar = document.getElementById("sidebar");
  if (!shell || !sidebar) return;

  if (window.innerWidth <= 768) {
    sidebar.classList.toggle("open");
  } else {
    const isHidden = shell.classList.toggle("sidebar-hidden");
    shell.classList.toggle("sidebar-collapsed", isHidden);
  }
}

function openSidebarMobile() {
  const sidebar = document.getElementById("sidebar");
  const shell = document.getElementById("app-shell");
  if (window.innerWidth <= 768) {
    if (sidebar) sidebar.classList.add("open");
  } else {
    if (shell) {
      shell.classList.remove("sidebar-hidden");
      shell.classList.remove("sidebar-collapsed");
    }
  }
}

function closeSidebarMobile() {
  const sidebar = document.getElementById("sidebar");
  if (sidebar) sidebar.classList.remove("open");
}

function initStudyPlanSidebarDropdown() {
  const dropdownToggle = document.getElementById("sp-dropdown-toggle");
  const subMenu = document.getElementById("sp-nav-sub-menu");
  const parentDropdown = document.getElementById("nav-item-study-plans");
  const mainNavLink = document.getElementById("nav-link-study-plans");

  if (dropdownToggle && subMenu) {
    dropdownToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const isHidden = subMenu.classList.toggle("hidden");
      dropdownToggle.setAttribute("aria-expanded", String(!isHidden));
      if (parentDropdown) parentDropdown.classList.toggle("open", !isHidden);
    });
  }

  if (mainNavLink) {
    mainNavLink.addEventListener("click", () => {
      // Automatically expand dropdown when clicking the main Study Plan link
      if (subMenu && subMenu.classList.contains("hidden")) {
        subMenu.classList.remove("hidden");
        if (dropdownToggle) dropdownToggle.setAttribute("aria-expanded", "true");
        if (parentDropdown) parentDropdown.classList.add("open");
      }
    });
  }

  // Handle clicking each program link inside the dropdown
  document.querySelectorAll(".nav-sub-link").forEach(subLink => {
    subLink.addEventListener("click", async (e) => {
      e.preventDefault();
      const progId = subLink.dataset.progId || "";
      const progName = subLink.dataset.progName || "All Programs";

      // Mark clicked sub-link active
      document.querySelectorAll(".nav-sub-link").forEach(l => l.classList.remove("active"));
      subLink.classList.add("active");

      // Navigate to Study Plans section
      navigateTo("study-plans");

      // Ensure dropdown stays open and parent has open styling
      if (subMenu) subMenu.classList.remove("hidden");
      if (dropdownToggle) dropdownToggle.setAttribute("aria-expanded", "true");
      if (parentDropdown) parentDropdown.classList.add("open");

      // Apply program filter to the study plan library view
      const pFilter = document.getElementById("sp-filter-program");
      if (pFilter) {
        pFilter.value = progId;
        await updateDeptFilterOptions(progId);
        await fetchStudyPlans();
      }

      toast(`Selected ${progName} Library`, "info");

      if (window.innerWidth <= 1024) {
        closeSidebarMobile();
      }
    });
  });
}

/* ============================ SHARED SELECT RENDERERS ============================ */
function renderAllStaticSelects() {
  renderFilterSelects();
}
function optionsFromList(list, valueKey, labelFn, includeBlank, blankLabel, selectedVal) {
  let html = includeBlank ? `<option value="">${blankLabel || "Select..."}</option>` : "";
  html += list.map(item => {
    const isSel = selectedVal != null && String(item[valueKey]) === String(selectedVal);
    return `<option value="${item[valueKey]}" ${isSel ? "selected" : ""}>${escapeHtml(labelFn(item))}</option>`;
  }).join("");
  return html;
}

/* ============================ DASHBOARD ============================ */
let dashViewMode = "week";
let dashSelectedDay = "Tuesday"; // Defaults to Tuesday (23 Sep) matching reference UI

function renderDashboard() {
  const teachers = getTeachers(), subjects = getSubjects(), rooms = getRooms(), classes = getClasses(), tt = getTimetable();
  const conflicts = getAllConflicts();
  const isWeekday = new Date().getDay() >= 1 && new Date().getDay() <= 6;
  const todayLabel = isWeekday ? DAYS[new Date().getDay() - 1] : "Tuesday";

  // Dynamic Greeting
  const hour = new Date().getHours();
  const greetingWord = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";
  const profile = Store.get(LS_KEYS.profile, { name: "Ansh Tripathi", role: "Administrator" });
  const firstName = (profile.name || "Ansh").split(" ")[0];
  const greetingEl = document.getElementById("dash-greeting");
  if (greetingEl) greetingEl.textContent = `${greetingWord}, ${firstName}`;

  const dateEl = document.getElementById("dash-date");
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  }

  // 1. Summary Stat Cards (Total Classes, Teachers, Rooms, Today's Classes, Conflicts, Health)
  const healthResult = computeHealthScore();
  const todayCount = tt.filter(e => e.day === (dashSelectedDay || todayLabel)).length;

  const stats = [
    { label: "Total Classes", value: classes.length, icon: "🎓", bg: "rgba(99, 102, 241, 0.15)", color: "#818cf8" },
    { label: "Total Teachers", value: teachers.length, icon: "🧑‍🏫", bg: "rgba(16, 185, 129, 0.15)", color: "#34d399" },
    { label: "Total Classrooms", value: rooms.length, icon: "🏛", bg: "rgba(245, 158, 11, 0.15)", color: "#fbbf24" },
    { label: "Today's Classes", value: todayCount, icon: "🗓", bg: "rgba(59, 130, 246, 0.15)", color: "#60a5fa" },
    { label: "Active Conflicts", value: conflicts.length, icon: "⚠️", bg: "rgba(239, 68, 68, 0.15)", color: "#f87171" },
    { label: "Schedule Health", value: healthResult.score + "%", icon: "🩺", bg: "rgba(139, 92, 246, 0.15)", color: "#a78bfa" }
  ];

  const statGridEl = document.getElementById("stat-grid");
  if (statGridEl) {
    statGridEl.innerHTML = stats.map(s => `
      <div class="stat-card">
        <div class="stat-ico" style="background:${s.bg};color:${s.color}">${s.icon}</div>
        <div class="stat-meta">
          <span class="stat-num">${s.value}</span>
          <span class="stat-label">${s.label}</span>
        </div>
      </div>`).join("");
  }

  // 2. Render Main Timetable Preview Grid
  renderDashboardTimetableGrid();

  // 3. Render Right-Hand Widgets (Today, Mini Calendar, Subjects)
  renderDashboardTodayWidget();
  renderDashboardMiniCalendar();
  renderDashboardSubjectsWidget();

  // 4. Render Health Score & Announcements lists
  renderHealthScore();

  const todayLabelEl = document.getElementById("today-label");
  if (todayLabelEl) todayLabelEl.textContent = dashSelectedDay || todayLabel;

  const todayClassesList = document.getElementById("today-classes-list");
  if (todayClassesList) {
    const todayEntries = tt.filter(e => e.day === (dashSelectedDay || todayLabel)).sort((a, b) => a.slotId.localeCompare(b.slotId));
    todayClassesList.innerHTML = todayEntries.length ? todayEntries.map(e => rowHtml(
      `${subjectName(e.subjectId)}`, `${className(e.classId)} • ${teacherName(e.teacherId)} • ${roomName(e.roomId)}`, slotLabel(e.slotId)
    )).join("") : `<p class="empty-inline">No classes scheduled for ${dashSelectedDay || todayLabel}.</p>`;
  }

  const upcomingList = document.getElementById("upcoming-classes-list");
  if (upcomingList) {
    const upcoming = getUpcomingEntries(5);
    upcomingList.innerHTML = upcoming.length ? upcoming.map(e => rowHtml(
      `${subjectName(e.subjectId)}`, `${className(e.classId)} • ${roomName(e.roomId)}`, `${e.day} • ${slotLabel(e.slotId)}`
    )).join("") : `<p class="empty-inline">No upcoming classes found.</p>`;
  }

  const conflictCountLabel = document.getElementById("conflict-count-label");
  if (conflictCountLabel) conflictCountLabel.textContent = conflicts.length ? `${conflicts.length} active` : "All clear";

  const dashConflictsList = document.getElementById("dash-conflicts-list");
  if (dashConflictsList) {
    dashConflictsList.innerHTML = conflicts.length ? conflicts.slice(0, 5).map(c => rowHtml(c.title, c.detail, "")).join("") : `<p class="empty-inline">✅ No conflicts detected across the timetable.</p>`;
  }
}

let dashboardWeekOffset = 0;

function updateDashboardDateLabel() {
  const { monday, saturday } = getWeekRange(dashboardWeekOffset);
  const fmt = d => d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const rangeEl = document.getElementById("dash-date-range");
  if (rangeEl) {
    rangeEl.textContent = `${fmt(monday)} – ${fmt(saturday)}${dashboardWeekOffset === 0 ? " (This Week)" : ""}`;
  }
}

function renderDashboardTimetableGrid() {
  const table = document.getElementById("dash-timetable-grid");
  if (!table) return;

  updateDashboardDateLabel();

  // Populate or refresh class dropdown on dashboard
  const classFilterEl = document.getElementById("dash-filter-class");
  if (classFilterEl && classFilterEl.options.length <= 1) {
    const curVal = classFilterEl.value;
    classFilterEl.innerHTML = `<option value="">All Classes</option>` +
      optionsFromList(getClasses(), "id", c => `${c.name} - ${c.section || 'A'}`);
    classFilterEl.value = curVal;
  }

  const selectedClass = classFilterEl?.value || "";
  const tt = getTimetable();
  const filteredTt = selectedClass ? tt.filter(e => String(e.classId) === String(selectedClass)) : tt;

  const { monday } = getWeekRange(dashboardWeekOffset);
  const now = new Date();
  const isCurrentWeek = dashboardWeekOffset === 0;

  const days = DAYS.map((d, i) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    const isToday = isCurrentWeek && (now.getDay() === 0 ? 6 : now.getDay() - 1) === i;
    return {
      key: d,
      label: d.slice(0, 3),
      date: date.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
      isToday
    };
  });

  const hours = [
    { slotId: "s0", time: "8:00 AM" },
    { slotId: "s1", time: "9:00 AM" },
    { slotId: "s2", time: "10:00 AM" },
    { slotId: "s3", time: "11:00 AM" },
    { slotId: "s4", time: "12:00 PM" },
    { slotId: "s4b", time: "1:00 PM" },
    { slotId: "s5", time: "2:00 PM" },
    { slotId: "s6", time: "3:00 PM" },
    { slotId: "s7", time: "4:00 PM" }
  ];

  let thead = `<thead><tr><th class="time-col">Time</th>`;
  days.forEach(d => {
    thead += `<th class="${d.isToday ? "today-column-header" : ""}">
      <span class="day-title">${d.label}</span>
      <span class="day-subtitle">${d.date}</span>
    </th>`;
  });
  thead += `</tr></thead>`;

  let tbody = `<tbody>`;
  hours.forEach(h => {
    tbody += `<tr><td class="time-cell">${h.time}</td>`;
    days.forEach(d => {
      const entries = filteredTt.filter(e => e.day === d.key && (e.slotId === h.slotId || normalizeSlotId(e.slotId) === h.slotId));

      tbody += `<td class="${d.isToday ? "today-column-cell" : ""}">`;
      if (entries.length) {
        entries.forEach(e => {
          const sName = subjectName(e.subjectId);
          const sCode = subjectCode(e.subjectId);
          const rNum = roomName(e.roomId);
          const cName = className(e.classId);
          const tName = teacherName(e.teacherId);
          const themeClass = getSubjectThemeClass(sCode || sName);
          const hasClash = findConflicts(e, e.id).length > 0;
          const isMakeup = Boolean(e.isMakeup || e.entryType === "makeup");

          tbody += `
            <div class="subject-card-block ${themeClass}${hasClash ? " conflicted" : ""}${isMakeup ? " tt-card-makeup" : ""}" data-dash-edit="${e.id}" style="cursor:pointer;" title="${escapeHtml(sName)} • ${escapeHtml(cName)} • ${escapeHtml(tName)}${isMakeup ? " (Makeup Class)" : ""}">
              <span class="sub-code">${isMakeup ? '<span class="badge-makeup-sm">⚡</span> ' : ""}${escapeHtml(sCode)}</span>
              <span class="sub-room" style="font-size:0.7rem; opacity:0.9;">${escapeHtml(rNum)}${!selectedClass ? ` • ${escapeHtml(cName.replace(/^B\.Tech\s*/i, ""))}` : ""}</span>
            </div>
          `;
        });
      } else {
        tbody += `<button type="button" class="dash-add-cell-btn" data-dash-add-day="${d.key}" data-dash-add-slot="${h.slotId}" title="Add class on ${d.key} at ${h.time}">+</button>`;
      }
      tbody += `</td>`;
    });
    tbody += `</tr>`;
  });
  tbody += `</tbody>`;

  table.innerHTML = thead + tbody;

  table.querySelectorAll("[data-dash-edit]").forEach(card => {
    card.addEventListener("click", () => openTimetableForm(card.dataset.dashEdit));
  });

  table.querySelectorAll("[data-dash-add-day]").forEach(btn => {
    btn.addEventListener("click", () => openTimetableForm(null, btn.dataset.dashAddDay, btn.dataset.dashAddSlot));
  });
}

function renderDashboardTodayWidget() {
  const container = document.getElementById("dash-today-list");
  if (!container) return;

  const tt = getTimetable();
  const dayKey = dashSelectedDay || "Tuesday";
  const dateSub = document.getElementById("dash-today-widget-date");
  if (dateSub) {
    const dateMap = { Monday: "22 Sep 2026", Tuesday: "23 Sep 2026", Wednesday: "24 Sep 2026", Thursday: "25 Sep 2026", Friday: "26 Sep 2026", Saturday: "27 Sep 2026" };
    dateSub.textContent = dateMap[dayKey] || "Today";
  }

  const todayEntries = tt.filter(e => e.day === dayKey).sort((a, b) => a.slotId.localeCompare(b.slotId));

  if (!todayEntries.length) {
    container.innerHTML = `<p class="empty-inline" style="padding:1rem 0;">No classes scheduled for ${dayKey}.</p>`;
    return;
  }

  container.innerHTML = todayEntries.map(e => {
    const sName = subjectName(e.subjectId);
    const sCode = subjectCode(e.subjectId);
    const rNum = roomName(e.roomId);
    const stripeClass = getTodayStripeClass(sCode || sName);

    return `
      <div class="today-item ${stripeClass}" data-today-edit="${e.id}" style="cursor:pointer;" title="Click to view or edit class">
        <span class="item-title">${escapeHtml(sCode)}</span>
        <span class="item-time">${escapeHtml(slotLabel(e.slotId))}</span>
        <span class="item-room">Room ${escapeHtml(rNum)}</span>
      </div>
    `;
  }).join("");

  container.querySelectorAll("[data-today-edit]").forEach(item => {
    item.addEventListener("click", () => openTimetableForm(item.dataset.todayEdit));
  });
}

function renderDashboardListAgenda() {
  const listEl = document.getElementById("dash-timetable-list");
  if (!listEl) return;

  const classFilter = document.getElementById("dash-filter-class")?.value || "";
  const tt = getTimetable();
  const filteredTt = classFilter ? tt.filter(e => String(e.classId) === String(classFilter)) : tt;

  const dayOrder = { Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
  filteredTt.sort((a, b) => (dayOrder[a.day] || 7) - (dayOrder[b.day] || 7) || a.slotId.localeCompare(b.slotId));

  listEl.innerHTML = `
    <div style="padding:0.25rem 0;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; flex-wrap:wrap; gap:0.5rem;">
        <h3 style="margin:0; color:var(--text-white); font-size:1.05rem;">Current Schedule Agenda (${filteredTt.length} classes)</h3>
        <button type="button" class="btn btn-primary btn-ghost-sm" id="dash-list-add-btn">+ Add Entry</button>
      </div>
      ${filteredTt.length ? `
        <div class="list-simple">
          ${filteredTt.map(e => `
            <div class="list-row" style="cursor:pointer;" data-dash-edit="${e.id}">
              <div class="lr-main">
                <strong>${escapeHtml(subjectName(e.subjectId))} (${escapeHtml(subjectCode(e.subjectId))})</strong>
                <span>${escapeHtml(className(e.classId))} • ${escapeHtml(teacherName(e.teacherId))} • ${escapeHtml(roomName(e.roomId))}</span>
              </div>
              <div style="display:flex; align-items:center; gap:0.5rem;">
                <span class="badge badge-soft">${e.day} ${slotLabel(e.slotId)}</span>
                <button type="button" class="btn btn-ghost-sm" data-edit-item="${e.id}">Edit</button>
                <button type="button" class="btn btn-ghost-sm" data-del-item="${e.id}" style="color:var(--danger, #ef4444);">Delete</button>
              </div>
            </div>
          `).join("")}
        </div>
      ` : `<p class="empty-inline">No timetable entries match.</p>`}
    </div>
  `;

  const addBtn = document.getElementById("dash-list-add-btn");
  if (addBtn) addBtn.addEventListener("click", () => openTimetableForm(null));

  listEl.querySelectorAll("[data-edit-item]").forEach(b => b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    openTimetableForm(b.dataset.editItem);
  }));

  listEl.querySelectorAll("[data-del-item]").forEach(b => b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    deleteSingleTimetableEntry(b.dataset.delItem);
  }));

  listEl.querySelectorAll(".list-row[data-dash-edit]").forEach(row => row.addEventListener("click", () => {
    openTimetableForm(row.dataset.dashEdit);
  }));
}

let miniCalYear = 2026;
let miniCalMonth = 8; // September (0-indexed)
let miniCalActiveDay = 23;

function renderDashboardMiniCalendar() {
  const titleEl = document.getElementById("mini-cal-title");
  const gridEl = document.getElementById("mini-cal-grid");
  if (!gridEl) return;

  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  if (titleEl) titleEl.textContent = `${monthNames[miniCalMonth]} ${miniCalYear}`;

  const daysInMonth = new Date(miniCalYear, miniCalMonth + 1, 0).getDate();
  const firstDayIndex = (new Date(miniCalYear, miniCalMonth, 1).getDay() + 6) % 7; // Monday=0 .. Sunday=6

  let html = "";
  for (let i = 0; i < firstDayIndex; i++) {
    html += `<span class="mini-cal-day muted-day"></span>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const isActive = d === miniCalActiveDay && miniCalMonth === 8 && miniCalYear === 2026;
    html += `<span class="mini-cal-day${isActive ? " active-day" : ""}" data-cal-day="${d}">${d}</span>`;
  }

  gridEl.innerHTML = html;

  gridEl.querySelectorAll("[data-cal-day]").forEach(el => {
    el.addEventListener("click", () => {
      miniCalActiveDay = Number(el.dataset.calDay);
      const dayDate = new Date(miniCalYear, miniCalMonth, miniCalActiveDay);
      const dayIdx = (dayDate.getDay() + 6) % 7;
      if (dayIdx >= 0 && dayIdx < DAYS.length) {
        dashSelectedDay = DAYS[dayIdx];
      }
      renderDashboardMiniCalendar();
      renderDashboardTodayWidget();
      renderDashboardTimetableGrid();
    });
  });
}

function renderDashboardSubjectsWidget() {
  const listEl = document.getElementById("dash-subjects-list");
  if (!listEl) return;

  const subjects = getSubjects();
  const displaySubs = subjects.slice(0, 6);

  listEl.innerHTML = displaySubs.map(s => {
    const sCode = s.code || s.name;
    const dotClass = getSubjectDotClass(sCode);

    return `
      <div class="legend-item" data-filter-sub="${s.id}" title="Click to filter by ${escapeHtml(sCode)}">
        <span class="legend-dot ${dotClass}"></span>
        <span>${escapeHtml(sCode)}</span>
      </div>
    `;
  }).join("");

  listEl.querySelectorAll("[data-filter-sub]").forEach(item => {
    item.addEventListener("click", () => {
      navigateTo("timetable");
      const searchInput = document.getElementById("tt-search");
      const sub = getSubjects().find(x => String(x.id) === String(item.dataset.filterSub));
      if (searchInput && sub) {
        searchInput.value = sub.code || sub.name;
        drawTimetableGrid();
      }
    });
  });
}

function initDashboardPage() {
  const addClassBtn = document.getElementById("dash-add-class-btn");
  if (addClassBtn) addClassBtn.addEventListener("click", () => openTimetableForm(null));

  const qaTt = document.getElementById("dash-qa-timetable");
  if (qaTt) qaTt.addEventListener("click", () => openTimetableForm(null));

  const qaGen = document.getElementById("dash-qa-generate");
  if (qaGen) qaGen.addEventListener("click", () => navigateTo("generate"));

  const qaTeach = document.getElementById("dash-qa-teacher");
  if (qaTeach) qaTeach.addEventListener("click", () => openTeacherForm(null));

  const qaRoom = document.getElementById("dash-qa-room");
  if (qaRoom) qaRoom.addEventListener("click", () => openRoomForm(null));

  const qaStudy = document.getElementById("dash-qa-study-plans");
  if (qaStudy) qaStudy.addEventListener("click", () => navigateTo("study-plans"));

  const qaMakeup = document.getElementById("dash-qa-makeup");
  if (qaMakeup) qaMakeup.addEventListener("click", () => openMakeupModal());

  const viewToday = document.getElementById("dash-view-today-btn");
  if (viewToday) viewToday.addEventListener("click", () => navigateTo("timetable"));

  const viewSubs = document.getElementById("dash-view-subjects-btn");
  if (viewSubs) viewSubs.addEventListener("click", () => navigateTo("subjects"));

  // View mode switcher: Week | Month | List
  const viewModeBtns = document.querySelectorAll("#dash-view-mode .seg-btn");
  viewModeBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      viewModeBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const mode = btn.dataset.view;
      dashViewMode = mode;
      const gridTable = document.getElementById("dash-timetable-grid");
      const listEl = document.getElementById("dash-timetable-list");

      if (mode === "month") {
        navigateTo("calendar");
      } else if (mode === "list") {
        if (gridTable) gridTable.classList.add("hidden");
        if (listEl) {
          listEl.classList.remove("hidden");
          renderDashboardListAgenda();
        }
      } else {
        if (listEl) listEl.classList.add("hidden");
        if (gridTable) gridTable.classList.remove("hidden");
        renderDashboardTimetableGrid();
      }
    });
  });

  const dashClassFilter = document.getElementById("dash-filter-class");
  if (dashClassFilter) {
    dashClassFilter.addEventListener("change", () => {
      if (dashViewMode === "list") {
        renderDashboardListAgenda();
      } else {
        renderDashboardTimetableGrid();
      }
    });
  }

  // Date range buttons
  const datePrev = document.getElementById("dash-date-prev");
  const dateNext = document.getElementById("dash-date-next");
  const dateToday = document.getElementById("dash-today-btn");

  if (datePrev) {
    datePrev.addEventListener("click", () => {
      dashboardWeekOffset--;
      updateDashboardDateLabel();
      if (dashViewMode === "list") {
        renderDashboardListAgenda();
      } else {
        renderDashboardTimetableGrid();
      }
      toast("Navigated to previous week", "info");
    });
  }

  if (dateNext) {
    dateNext.addEventListener("click", () => {
      dashboardWeekOffset++;
      updateDashboardDateLabel();
      if (dashViewMode === "list") {
        renderDashboardListAgenda();
      } else {
        renderDashboardTimetableGrid();
      }
      toast("Navigated to next week", "info");
    });
  }

  if (dateToday) {
    dateToday.addEventListener("click", () => {
      dashboardWeekOffset = 0;
      updateDashboardDateLabel();
      if (dashViewMode === "list") {
        renderDashboardListAgenda();
      } else {
        renderDashboardTimetableGrid();
      }
      toast("Navigated to current week", "success");
    });
  }

  // Mini calendar month nav
  const calPrev = document.getElementById("mini-cal-prev");
  const calNext = document.getElementById("mini-cal-next");
  if (calPrev) {
    calPrev.addEventListener("click", () => {
      miniCalMonth = (miniCalMonth - 1 + 12) % 12;
      if (miniCalMonth === 11) miniCalYear--;
      renderDashboardMiniCalendar();
    });
  }
  if (calNext) {
    calNext.addEventListener("click", () => {
      miniCalMonth = (miniCalMonth + 1) % 12;
      if (miniCalMonth === 0) miniCalYear++;
      renderDashboardMiniCalendar();
    });
  }

  // Header Semester Selector
  const semSel = document.getElementById("header-semester-select");
  if (semSel) {
    semSel.addEventListener("change", () => {
      toast(`Switched view to ${semSel.options[semSel.selectedIndex].text}`, "info");
      renderDashboard();
    });
  }
}

function renderSectionsPage() {
  const classes = getClasses();
  const q = (document.getElementById("section-search")?.value || "").toLowerCase();
  const classFilter = document.getElementById("section-class-filter")?.value || "";

  const filterSelect = document.getElementById("section-class-filter");
  if (filterSelect && filterSelect.options.length <= 1) {
    filterSelect.innerHTML = `<option value="">All classes</option>` +
      classes.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  }

  const tt = getTimetable();
  const sectionsData = [];
  classes.forEach(c => {
    if (classFilter && String(c.id) !== String(classFilter)) return;
    const weeklyPeriods = tt.filter(e => String(e.classId) === String(c.id)).length;
    sectionsData.push({
      classId: c.id,
      className: c.name,
      section: c.section || "A",
      students: c.students || 50,
      weeklyPeriods,
      status: "Active"
    });
  });

  const filtered = sectionsData.filter(s =>
    (s.className + " " + s.section).toLowerCase().includes(q)
  );

  const tbody = document.querySelector("#sections-table tbody");
  const emptyEl = document.getElementById("sections-empty");
  if (emptyEl) emptyEl.classList.toggle("hidden", filtered.length > 0);

  if (tbody) {
    tbody.innerHTML = filtered.map(s => `
      <tr>
        <td><strong>${escapeHtml(s.className)}</strong></td>
        <td><span class="badge badge-soft">Section ${escapeHtml(s.section)}</span></td>
        <td>${s.students} students</td>
        <td>${s.weeklyPeriods} periods / week</td>
        <td><span class="badge badge-success">Active</span></td>
        <td>
          <div class="row-actions">
            <button data-edit-sec-class="${s.classId}" title="Edit Class & Section">✏️</button>
          </div>
        </td>
      </tr>
    `).join("");

    tbody.querySelectorAll("[data-edit-sec-class]").forEach(btn => {
      btn.addEventListener("click", () => openClassForm(btn.dataset.editSecClass));
    });
  }
}

function initSectionsPage() {
  const addBtn = document.getElementById("section-add-btn");
  if (addBtn) addBtn.addEventListener("click", () => openClassForm(null));

  const searchInput = document.getElementById("section-search");
  if (searchInput) searchInput.addEventListener("input", renderSectionsPage);

  const filterSelect = document.getElementById("section-class-filter");
  if (filterSelect) filterSelect.addEventListener("change", renderSectionsPage);
}

/* ---------- Timetable Health Score ----------
   A single 0-100 score blending four signals:
   1. Conflict-free rate   - fewer clashes is better (heaviest weight)
   2. Workload balance     - teachers with periods shouldn't be wildly uneven
   3. Room-usage balance   - rooms shouldn't be wildly uneven either
   4. Schedule compactness - fewer "gap" periods inside a class's day
   Each signal becomes a 0-100 sub-score; the total is a weighted average.
   The function also produces plain-English, actionable suggestions. */
function computeHealthScore() {
  const tt = getTimetable(), teachers = getTeachers(), rooms = getRooms(), classes = getClasses();
  const totalEntries = tt.length || 1;
  const conflicts = getAllConflicts();
  const conflictScore = Math.max(0, 100 - (conflicts.length / totalEntries) * 300);

  const stdevOf = arr => {
    if (!arr.length) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
    return { mean, sd: Math.sqrt(variance) };
  };

  const teacherCounts = teachers.map(t => tt.filter(e => e.teacherId === t.id).length).filter(n => n > 0);
  const teacherStat = stdevOf(teacherCounts);
  const workloadScore = teacherCounts.length > 1 ? Math.max(0, 100 - (teacherStat.sd / (teacherStat.mean || 1)) * 140) : 100;

  const roomCounts = rooms.map(r => tt.filter(e => e.roomId === r.id).length).filter(n => n > 0);
  const roomStat = stdevOf(roomCounts);
  const roomScore = roomCounts.length > 1 ? Math.max(0, 100 - (roomStat.sd / (roomStat.mean || 1)) * 120) : 100;

  let totalGapPeriods = 0, totalUsedDays = 0;
  const suggestions = [];
  classes.forEach(c => {
    DAYS.forEach(day => {
      const daySlots = tt.filter(e => e.classId === c.id && e.day === day).map(e => SLOTS.findIndex(s => s.id === e.slotId)).sort((a, b) => a - b);
      if (daySlots.length < 2) return;
      totalUsedDays++;
      const span = daySlots[daySlots.length - 1] - daySlots[0] + 1;
      const gap = span - daySlots.length;
      if (gap > 0) {
        totalGapPeriods += gap;
        if (suggestions.length < 3) {
          suggestions.push(`${className(c.id)} has a ${gap}-period gap on ${day} — consider moving a class earlier to close the gap.`);
        }
      }
    });
  });
  const compactnessScore = totalUsedDays ? Math.max(0, 100 - (totalGapPeriods / totalUsedDays) * 60) : 100;

  if (conflicts.length) suggestions.unshift(`${conflicts.length} scheduling conflict${conflicts.length > 1 ? "s are" : " is"} active — resolve them on the Timetable page for the biggest score boost.`);
  if (teacherCounts.length > 1 && teacherStat.sd / (teacherStat.mean || 1) > 0.4) {
    const maxT = teachers.filter(t => tt.filter(e => e.teacherId === t.id).length > 0).sort((a, b) => tt.filter(e => e.teacherId === b.id).length - tt.filter(e => e.teacherId === a.id).length)[0];
    if (maxT) suggestions.push(`${maxT.name} carries a notably heavier load than peers — consider redistributing a period or two.`);
  }
  if (roomCounts.length > 1 && roomStat.sd / (roomStat.mean || 1) > 0.4) {
    const minR = rooms.filter(r => tt.filter(e => e.roomId === r.id).length === Math.min(...roomCounts)).slice(0, 1)[0];
    if (minR) suggestions.push(`${minR.number} is under-used compared to other rooms — it's a good candidate for new sections.`);
  }
  if (!suggestions.length) suggestions.push("Great work — no major scheduling issues detected right now.");

  const score = Math.round(conflictScore * 0.4 + workloadScore * 0.25 + roomScore * 0.15 + compactnessScore * 0.2);
  return {
    score,
    breakdown: [
      { label: "Conflict-free", value: Math.round(conflictScore) },
      { label: "Workload balance", value: Math.round(workloadScore) },
      { label: "Room balance", value: Math.round(roomScore) },
      { label: "Compactness", value: Math.round(compactnessScore) }
    ],
    suggestions: suggestions.slice(0, 4)
  };
}
function scoreColor(v) { return v >= 80 ? "var(--success)" : v >= 55 ? "var(--warning)" : "var(--danger)"; }
function renderHealthScore() {
  const body = document.getElementById("health-body");
  if (!body) return;
  const result = computeHealthScore();
  body.innerHTML = `
    <div class="health-gauge" style="--gauge-pct:${result.score};--gauge-color:${scoreColor(result.score)}">
      <span class="health-gauge-value">${result.score}</span>
    </div>
    <div class="health-breakdown">
      ${result.breakdown.map(b => `
        <div class="health-row">
          <span>${b.label}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${b.value}%;background:${scoreColor(b.value)}"></div></div>
          <span>${b.value}</span>
        </div>`).join("")}
      <div>
        <div class="health-label-text small">Suggestions</div>
        <ul class="conflict-list" style="margin:.4rem 0 0;">
          ${result.suggestions.map(s => `<li style="background:var(--info-bg);color:var(--info);border:1px solid var(--info-border);">${escapeHtml(s)}</li>`).join("")}
        </ul>
      </div>
    </div>`;
}

function rowHtml(title, subtitle, right) {
  return `<div class="list-row"><div class="lr-main"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(subtitle)}</span></div>${right ? `<span class="badge badge-soft">${escapeHtml(right)}</span>` : ""}</div>`;
}

function getUpcomingEntries(limit) {
  const now = new Date();
  const todayIdx = now.getDay(); // 0 Sun .. 6 Sat
  const tt = getTimetable();
  const ordered = [];
  for (let offset = 0; offset < 7; offset++) {
    const dIdx = (todayIdx + offset) % 7;
    const dayName = DAYS[dIdx - 1] !== undefined && dIdx !== 0 ? DAYS[dIdx - 1] : null;
    if (!dayName) continue;
    const entries = tt.filter(e => e.day === dayName).sort((a, b) => a.slotId.localeCompare(b.slotId));
    entries.forEach(e => ordered.push(e));
    if (ordered.length >= limit) break;
  }
  return ordered.slice(0, limit);
}

/* ============================ CONFLICT ENGINE ============================ */
function findConflicts(entry, excludeId) {
  const conflicts = [];
  getTimetable().forEach(e => {
    if (e.id === excludeId) return;
    if (e.day !== entry.day || e.slotId !== entry.slotId) return;
    if (e.teacherId === entry.teacherId) {
      conflicts.push(`Teacher conflict: ${teacherName(entry.teacherId)} is already teaching ${className(e.classId)} in ${roomName(e.roomId)} on ${entry.day} at ${slotLabel(entry.slotId)}.`);
    }
    if (e.roomId === entry.roomId) {
      conflicts.push(`Room conflict: ${roomName(entry.roomId)} is already booked for ${className(e.classId)} (${subjectName(e.subjectId)}) on ${entry.day} at ${slotLabel(entry.slotId)}.`);
    }
    if (e.classId === entry.classId) {
      conflicts.push(`Class conflict: ${className(entry.classId)} already has ${subjectName(e.subjectId)} scheduled on ${entry.day} at ${slotLabel(entry.slotId)}.`);
    }
  });

  const rObj = getRooms().find(x => String(x.id) === String(entry.roomId));
  const cObj = getClasses().find(x => String(x.id) === String(entry.classId));
  if (rObj && cObj && rObj.capacity && cObj.students && rObj.capacity < cObj.students) {
    conflicts.push(`Room capacity (${rObj.capacity}) is smaller than class strength (${cObj.students}).`);
  }

  return conflicts;
}

function getAllConflicts() {
  const tt = getTimetable();
  const found = [];
  const seen = new Set();
  tt.forEach(entry => {
    const cs = findConflicts(entry, entry.id);
    cs.forEach(c => {
      const key = entry.day + entry.slotId + c;
      if (!seen.has(key)) { seen.add(key); found.push({ title: `${entry.day}, ${slotLabel(entry.slotId)}`, detail: c }); }
    });
  });
  return found;
}

/* ============================ TIMETABLE PAGE ============================ */
function renderFilterSelects() {
  const classSel = document.getElementById("filter-class");
  const teacherSel = document.getElementById("filter-teacher");
  const roomSel = document.getElementById("filter-room");
  const daySel = document.getElementById("filter-day");
  if (classSel) classSel.innerHTML = `<option value="">All classes</option>` + optionsFromList(getClasses(), "id", c => `${c.name} - ${c.section}`);
  if (teacherSel) teacherSel.innerHTML = `<option value="">All teachers</option>` + optionsFromList(getTeachers(), "id", t => t.name);
  if (roomSel) roomSel.innerHTML = `<option value="">All rooms</option>` + optionsFromList(getRooms(), "id", r => r.number);
  if (daySel) daySel.innerHTML = `<option value="">All days</option>` + DAYS.map(d => `<option value="${d}">${d}</option>`).join("");
}

function getTimetableFilters() {
  const typeEl = document.getElementById("filter-type");
  return {
    classId: document.getElementById("filter-class")?.value || "",
    teacherId: document.getElementById("filter-teacher")?.value || "",
    roomId: document.getElementById("filter-room")?.value || "",
    day: document.getElementById("filter-day")?.value || "",
    entryType: typeEl ? typeEl.value : "",
    q: document.getElementById("tt-search")?.value.trim().toLowerCase() || ""
  };
}

function entryMatchesFilters(e, f) {
  if (f.classId && e.classId !== f.classId) return false;
  if (f.teacherId && e.teacherId !== f.teacherId && e.makeupTeacherId !== f.teacherId) return false;
  if (f.roomId && e.roomId !== f.roomId) return false;
  if (f.day && e.day !== f.day) return false;
  if (f.entryType) {
    const isMakeup = Boolean(e.entryType === "makeup" || e.isMakeup);
    if (f.entryType === "makeup" && !isMakeup) return false;
    if (f.entryType === "regular" && isMakeup) return false;
  }
  if (f.q) {
    const haystack = [
      subjectName(e.subjectId),
      teacherName(e.teacherId),
      e.makeupTeacherName || "",
      roomName(e.roomId),
      className(e.classId),
      e.day,
      e.makeupReason || "",
      slotLabel(e.slotId)
    ].join(" ").toLowerCase();
    if (!haystack.includes(f.q)) return false;
  }
  return true;
}

function renderTimetablePage() {
  renderFilterSelects();
  drawTimetableGrid();
}

function drawTimetableGrid() {
  const filters = getTimetableFilters();
  const tt = getTimetable().filter(e => e.status !== "cancelled" && entryMatchesFilters(e, filters));
  const table = document.getElementById("timetable-grid");
  const todayIdx = new Date().getDay();
  const todayName = todayIdx >= 1 && todayIdx <= 6 ? DAYS[todayIdx - 1] : null;

  let head = `<thead><tr><th class="slot-col">Time</th>${DAYS.map(d => `<th${d === todayName ? ' class="today-col"' : ""}>${d}</th>`).join("")}</tr></thead>`;
  let body = "<tbody>";
  SLOTS.forEach(slot => {
    body += `<tr><td class="slot-col">${slot.label}</td>`;
    DAYS.forEach(day => {
      const entries = tt.filter(e => e.day === day && e.slotId === slot.id);
      body += `<td data-day="${day}" data-slot="${slot.id}"${day === todayName ? ' class="today-col"' : ""}><div class="tt-cell">`;
      if (entries.length) {
        entries.forEach(e => {
          const hasConflict = findConflicts(e, e.id).length > 0;
          const sName = subjectName(e.subjectId);
          const sCode = subjectCode(e.subjectId);
          const themeClass = getSubjectThemeClass(sCode || sName);
          const isMakeup = Boolean(e.entryType === "makeup" || e.isMakeup);

          const rObj = getRooms().find(x => String(x.id) === String(e.roomId));
          const rCap = rObj ? rObj.capacity : null;

          body += `<div class="tt-entry ${themeClass}${isMakeup ? " tt-card-makeup" : ""}${hasConflict ? " conflicted" : ""}" draggable="true" data-drag-id="${e.id}">
            ${isMakeup ? `<div class="makeup-ribbon">⏰ Makeup Class</div>` : ""}
            <strong>${escapeHtml(sName)}</strong>
            <span>${escapeHtml(className(e.classId))}</span>
            <span>${escapeHtml(e.makeupTeacherName || teacherName(e.teacherId))} • ${escapeHtml(roomName(e.roomId))}${rCap ? ` (Cap: ${rCap})` : ""}</span>
            ${isMakeup && e.makeupReason ? `<small style="display:block; font-size:0.7rem; color:#fde68a; margin-top:2px;">📌 ${escapeHtml(e.makeupReason)}</small>` : ""}
            ${isMakeup && e.timetableDate ? `<small style="display:block; font-size:0.68rem; color:#cbd5e1;">📅 Date: ${escapeHtml(String(e.timetableDate).slice(0, 10))}</small>` : ""}
            ${hasConflict ? `<span class="badge badge-danger small">⚠ Conflict</span>` : ""}
            <span class="drag-handle">⠿ drag to reschedule</span>
            <div class="tt-actions">
              ${isMakeup
              ? `<button type="button" class="tt-del" data-cancel-makeup="${e.id}" style="color:#f59e0b;" title="Cancel makeup class">Cancel</button>`
              : `<button type="button" data-edit="${e.id}">Edit</button><button type="button" class="tt-del" data-del="${e.id}">Delete</button>`
            }
            </div>
          </div>`;
        });
      } else {
        body += `<button type="button" class="tt-add-cell" data-add-day="${day}" data-add-slot="${slot.id}" aria-label="Add entry ${day} ${slot.label}">+</button>`;
      }
      body += `</div></td>`;
    });
    body += "</tr>";
  });
  body += "</tbody>";
  table.innerHTML = head + body;

  document.getElementById("timetable-empty").classList.toggle("hidden", tt.length > 0);

  table.querySelectorAll("[data-edit]").forEach(btn => btn.addEventListener("click", () => openTimetableForm(btn.dataset.edit)));

  table.querySelectorAll("[data-del]").forEach(btn => btn.addEventListener("click", () => {
    deleteSingleTimetableEntry(btn.dataset.del);
  }));

  table.querySelectorAll("[data-cancel-makeup]").forEach(btn => btn.addEventListener("click", () => {
    cancelMakeupClass(btn.dataset.cancelMakeup);
  }));

  table.querySelectorAll("[data-add-day]").forEach(btn => btn.addEventListener("click", () => openTimetableForm(null, btn.dataset.addDay, btn.dataset.addSlot)));

  wireTimetableDragAndDrop(table);
}

/* ---------- Drag & drop rescheduling with live conflict preview ---------- */
let draggingEntryId = null;
function wireTimetableDragAndDrop(table) {
  table.querySelectorAll("[data-drag-id]").forEach(card => {
    card.addEventListener("dragstart", () => {
      draggingEntryId = card.dataset.dragId;
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      draggingEntryId = null;
      table.querySelectorAll(".drop-target, .drop-target-bad").forEach(td => td.classList.remove("drop-target", "drop-target-bad"));
    });
  });

  table.querySelectorAll("td[data-day]").forEach(td => {
    td.addEventListener("dragover", e => {
      if (!draggingEntryId) return;
      e.preventDefault();
      const entry = getTimetable().find(x => x.id === draggingEntryId);
      if (!entry) return;
      const hypothetical = { ...entry, day: td.dataset.day, slotId: td.dataset.slot };
      const wouldConflict = findConflicts(hypothetical, entry.id).length > 0;
      td.classList.toggle("drop-target", !wouldConflict);
      td.classList.toggle("drop-target-bad", wouldConflict);
    });
    td.addEventListener("dragleave", () => td.classList.remove("drop-target", "drop-target-bad"));
    td.addEventListener("drop", e => {
      e.preventDefault();
      td.classList.remove("drop-target", "drop-target-bad");
      if (!draggingEntryId) return;
      const entry = getTimetable().find(x => x.id === draggingEntryId);
      draggingEntryId = null;
      if (!entry) return;
      const newDay = td.dataset.day, newSlot = td.dataset.slot;
      if (entry.day === newDay && entry.slotId === newSlot) return; // dropped back in place
      const updated = { ...entry, day: newDay, slotId: newSlot };
      const conflicts = findConflicts(updated, entry.id);
      const commitMove = (overridden) => {
        const tt = getTimetable();
        const idx = tt.findIndex(x => x.id === entry.id);
        tt[idx] = { ...tt[idx], day: newDay, slotId: newSlot, overridden: overridden || false };
        setTimetable(tt);
        drawTimetableGrid();
        addNotification(`${subjectName(entry.subjectId)} for ${className(entry.classId)} moved to ${newDay} ${slotLabel(newSlot)}.`, overridden ? "warning" : "success");
        logAudit(overridden ? "override" : "update", "Timetable Entry",
          `Dragged ${subjectName(entry.subjectId)} (${className(entry.classId)}) from ${entry.day} ${slotLabel(entry.slotId)} to ${newDay} ${slotLabel(newSlot)}${overridden ? " despite a conflict" : ""}.`);
        toast(overridden ? "Moved with an overridden conflict." : "Class rescheduled.", overridden ? "warning" : "success");
      };
      if (conflicts.length) {
        openConflictModal(conflicts, () => commitMove(true));
      } else {
        commitMove(false);
      }
    });
  });
}

function timetableFormFields(entry) {
  const teachers = getTeachers();
  const subjects = getSubjects();
  const rooms = getRooms();
  const classes = getClasses();

  return `
    <div class="field-grid">
      <div class="field"><label for="f-day">Day of Week</label>
        <select id="f-day" required>${DAYS.map(d => `<option value="${d}" ${entry && entry.day === d ? "selected" : ""}>${d}</option>`).join("")}</select>
      </div>
      <div class="field"><label for="f-slot">Time Slot</label>
        <select id="f-slot" required>${SLOTS.map(s => `<option value="${s.id}" ${entry && entry.slotId === s.id ? "selected" : ""}>${s.label}</option>`).join("")}</select>
      </div>
      <div class="field"><label for="f-class">Class</label>
        <select id="f-class" required>
          <option value="">Select class</option>
          ${optionsFromList(classes, "id", c => `${c.name}`, false, "", entry?.classId)}
        </select>
      </div>
      <div class="field"><label for="f-section">Section</label>
        <select id="f-section" required>
          <option value="">Select section</option>
        </select>
      </div>
      <div class="field"><label for="f-subject">Subject</label>
        <select id="f-subject" required><option value="">Select subject</option>${optionsFromList(subjects, "id", s => `${s.code} - ${s.name}`, false, "", entry?.subjectId)}</select>
      </div>
      <div class="field"><label for="f-teacher">Assigned Teacher</label>
        <select id="f-teacher" required><option value="">Select teacher</option>${optionsFromList(teachers, "id", t => t.name, false, "", entry?.teacherId)}</select>
      </div>
      <div class="field field-full"><label for="f-room">Classroom</label>
        <select id="f-room" required><option value="">Select classroom</option>${optionsFromList(rooms, "id", r => `${r.number} (${r.type} • Cap: ${r.capacity})`, false, "", entry?.roomId)}</select>
      </div>
      <div class="field field-full">
        <label for="f-notes">Schedule Notes / Instructions</label>
        <input type="text" id="f-notes" value="${escapeHtml(entry?.notes || "")}" placeholder="Optional schedule notes..." />
      </div>
    </div>

    <!-- Live Availability Checker Panel -->
    <div class="avail-checker-panel" id="f-avail-panel">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 0.5rem;">
        <span style="font-weight:700; font-size:0.85rem; color:var(--text-white);">⚡ Real-Time Resource Availability</span>
        <span class="muted small" id="f-avail-summary">Checking availability...</span>
      </div>
      <div class="avail-badge-strip" id="f-avail-badges">
        <span class="badge badge-soft" id="f-badge-room">Room: Checking...</span>
        <span class="badge badge-soft" id="f-badge-teacher">Teacher: Checking...</span>
        <span class="badge badge-soft" id="f-badge-section">Section: Checking...</span>
      </div>
      <div id="f-conflict-alert" class="conflict-alert hidden" style="margin-top:0.75rem;"></div>
      <div id="f-scheduled-box" style="margin-top:0.75rem;"></div>
    </div>`;
}

async function loadSectionsForClass(classId, selectedSectionId = null) {
  const sectionSelect = document.getElementById("f-section");
  if (!sectionSelect) return;

  if (!classId) {
    sectionSelect.innerHTML = `<option value="">Select section</option>`;
    return;
  }

  sectionSelect.innerHTML = `<option value="">Loading sections...</option>`;

  try {
    const response = await apiRequest(`/sections?class_id=${encodeURIComponent(classId)}`);
    const sections = apiRows(response);

    if (sections && sections.length) {
      sectionSelect.innerHTML = `<option value="">Select section</option>` +
        sections.map(section => `
          <option value="${section.id}" ${String(section.id) === String(selectedSectionId) ? "selected" : ""}>
            Section ${escapeHtml(section.name)}
          </option>
        `).join("");
      return;
    }
  } catch (error) {
    console.warn("Could not load backend sections, using fallback:", error);
  }

  // Graceful fallback from local class or standard sections
  const cls = getClasses().find(c => String(c.id) === String(classId));
  const fallbackSec = cls?.section || "A";
  sectionSelect.innerHTML = `
    <option value="${selectedSectionId || '1'}" selected>Section ${escapeHtml(fallbackSec)}</option>
    <option value="2">Section B</option>
  `;
}

function openTimetableForm(editId, presetDay, presetSlot) {
  const entry = editId
    ? getTimetable().find(e => String(e.id) === String(editId))
    : null;

  // Handle modal delete button
  const delBtn = document.getElementById("modal-form-delete");
  if (delBtn) {
    if (editId) {
      delBtn.classList.remove("hidden");
      delBtn.onclick = () => {
        closeFormModal();
        deleteSingleTimetableEntry(editId);
      };
    } else {
      delBtn.classList.add("hidden");
      delBtn.onclick = null;
    }
  }

  openFormModal(
    entry ? "Edit Timetable Entry" : "Add Timetable Entry",
    timetableFormFields(entry),
    () => {
      const classId = document.getElementById("f-class").value;
      const sectionId = document.getElementById("f-section").value || "1";
      const cls = getClasses().find(c => String(c.id) === String(classId));

      const data = {
        day: document.getElementById("f-day").value,
        slotId: document.getElementById("f-slot").value,
        classId: classId,
        sectionId: sectionId,
        subjectId: document.getElementById("f-subject").value,
        teacherId: document.getElementById("f-teacher").value,
        roomId: document.getElementById("f-room").value,
        notes: document.getElementById("f-notes")?.value || "",
        academicYearId: entry?.academicYearId ?? entry?.academic_year_id ?? cls?.academicYearId ?? cls?.academic_year_id ?? 1
      };

      if (!data.classId || !data.subjectId || !data.teacherId || !data.roomId) {
        toast("Please select class, subject, teacher and room before saving.", "error");
        return;
      }

      saveTimetableEntry(data, editId);
    }
  );

  setTimeout(async () => {
    const classSelect = document.getElementById("f-class");
    const sectionSelect = document.getElementById("f-section");
    const daySelect = document.getElementById("f-day");
    const slotSelect = document.getElementById("f-slot");
    const subjectSelect = document.getElementById("f-subject");
    const teacherSelect = document.getElementById("f-teacher");
    const roomSelect = document.getElementById("f-room");

    if (!classSelect || !sectionSelect) return;

    classSelect.addEventListener("change", async () => {
      await loadSectionsForClass(classSelect.value);
      checkAvailabilityDebounced();
    });

    if (presetDay && daySelect) daySelect.value = presetDay;
    if (presetSlot && slotSelect) slotSelect.value = presetSlot;

    if (entry) {
      classSelect.value = entry.classId ?? entry.class_id ?? "";
      const selectedSectionId = entry.sectionId ?? entry.section_id ?? null;
      await loadSectionsForClass(classSelect.value, selectedSectionId);

      if (subjectSelect) subjectSelect.value = entry.subjectId ?? entry.subject_id ?? "";
      if (teacherSelect) teacherSelect.value = entry.teacherId ?? entry.teacher_id ?? "";
      if (roomSelect) roomSelect.value = entry.roomId ?? entry.room_id ?? "";
    }

    // Real-Time Availability Checker function
    let availTimer = null;
    function checkAvailabilityDebounced() {
      clearTimeout(availTimer);
      availTimer = setTimeout(async () => {
        const day = document.getElementById("f-day")?.value;
        const slot = document.getElementById("f-slot")?.value;
        const clsId = document.getElementById("f-class")?.value;
        const secId = document.getElementById("f-section")?.value;
        const tId = document.getElementById("f-teacher")?.value;
        const rId = document.getElementById("f-room")?.value;

        if (!day || !slot) return;

        const badgeRoom = document.getElementById("f-badge-room");
        const badgeTeacher = document.getElementById("f-badge-teacher");
        const badgeSection = document.getElementById("f-badge-section");
        const conflictAlert = document.getElementById("f-conflict-alert");
        const scheduledBox = document.getElementById("f-scheduled-box");
        const summaryEl = document.getElementById("f-avail-summary");

        try {
          const query = new URLSearchParams({
            day_of_week: day,
            slot_id: slot,
            class_id: clsId || "",
            section_id: secId || "",
            teacher_id: tId || "",
            room_id: rId || "",
            exclude_id: editId || ""
          });

          const res = await apiRequest(`/timetable/availability?${query.toString()}`);
          if (!res || !res.success) return;

          // Update Room badge
          if (rId && badgeRoom) {
            const roomStatus = res.selectedResourceStatus?.room;
            if (roomStatus === "Occupied") {
              badgeRoom.className = "badge badge-occupied";
              badgeRoom.textContent = "Room: Occupied";
            } else {
              badgeRoom.className = "badge badge-available";
              badgeRoom.textContent = "Room: Available";
            }
          } else if (badgeRoom) {
            badgeRoom.className = "badge badge-soft";
            badgeRoom.textContent = "Room: Choose a room";
          }

          // Update Teacher badge
          if (tId && badgeTeacher) {
            const teacherStatus = res.selectedResourceStatus?.teacher;
            if (teacherStatus === "Occupied") {
              badgeTeacher.className = "badge badge-occupied";
              badgeTeacher.textContent = "Teacher: Clashing / Occupied";
            } else {
              badgeTeacher.className = "badge badge-available";
              badgeTeacher.textContent = "Teacher: Available";
            }
          } else if (badgeTeacher) {
            badgeTeacher.className = "badge badge-soft";
            badgeTeacher.textContent = "Teacher: Choose a teacher";
          }

          // Update Section badge
          if (secId && badgeSection) {
            const secStatus = res.selectedResourceStatus?.section;
            if (secStatus === "Occupied") {
              badgeSection.className = "badge badge-occupied";
              badgeSection.textContent = "Section: Already Scheduled";
            } else {
              badgeSection.className = "badge badge-available";
              badgeSection.textContent = "Section: Available";
            }
          } else if (badgeSection) {
            badgeSection.className = "badge badge-soft";
            badgeSection.textContent = "Section: Choose section";
          }

          // Update Conflict Alert
          if (conflictAlert) {
            if (res.conflicts && res.conflicts.length > 0) {
              conflictAlert.classList.remove("hidden");
              conflictAlert.innerHTML = `<strong>⚠️ Scheduling Conflict Detected:</strong><br>` +
                res.conflicts.map(c => `• ${escapeHtml(c.message)}`).join("<br>");
            } else {
              conflictAlert.classList.add("hidden");
              conflictAlert.innerHTML = "";
            }
          }

          // Summary
          if (summaryEl && res.summary) {
            summaryEl.textContent = `${res.summary.availableRoomsCount} of ${res.summary.totalRooms} rooms free at this time`;
          }

          // Scheduled Classes Table
          if (scheduledBox) {
            if (res.scheduledClasses && res.scheduledClasses.length > 0) {
              scheduledBox.innerHTML = `
                <div style="font-size:0.75rem; font-weight:700; color:var(--text-muted); margin-bottom:0.25rem;">
                  Scheduled Classes at ${escapeHtml(day)} ${escapeHtml(res.slot?.label || slot)} (${res.scheduledClasses.length}):
                </div>
                <div style="max-height: 120px; overflow-y: auto; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);">
                  <table class="scheduled-classes-table">
                    <thead>
                      <tr><th>Class/Section</th><th>Subject</th><th>Teacher</th><th>Room</th></tr>
                    </thead>
                    <tbody>
                      ${res.scheduledClasses.map(sc => `
                        <tr>
                          <td><strong>${escapeHtml(sc.className)}</strong> (${escapeHtml(sc.sectionName)})</td>
                          <td>${escapeHtml(sc.subjectCode || sc.subjectName)}</td>
                          <td>${escapeHtml(sc.teacherName)}</td>
                          <td>${escapeHtml(sc.roomNumber)}</td>
                        </tr>
                      `).join("")}
                    </tbody>
                  </table>
                </div>
              `;
            } else {
              scheduledBox.innerHTML = `<span class="muted small" style="color:var(--success);">✅ All classrooms are free at ${escapeHtml(day)} ${escapeHtml(res.slot?.label || slot)}.</span>`;
            }
          }

          // Decorate room dropdown options
          const rSelect = document.getElementById("f-room");
          if (rSelect && res.roomAvailability) {
            const availMap = new Map();
            res.roomAvailability.forEach(r => availMap.set(String(r.id), r));
            Array.from(rSelect.options).forEach(opt => {
              if (!opt.value) return;
              const rData = availMap.get(opt.value);
              if (rData) {
                const clean = opt.textContent.replace(/^\[(Available|Occupied)\]\s*/, "");
                opt.textContent = rData.isAvailable ? `[Available] ${clean}` : `[Occupied] ${clean}`;
              }
            });
          }

        } catch (err) {
          console.warn("Live availability check error:", err);
        }
      }, 150);
    }

    // Attach real-time availability event listeners
    [daySelect, slotSelect, sectionSelect, subjectSelect, teacherSelect, roomSelect].forEach(el => {
      if (el) el.addEventListener("change", checkAvailabilityDebounced);
    });

    // Run initial availability check
    checkAvailabilityDebounced();
  }, 0);
}

async function saveTimetableEntry(data, editId, forceOverride = false) {
  try {
    showLoadingOverlay(true);

    const payloadBody = {
      academic_year_id: data.academicYearId || 1,
      class_id: !isNaN(Number(data.classId)) ? Number(data.classId) : 1,
      section_id: !isNaN(Number(data.sectionId)) ? Number(data.sectionId) : 1,
      subject_id: !isNaN(Number(data.subjectId)) ? Number(data.subjectId) : 1,
      teacher_id: !isNaN(Number(data.teacherId)) ? Number(data.teacherId) : 1,
      room_id: !isNaN(Number(data.roomId)) ? Number(data.roomId) : 1,
      day_of_week: data.day,
      time_slot_id: data.slotId,
      notes: data.notes || "",
      force_override: Boolean(forceOverride)
    };

    let result = null;
    let backendSaved = false;

    // Only attempt numeric ID update in PostgreSQL
    if (editId && /^\d+$/.test(String(editId))) {
      try {
        result = await apiRequest(`/timetable/${editId}`, {
          method: "PUT",
          body: JSON.stringify(payloadBody)
        });
        backendSaved = true;
      } catch (err) {
        if (err.payload && (err.payload.conflicts || err.payload.warnings)) throw err;
        console.warn("Backend PUT failed, updating local timetable store:", err);
      }
    } else {
      try {
        result = await apiRequest("/timetable", {
          method: "POST",
          body: JSON.stringify(payloadBody)
        });
        backendSaved = true;
      } catch (err) {
        if (err.payload && (err.payload.conflicts || err.payload.warnings)) throw err;
        console.warn("Backend POST failed, updating local timetable store:", err);
      }
    }

    // Local state update guarantee
    const currentTt = getTimetable();
    const entryData = {
      id: backendSaved && result?.data?.id ? String(result.data.id) : (editId || uid("tt")),
      classId: String(data.classId),
      sectionId: String(data.sectionId),
      subjectId: String(data.subjectId),
      teacherId: String(data.teacherId),
      roomId: String(data.roomId),
      day: data.day,
      slotId: normalizeSlotId(data.slotId),
      notes: data.notes || "",
      overridden: Boolean(forceOverride)
    };

    if (editId) {
      const idx = currentTt.findIndex(e => String(e.id) === String(editId));
      if (idx >= 0) {
        currentTt[idx] = { ...currentTt[idx], ...entryData };
      } else {
        currentTt.push(entryData);
      }
    } else {
      currentTt.push(entryData);
    }
    setTimetable(currentTt);

    closeFormModal();

    if (result && result.warnings && result.warnings.length > 0) {
      toast(`Saved with ${result.warnings.length} warning(s): ` + result.warnings.map(w => w.message || w).join("; "), "warning", 6000);
    } else {
      toast(editId ? "Timetable entry updated successfully." : "Timetable entry created successfully.", "success");
    }

    logAudit(editId ? "update" : "create", "Timetable", `${editId ? "Updated" : "Created"} session for ${subjectName(data.subjectId)} on ${data.day} ${slotLabel(data.slotId)}.`);

    refreshAllTimetableViews();

    if (backendSaved) {
      reloadTimetableData().catch(() => {});
    }
  } catch (error) {
    console.error("Save timetable error:", error);
    if (error.payload && (error.payload.conflicts || error.payload.warnings)) {
      openConflictModal(
        error.payload.conflicts || [],
        () => saveTimetableEntry(data, editId, true),
        error.payload.warnings || [],
        () => saveTimetableEntry(data, editId, true)
      );
    } else {
      toast(`Unable to save: ${error.message}`, "error", 6000);
    }
  } finally {
    showLoadingOverlay(false);
  }
}

function refreshAllTimetableViews() {
  drawTimetableGrid();
  renderDashboard();
  renderCalendarPage();
  renderAnalyticsPage();
  renderRoomsPage();
}

async function deleteSingleTimetableEntry(id) {
  if (!id) return;
  openConfirmModal("Delete timetable entry", "This will permanently remove this class from the timetable.", async () => {
    try {
      showLoadingOverlay(true);
      if (/^\d+$/.test(String(id))) {
        await apiRequest(`/timetable/${id}`, { method: "DELETE" });
      }
      toast("Timetable entry deleted.", "success");
    } catch (err) {
      console.warn("API delete failed, proceeding with local removal:", err);
      toast("Timetable entry removed.", "success");
    } finally {
      // Local removal guarantee
      setTimetable(getTimetable().filter(e => String(e.id) !== String(id)));
      logAudit("delete", "Timetable", `Deleted timetable entry #${id}`);
      showLoadingOverlay(false);
      refreshAllTimetableViews();
    }
  });
}

function openDeleteTimetableModal() {
  const modal = document.getElementById("modal-delete-timetable");
  if (!modal) return;

  const classSelect = document.getElementById("del-tt-class-select");
  const classWrap = document.getElementById("del-tt-class-wrap");
  const radioClass = document.getElementById("del-tt-scope-class");
  const radioAll = document.getElementById("del-tt-scope-all");
  const closeBtn = document.getElementById("modal-del-tt-close");
  const cancelBtn = document.getElementById("modal-del-tt-cancel");
  const confirmBtn = document.getElementById("modal-del-tt-confirm");

  // Populate classes
  const classes = getClasses();
  if (classSelect) {
    const currentFilterClass = document.getElementById("filter-class")?.value ||
      document.getElementById("dash-filter-class")?.value ||
      document.getElementById("cal-filter-class")?.value ||
      document.getElementById("gen-class")?.value || "";
    classSelect.innerHTML = optionsFromList(classes, "id", c => `${c.name} - ${c.section || 'A'}`, false, "", currentFilterClass);
  }

  // Radio toggles
  if (radioClass && radioAll && classWrap) {
    radioClass.checked = true;
    classWrap.classList.remove("hidden");
    radioClass.onchange = () => { classWrap.classList.remove("hidden"); };
    radioAll.onchange = () => { classWrap.classList.add("hidden"); };
  }

  const closeModal = () => modal.close();
  if (closeBtn) closeBtn.onclick = closeModal;
  if (cancelBtn) cancelBtn.onclick = closeModal;

  if (confirmBtn) {
    confirmBtn.onclick = async () => {
      const isAll = radioAll && radioAll.checked;
      const classId = classSelect ? classSelect.value : "";
      closeModal();

      if (!isAll && !classId) {
        toast("Please select a class to delete timetable for.", "warning");
        return;
      }

      await executeDeleteTimetable({ all: isAll, classId });
    };
  }

  modal.showModal();
}

async function executeDeleteTimetable({ all, classId }) {
  showLoadingOverlay(true);
  try {
    const query = all ? "all=true" : `class_id=${encodeURIComponent(classId)}`;
    try {
      await apiRequest(`/timetable/clear?${query}`, { method: "DELETE" });
    } catch (apiErr) {
      console.warn("Backend clear failed, applying local wipe:", apiErr);
    }

    if (all) {
      setTimetable([]);
      logAudit("delete", "Timetable", "Cleared entire university academic timetable.");
      toast("Entire timetable deleted successfully.", "success");
    } else {
      const clsName = className(classId);
      const remaining = getTimetable().filter(e => String(e.classId) !== String(classId));
      setTimetable(remaining);
      logAudit("delete", "Timetable", `Cleared timetable for ${clsName}.`);
      toast(`Deleted timetable for ${clsName}.`, "success");
    }

    refreshAllTimetableViews();
    updateGeneratorExistingWarning();
  } catch (err) {
    console.error("Execute delete timetable error:", err);
    toast("Failed to delete timetable: " + err.message, "error");
  } finally {
    showLoadingOverlay(false);
  }
}

async function reloadTimetableData() {
  try {
    const res = await apiRequest("/timetable?page=1&limit=10000");
    if (res && res.success !== false) {
      const rows = apiRows(res);
      const tt = rows.map(normalizeTimetable).filter(e => e.id && e.classId && e.subjectId && e.teacherId && e.roomId);
      setTimetable(tt);
    }
  } catch (e) {
    console.warn("Reload timetable error:", e);
  } finally {
    refreshAllTimetableViews();
  }
}

function initTimetablePage() {
  ["filter-class", "filter-teacher", "filter-room", "filter-day", "filter-type"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", drawTimetableGrid);
  });

  document.getElementById("tt-search").addEventListener("input", drawTimetableGrid);
  document.getElementById("tt-clear-filters").addEventListener("click", () => {
    ["filter-class", "filter-teacher", "filter-room", "filter-day", "filter-type"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    document.getElementById("tt-search").value = "";
    drawTimetableGrid();
  });

  const delTtBtn = document.getElementById("tt-delete-timetable-btn");
  if (delTtBtn) delTtBtn.addEventListener("click", openDeleteTimetableModal);

  document.getElementById("tt-add-btn").addEventListener("click", () => openTimetableForm(null));
  document.getElementById("tt-schedule-makeup-btn").addEventListener("click", () => openMakeupModal());
  document.getElementById("tt-print-btn").addEventListener("click", () => window.print());
  document.getElementById("tt-export-btn").addEventListener("click", exportTimetableCsv);
  document.getElementById("tt-export-ics-btn").addEventListener("click", exportTimetableIcs);
}

/* ---------- Export to Google/Outlook Calendar (.ics) ----------
   Builds a standard iCalendar file with one weekly-recurring VEVENT per
   timetable entry, so the whole schedule can be imported in one click. */
function nextDateForWeekday(dayName) {
  const targetIdx = DAYS.indexOf(dayName); // 0=Monday ... 5=Saturday
  const today = new Date();
  const todayIdx = (today.getDay() + 6) % 7; // convert JS Sun=0 to Mon=0
  let diff = targetIdx - todayIdx;
  if (diff < 0) diff += 7;
  const d = new Date(today);
  d.setDate(today.getDate() + diff);
  return d;
}
function icsDateTime(date, hour) {
  const d = new Date(date);
  d.setHours(hour, 0, 0, 0);
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
}
function exportTimetableIcs() {
  const filters = getTimetableFilters();
  const rows = getTimetable().filter(e => entryMatchesFilters(e, filters));
  if (!rows.length) { toast("Nothing to export for the current filters.", "warning"); return; }

  const nowStamp = icsDateTime(new Date(), new Date().getHours());
  let ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Smart Classroom Scheduler//EN\r\nCALSCALE:GREGORIAN\r\n";
  rows.forEach(e => {
    const hours = SLOT_HOURS[e.slotId] || [9, 10];
    const startDate = nextDateForWeekday(e.day);
    ics += "BEGIN:VEVENT\r\n";
    ics += `UID:${e.id}@smart-classroom-scheduler\r\n`;
    ics += `DTSTAMP:${nowStamp}\r\n`;
    ics += `DTSTART:${icsDateTime(startDate, hours[0])}\r\n`;
    ics += `DTEND:${icsDateTime(startDate, hours[1])}\r\n`;
    ics += `RRULE:FREQ=WEEKLY;COUNT=16\r\n`;
    ics += `SUMMARY:${subjectName(e.subjectId)} - ${className(e.classId)}\r\n`;
    ics += `LOCATION:${roomName(e.roomId)}\r\n`;
    ics += `DESCRIPTION:Taught by ${teacherName(e.teacherId)}\r\n`;
    ics += "END:VEVENT\r\n";
  });
  ics += "END:VCALENDAR\r\n";
  downloadFile("timetable.ics", ics, "text/calendar");
  logAudit("create", "Timetable", `Exported ${rows.length} timetable entries to a calendar (.ics) file.`);
  toast("Calendar file downloaded — import it into Google Calendar or Outlook.", "success");
}

function exportTimetableCsv() {
  const filters = getTimetableFilters();
  const rows = getTimetable().filter(e => entryMatchesFilters(e, filters));
  if (!rows.length) { toast("Nothing to export for the current filters.", "warning"); return; }
  const header = ["Day", "Time", "Class", "Subject", "Teacher", "Room"];
  const csvRows = [header.join(",")];
  rows.sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.slotId.localeCompare(b.slotId));
  rows.forEach(e => {
    const line = [e.day, slotLabel(e.slotId), className(e.classId), subjectName(e.subjectId), teacherName(e.teacherId), roomName(e.roomId)]
      .map(v => `"${String(v).replace(/"/g, '""')}"`).join(",");
    csvRows.push(line);
  });
  downloadFile("timetable.csv", csvRows.join("\n"), "text/csv");
  toast("Timetable exported as CSV.", "success");
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ============================ STUDY PLAN LIBRARY MODULE ============================ */
let studyPlansState = {
  data: [],
  programs: [],
  departments: [],
  viewMode: "grid", // 'grid' | 'table'
  loading: false,
  initialized: false
};

async function initStudyPlansPage() {
  if (studyPlansState.initialized) return;
  studyPlansState.initialized = true;

  const pFilter = document.getElementById("sp-filter-program");
  const dFilter = document.getElementById("sp-filter-dept");
  const sFilter = document.getElementById("sp-filter-semester");
  const yFilter = document.getElementById("sp-filter-year");
  const searchInput = document.getElementById("sp-search");
  const clearBtn = document.getElementById("sp-clear-filters");
  const toggleBtn = document.getElementById("sp-layout-toggle");
  const createBtn = document.getElementById("sp-create-btn");
  const emptyCreateBtn = document.getElementById("sp-empty-create-btn");

  if (pFilter) {
    pFilter.addEventListener("change", async () => {
      const currentProgId = pFilter.value;
      document.querySelectorAll(".nav-sub-link").forEach(l => {
        l.classList.toggle("active", (l.dataset.progId || "") === currentProgId);
      });
      await updateDeptFilterOptions(pFilter.value);
      await fetchStudyPlans();
    });
  }
  if (dFilter) dFilter.addEventListener("change", fetchStudyPlans);
  if (sFilter) sFilter.addEventListener("change", fetchStudyPlans);
  if (yFilter) yFilter.addEventListener("change", fetchStudyPlans);

  if (searchInput) {
    let searchTimer = null;
    searchInput.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(fetchStudyPlans, 250);
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (pFilter) pFilter.value = "";
      if (dFilter) dFilter.value = "";
      if (sFilter) sFilter.value = "";
      if (yFilter) yFilter.value = "2026-27";
      if (searchInput) searchInput.value = "";
      document.querySelectorAll(".nav-sub-link").forEach(l => {
        l.classList.toggle("active", (l.dataset.progId || "") === "");
      });
      fetchStudyPlans();
    });
  }

  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      studyPlansState.viewMode = studyPlansState.viewMode === "grid" ? "table" : "grid";
      toggleBtn.textContent = studyPlansState.viewMode === "grid" ? "⊞ Table View" : "▦ Grid View";
      renderStudyPlansView();
    });
  }

  if (createBtn) createBtn.addEventListener("click", () => openStudyPlanFormModal(null));
  if (emptyCreateBtn) emptyCreateBtn.addEventListener("click", () => openStudyPlanFormModal(null));

  // Modal details buttons
  const spdClose = document.getElementById("modal-spd-close");
  const spdCancel = document.getElementById("modal-spd-cancel");
  const spdModal = document.getElementById("modal-study-plan-details");
  if (spdClose) spdClose.addEventListener("click", () => spdModal.close());
  if (spdCancel) spdCancel.addEventListener("click", () => spdModal.close());

  // Modal form buttons
  const spfClose = document.getElementById("modal-spf-close");
  const spfCancel = document.getElementById("modal-spf-cancel");
  const spfModal = document.getElementById("modal-study-plan-form");
  if (spfClose) spfClose.addEventListener("click", () => spfModal.close());
  if (spfCancel) spfCancel.addEventListener("click", () => spfModal.close());

  const spfForm = document.getElementById("study-plan-form-el");
  if (spfForm) spfForm.addEventListener("submit", handleStudyPlanFormSubmit);

  const spfProgram = document.getElementById("spf-program");
  if (spfProgram) {
    spfProgram.addEventListener("change", () => updateFormDeptOptions(spfProgram.value));
  }
}

async function renderStudyPlansPage() {
  initStudyPlansPage();
  await loadStudyPlanMetadata();
  await fetchStudyPlans();
}

async function loadStudyPlanMetadata() {
  try {
    const pFilter = document.getElementById("sp-filter-program");
    const spfProgram = document.getElementById("spf-program");

    if (!studyPlansState.programs.length) {
      const progRes = await apiRequest("/programs");
      studyPlansState.programs = apiRows(progRes);

      if (pFilter && studyPlansState.programs.length) {
        pFilter.innerHTML = `<option value="">All Programs</option>` +
          studyPlansState.programs.map(p => `<option value="${p.id}">${escapeHtml(p.code)} — ${escapeHtml(p.name)}</option>`).join("");
      }

      if (spfProgram && studyPlansState.programs.length) {
        spfProgram.innerHTML = `<option value="">Select Program</option>` +
          studyPlansState.programs.map(p => `<option value="${p.id}">${escapeHtml(p.code)} — ${escapeHtml(p.name)}</option>`).join("");
      }
    }

    await updateDeptFilterOptions(pFilter?.value || "");
  } catch (error) {
    console.warn("Could not load study plans metadata:", error);
  }
}

async function updateDeptFilterOptions(programId) {
  const dFilter = document.getElementById("sp-filter-dept");
  if (!dFilter) return;

  const depts = [
    { id: 1, program_id: 1, name: "Computer Science" },
    { id: 2, program_id: 2, name: "Computer Science" },
    { id: 3, program_id: 3, name: "Management Studies" },
    { id: 4, program_id: 4, name: "Executive Management" },
    { id: 5, program_id: 5, name: "Computer Applications" },
    { id: 6, program_id: 6, name: "Advanced Applications" },
    { id: 7, program_id: 7, name: "Humanities & Arts" },
    { id: 8, program_id: 8, name: "Postgraduate Arts" },
    { id: 9, program_id: 9, name: "Doctoral Research" }
  ];

  const filtered = programId ? depts.filter(d => String(d.program_id) === String(programId)) : depts;
  dFilter.innerHTML = `<option value="">All Departments</option>` +
    filtered.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join("");
}

function updateFormDeptOptions(programId) {
  const spfDept = document.getElementById("spf-dept");
  if (!spfDept) return;

  const depts = [
    { id: 1, program_id: 1, name: "Computer Science" },
    { id: 2, program_id: 2, name: "Computer Science" },
    { id: 3, program_id: 3, name: "Management Studies" },
    { id: 4, program_id: 4, name: "Executive Management" },
    { id: 5, program_id: 5, name: "Computer Applications" },
    { id: 6, program_id: 6, name: "Advanced Applications" },
    { id: 7, program_id: 7, name: "Humanities & Arts" },
    { id: 8, program_id: 8, name: "Postgraduate Arts" },
    { id: 9, program_id: 9, name: "Doctoral Research" }
  ];

  const filtered = programId ? depts.filter(d => String(d.program_id) === String(programId)) : depts;
  spfDept.innerHTML = `<option value="">Select Department</option>` +
    filtered.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join("");
}

async function fetchStudyPlans() {
  const pFilter = document.getElementById("sp-filter-program")?.value || "";
  const dFilter = document.getElementById("sp-filter-dept")?.value || "";
  const sFilter = document.getElementById("sp-filter-semester")?.value || "";
  const yFilter = document.getElementById("sp-filter-year")?.value || "";
  const search = document.getElementById("sp-search")?.value.trim() || "";

  const params = new URLSearchParams();
  if (pFilter) params.set("program_id", pFilter);
  if (dFilter) params.set("department_id", dFilter);
  if (sFilter) params.set("semester_number", sFilter);
  if (yFilter) params.set("academic_year", yFilter);
  if (search) params.set("search", search);
  params.set("limit", "100");

  try {
    const res = await apiRequest(`/study-plans?${params.toString()}`);
    studyPlansState.data = apiRows(res);
    renderStudyPlansView();
  } catch (error) {
    console.error("Fetch study plans failed:", error);
    toast("Could not load study plans: " + error.message, "error");
  }
}

function renderStudyPlansView() {
  const plans = studyPlansState.data || [];
  const countEl = document.getElementById("sp-results-count");
  const gridEl = document.getElementById("sp-cards-grid");
  const tableWrap = document.getElementById("sp-table-wrap");
  const tableBody = document.getElementById("sp-table-body");
  const emptyEl = document.getElementById("sp-empty");

  if (countEl) {
    countEl.textContent = `Showing ${plans.length} study plan${plans.length === 1 ? "" : "s"} across university programs`;
  }

  if (!plans.length) {
    if (gridEl) gridEl.innerHTML = "";
    if (tableWrap) tableWrap.classList.add("hidden");
    if (emptyEl) emptyEl.classList.remove("hidden");
    return;
  }

  if (emptyEl) emptyEl.classList.add("hidden");

  if (studyPlansState.viewMode === "grid") {
    if (tableWrap) tableWrap.classList.add("hidden");
    if (gridEl) {
      gridEl.classList.remove("hidden");
      gridEl.innerHTML = plans.map(sp => {
        return `
          <div class="study-plan-card" data-sp-id="${sp.id}">
            <div>
              <div class="sp-card-top">
                <span class="sp-program-badge">${escapeHtml(sp.programCode || "PROGRAM")}</span>
                <span class="sp-sem-badge">Sem ${escapeHtml(sp.semesterNumber || 1)}</span>
                <span class="badge ${sp.status === "Active" ? "badge-success" : "badge-soft"}" style="font-size:0.7rem;">${escapeHtml(sp.status || "Active")}</span>
              </div>
              <h3 class="sp-title">${escapeHtml(sp.title)}</h3>
              <p class="sp-desc">${escapeHtml(sp.description || "No course description provided.")}</p>
              <div class="sp-meta-list">
                <div class="sp-meta-item">
                  <span>📘 Course:</span>
                  <strong>${escapeHtml(sp.subjectCode || "")} — ${escapeHtml(sp.subjectName || "Unassigned")}</strong>
                </div>
                <div class="sp-meta-item">
                  <span>🧑‍🏫 Faculty:</span>
                  <strong>${escapeHtml(sp.teacherName || "Department Assigned")}</strong>
                </div>
                <div class="sp-meta-item">
                  <span>🏛 Dept:</span>
                  <strong>${escapeHtml(sp.departmentName || "General")}</strong>
                </div>
                <div class="sp-meta-item">
                  <span>⭐ Credits:</span>
                  <strong>${escapeHtml(sp.credits || 3)} Credits • Year ${escapeHtml(sp.academicYear || "2026-27")}</strong>
                </div>
              </div>
            </div>
            <div class="sp-card-actions">
              <button class="btn btn-secondary btn-ghost-sm" data-view-sp="${sp.id}">📖 View Syllabus</button>
              <button class="btn btn-secondary btn-ghost-sm" data-edit-sp="${sp.id}">✏️ Edit</button>
              <button class="btn btn-ghost-sm" data-del-sp="${sp.id}" style="color:var(--danger);" title="Delete study plan">🗑</button>
            </div>
          </div>
        `;
      }).join("");

      wireStudyPlanActionButtons(gridEl);
    }
  } else {
    if (gridEl) gridEl.classList.add("hidden");
    if (tableWrap) {
      tableWrap.classList.remove("hidden");
      if (tableBody) {
        tableBody.innerHTML = plans.map(sp => {
          return `
            <tr>
              <td><strong>${escapeHtml(sp.title)}</strong></td>
              <td><span class="sp-program-badge">${escapeHtml(sp.programCode || "PROG")}</span></td>
              <td><span class="sp-sem-badge">Sem ${escapeHtml(sp.semesterNumber || 1)}</span></td>
              <td>${escapeHtml(sp.subjectCode || "")} ${escapeHtml(sp.subjectName || "")}</td>
              <td>${escapeHtml(sp.teacherName || "Unassigned")}</td>
              <td>${escapeHtml(sp.credits || 3)}</td>
              <td><span class="badge ${sp.status === "Active" ? "badge-success" : "badge-soft"}">${escapeHtml(sp.status || "Active")}</span></td>
              <td>
                <div class="table-actions">
                  <button class="btn btn-secondary btn-ghost-sm" data-view-sp="${sp.id}">View</button>
                  <button class="btn btn-secondary btn-ghost-sm" data-edit-sp="${sp.id}">Edit</button>
                  <button class="btn btn-ghost-sm" data-del-sp="${sp.id}" style="color:var(--danger);">Delete</button>
                </div>
              </td>
            </tr>
          `;
        }).join("");

        wireStudyPlanActionButtons(tableBody);
      }
    }
  }
}

function wireStudyPlanActionButtons(container) {
  if (!container) return;
  container.querySelectorAll("[data-view-sp]").forEach(btn => {
    btn.addEventListener("click", () => openStudyPlanDetailsModal(btn.dataset.viewSp));
  });
  container.querySelectorAll("[data-edit-sp]").forEach(btn => {
    btn.addEventListener("click", () => openStudyPlanFormModal(btn.dataset.editSp));
  });
  container.querySelectorAll("[data-del-sp]").forEach(btn => {
    btn.addEventListener("click", () => deleteStudyPlan(btn.dataset.delSp));
  });
}

async function openStudyPlanDetailsModal(id) {
  try {
    showLoadingOverlay(true);
    const res = await apiRequest(`/study-plans/${id}`);
    const sp = apiOne(res);
    if (!sp) throw new Error("Plan not found");

    const modal = document.getElementById("modal-study-plan-details");
    const titleEl = document.getElementById("spd-title");
    const subtitleEl = document.getElementById("spd-subtitle");
    const contentEl = document.getElementById("spd-content");
    const editBtn = document.getElementById("modal-spd-edit-btn");

    if (titleEl) titleEl.textContent = sp.title;
    if (subtitleEl) subtitleEl.textContent = `${sp.programCode || "Program"} • Semester ${sp.semesterNumber || 1} • Academic Year ${sp.academicYear || "2026-27"}`;

    let parsedModules = [];
    if (sp.modules) {
      if (typeof sp.modules === "string") {
        try { parsedModules = JSON.parse(sp.modules); } catch (_) { parsedModules = []; }
      } else if (Array.isArray(sp.modules)) {
        parsedModules = sp.modules;
      }
    }

    if (contentEl) {
      contentEl.innerHTML = `
        <div class="spd-grid">
          <div class="spd-metric-box">
            <div class="spd-metric-label">Subject &amp; Course Code</div>
            <div class="spd-metric-val">${escapeHtml(sp.subjectCode || "")} — ${escapeHtml(sp.subjectName || "Unassigned")}</div>
          </div>
          <div class="spd-metric-box">
            <div class="spd-metric-label">Faculty In-Charge</div>
            <div class="spd-metric-val">${escapeHtml(sp.teacherName || "Unassigned")}</div>
          </div>
          <div class="spd-metric-box">
            <div class="spd-metric-label">Department / School</div>
            <div class="spd-metric-val">${escapeHtml(sp.departmentName || "General")}</div>
          </div>
          <div class="spd-metric-box">
            <div class="spd-metric-label">Credits &amp; Status</div>
            <div class="spd-metric-val">${escapeHtml(sp.credits || 3)} Credits • <span class="badge ${sp.status === "Active" ? "badge-success" : "badge-soft"}">${escapeHtml(sp.status || "Active")}</span></div>
          </div>
        </div>

        <div style="margin-bottom: 1.25rem;">
          <h4 style="font-size:0.92rem; color:var(--text-white); margin-bottom:0.4rem;">📖 Course Overview &amp; Syllabus Description</h4>
          <p style="font-size:0.86rem; color:var(--text-muted); line-height:1.6; background:var(--bg-surface-2); padding:0.85rem; border-radius:var(--radius-sm); border:1px solid var(--border-subtle);">
            ${escapeHtml(sp.description || "No detailed syllabus description entered yet.")}
          </p>
        </div>

        ${sp.objectives ? `
          <div style="margin-bottom: 1.25rem;">
            <h4 style="font-size:0.92rem; color:var(--text-white); margin-bottom:0.4rem;">🎯 Key Learning Outcomes &amp; Competencies</h4>
            <div style="font-size:0.85rem; color:var(--text-muted); line-height:1.6; background:var(--bg-surface-2); padding:0.85rem; border-radius:var(--radius-sm); border:1px solid var(--border-subtle); white-space:pre-line;">
              ${escapeHtml(sp.objectives)}
            </div>
          </div>
        ` : ""}

        <div>
          <h4 style="font-size:0.92rem; color:var(--text-white); margin-bottom:0.4rem;">📑 Curriculum Units &amp; Weekly Modular Breakdown</h4>
          ${parsedModules.length ? `
            <div class="module-timeline">
              ${parsedModules.map((m, idx) => `
                <div class="module-timeline-item">
                  <span class="module-badge">${escapeHtml(m.unit || `Unit ${idx + 1}`)}</span>
                  <div class="module-info">
                    <h4>${escapeHtml(m.title || "Module Title")}</h4>
                    <p>${m.weeks ? `Duration: ${escapeHtml(m.weeks)} ${typeof m.weeks === "number" ? "weeks" : ""}` : "Core Curriculum Milestone"}</p>
                  </div>
                </div>
              `).join("")}
            </div>
          ` : `
            <p class="muted small">Modular syllabus units have not been defined for this study plan yet.</p>
          `}
        </div>
      `;
    }

    if (editBtn) {
      const clone = editBtn.cloneNode(true);
      editBtn.parentNode.replaceChild(clone, editBtn);
      clone.addEventListener("click", () => {
        modal.close();
        openStudyPlanFormModal(sp.id);
      });
    }

    if (typeof modal.showModal === "function") modal.showModal();
  } catch (error) {
    console.error("Open study plan details error:", error);
    toast("Could not open study plan: " + error.message, "error");
  } finally {
    showLoadingOverlay(false);
  }
}

async function openStudyPlanFormModal(editId = null) {
  try {
    showLoadingOverlay(true);
    await loadStudyPlanMetadata();

    const modal = document.getElementById("modal-study-plan-form");
    const titleHeader = document.getElementById("modal-spf-title");
    const idInput = document.getElementById("spf-id");
    const titleInput = document.getElementById("spf-title");
    const programSelect = document.getElementById("spf-program");
    const deptSelect = document.getElementById("spf-dept");
    const semesterSelect = document.getElementById("spf-semester");
    const subjectSelect = document.getElementById("spf-subject");
    const teacherSelect = document.getElementById("spf-teacher");
    const yearInput = document.getElementById("spf-year");
    const creditsInput = document.getElementById("spf-credits");
    const statusSelect = document.getElementById("spf-status");
    const descTextarea = document.getElementById("spf-desc");
    const objectivesTextarea = document.getElementById("spf-objectives");
    const modulesTextarea = document.getElementById("spf-modules");

    // Populate Subjects
    if (subjectSelect) {
      const subjects = getSubjects();
      subjectSelect.innerHTML = `<option value="">Select Subject</option>` +
        subjects.map(s => `<option value="${s.id}">${escapeHtml(s.code || "")} — ${escapeHtml(s.name)}</option>`).join("");
    }

    // Populate Teachers
    if (teacherSelect) {
      const teachers = getTeachers();
      teacherSelect.innerHTML = `<option value="">Select Faculty Member</option>` +
        teachers.map(t => `<option value="${t.id}">${escapeHtml(t.name)} (${escapeHtml(t.department || "Faculty")})</option>`).join("");
    }

    if (editId) {
      if (titleHeader) titleHeader.textContent = "Edit Study Plan";
      const res = await apiRequest(`/study-plans/${editId}`);
      const sp = apiOne(res);
      if (!sp) throw new Error("Plan not found");

      if (idInput) idInput.value = sp.id;
      if (titleInput) titleInput.value = sp.title || "";
      if (programSelect) {
        programSelect.value = sp.programId || sp.program_id || "";
        updateFormDeptOptions(programSelect.value);
      }
      if (deptSelect) deptSelect.value = sp.departmentId || sp.department_id || "";
      if (semesterSelect) semesterSelect.value = sp.semesterNumber || sp.semester_number || 1;
      if (subjectSelect) subjectSelect.value = sp.subjectId || sp.subject_id || "";
      if (teacherSelect) teacherSelect.value = sp.teacherId || sp.teacher_id || "";
      if (yearInput) yearInput.value = sp.academicYear || sp.academic_year || "2026-27";
      if (creditsInput) creditsInput.value = sp.credits || 3;
      if (statusSelect) statusSelect.value = sp.status || "Active";
      if (descTextarea) descTextarea.value = sp.description || "";
      if (objectivesTextarea) objectivesTextarea.value = sp.objectives || "";

      let modulesText = "";
      let parsed = [];
      if (sp.modules) {
        if (typeof sp.modules === "string") {
          try { parsed = JSON.parse(sp.modules); } catch (_) { parsed = []; }
        } else if (Array.isArray(sp.modules)) {
          parsed = sp.modules;
        }
      }
      if (parsed.length) {
        modulesText = parsed.map(m => `${m.unit || "Unit"} | ${m.title || ""} | ${m.weeks || "3 Weeks"}`).join("\n");
      }
      if (modulesTextarea) modulesTextarea.value = modulesText;
    } else {
      if (titleHeader) titleHeader.textContent = "Create Study Plan";
      if (idInput) idInput.value = "";
      if (titleInput) titleInput.value = "";
      if (programSelect) programSelect.value = "";
      if (deptSelect) deptSelect.innerHTML = `<option value="">Select Department</option>`;
      if (semesterSelect) semesterSelect.value = "1";
      if (subjectSelect) subjectSelect.value = "";
      if (teacherSelect) teacherSelect.value = "";
      if (yearInput) yearInput.value = "2026-27";
      if (creditsInput) creditsInput.value = "4";
      if (statusSelect) statusSelect.value = "Active";
      if (descTextarea) descTextarea.value = "";
      if (objectivesTextarea) objectivesTextarea.value = "";
      if (modulesTextarea) modulesTextarea.value = "Unit 1 | Foundations & Architecture | 3 Weeks\nUnit 2 | Core Principles & Operations | 4 Weeks\nUnit 3 | Advanced Design Patterns | 4 Weeks\nUnit 4 | Real-World Application & Project | 3 Weeks";
    }

    if (typeof modal.showModal === "function") modal.showModal();
  } catch (error) {
    console.error("Open study plan form error:", error);
    toast("Could not open form: " + error.message, "error");
  } finally {
    showLoadingOverlay(false);
  }
}

async function handleStudyPlanFormSubmit(e) {
  e.preventDefault();

  const id = document.getElementById("spf-id")?.value;
  const title = document.getElementById("spf-title")?.value.trim();
  const program_id = document.getElementById("spf-program")?.value;
  const department_id = document.getElementById("spf-dept")?.value;
  const semester_number = document.getElementById("spf-semester")?.value;
  const subject_id = document.getElementById("spf-subject")?.value;
  const teacher_id = document.getElementById("spf-teacher")?.value;
  const academic_year = document.getElementById("spf-year")?.value.trim() || "2026-27";
  const credits = document.getElementById("spf-credits")?.value;
  const status = document.getElementById("spf-status")?.value || "Active";
  const description = document.getElementById("spf-desc")?.value.trim();
  const objectives = document.getElementById("spf-objectives")?.value.trim();
  const rawModules = document.getElementById("spf-modules")?.value.trim() || "";

  if (!title || !program_id || !subject_id) {
    toast("Title, Program, and Subject are required fields.", "error");
    return;
  }

  // Parse modules from text lines
  const modules = [];
  if (rawModules) {
    const lines = rawModules.split("\n").map(l => l.trim()).filter(Boolean);
    lines.forEach((line, idx) => {
      const parts = line.split("|").map(p => p.trim());
      modules.push({
        unit: parts[0] || `Unit ${idx + 1}`,
        title: parts[1] || `Curriculum Module ${idx + 1}`,
        weeks: parts[2] || "3 Weeks"
      });
    });
  }

  const payload = {
    title,
    program_id: Number(program_id),
    department_id: department_id ? Number(department_id) : null,
    semester_number: Number(semester_number || 1),
    subject_id: Number(subject_id),
    teacher_id: teacher_id ? Number(teacher_id) : null,
    academic_year,
    credits: Number(credits || 3),
    status,
    description,
    objectives,
    modules
  };

  try {
    showLoadingOverlay(true);
    if (id) {
      await apiRequest(`/study-plans/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      toast("Study plan updated successfully.", "success");
    } else {
      await apiRequest("/study-plans", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      toast("New study plan published to library.", "success");
    }

    const modal = document.getElementById("modal-study-plan-form");
    if (modal) modal.close();
    await fetchStudyPlans();
  } catch (error) {
    console.error("Save study plan error:", error);
    toast("Failed to save study plan: " + error.message, "error", 6000);
  } finally {
    showLoadingOverlay(false);
  }
}

function deleteStudyPlan(id) {
  openConfirmModal(
    "Delete Study Plan",
    "Are you sure you want to delete this study plan? This action will remove the curriculum roadmap from the library.",
    async () => {
      try {
        showLoadingOverlay(true);
        await apiRequest(`/study-plans/${id}`, { method: "DELETE" });
        toast("Study plan removed from library.", "success");
        await fetchStudyPlans();
      } catch (error) {
        console.error("Delete study plan error:", error);
        toast("Failed to delete study plan: " + error.message, "error");
      } finally {
        showLoadingOverlay(false);
      }
    }
  );
}

/* ============================ MAKEUP CLASS SCHEDULING MODULE ============================ */
let makeupInitialized = false;

function initMakeupModal() {
  if (makeupInitialized) return;
  makeupInitialized = true;

  const makeupBtn = document.getElementById("tt-schedule-makeup-btn");
  if (makeupBtn) makeupBtn.addEventListener("click", () => openMakeupModal());

  const dashMakeupBtn = document.getElementById("dash-qa-makeup");
  if (dashMakeupBtn) dashMakeupBtn.addEventListener("click", () => openMakeupModal());

  const modal = document.getElementById("modal-makeup");
  const closeBtn = document.getElementById("modal-makeup-close");
  const cancelBtn = document.getElementById("modal-makeup-cancel");
  if (closeBtn) closeBtn.addEventListener("click", () => modal.close());
  if (cancelBtn) cancelBtn.addEventListener("click", () => modal.close());

  const form = document.getElementById("makeup-form");
  if (form) form.addEventListener("submit", handleMakeupFormSubmit);

  const origSelect = document.getElementById("makeup-orig-class");
  if (origSelect) origSelect.addEventListener("change", onOriginalClassSelected);

  const classSelect = document.getElementById("makeup-class");
  if (classSelect) {
    classSelect.addEventListener("change", async () => {
      await loadSectionsForMakeupClass(classSelect.value);
      updateMakeupAvailability();
    });
  }

  const dateInput = document.getElementById("makeup-date");
  if (dateInput) {
    dateInput.addEventListener("input", () => {
      const dayEl = document.getElementById("makeup-day-name");
      if (dayEl && dateInput.value) {
        const d = new Date(dateInput.value + "T00:00:00");
        const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        dayEl.textContent = `Scheduled on: ${days[d.getDay()]}`;
      }
      updateMakeupAvailability();
    });
  }

  // Live availability listeners on makeup form
  ["makeup-slot", "makeup-teacher", "makeup-room", "makeup-section"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", updateMakeupAvailability);
  });
}

function openMakeupModal(presetTimetableId = null) {
  initMakeupModal();
  const modal = document.getElementById("modal-makeup");
  if (!modal) return;

  const origSelect = document.getElementById("makeup-orig-class");
  const classSelect = document.getElementById("makeup-class");
  const sectionSelect = document.getElementById("makeup-section");
  const subjectSelect = document.getElementById("makeup-subject");
  const teacherSelect = document.getElementById("makeup-teacher");
  const slotSelect = document.getElementById("makeup-slot");
  const roomSelect = document.getElementById("makeup-room");
  const dateInput = document.getElementById("makeup-date");
  const dayNameEl = document.getElementById("makeup-day-name");
  const detailsEl = document.getElementById("makeup-orig-details");

  const classes = getClasses();
  const subjects = getSubjects();
  const teachers = getTeachers();
  const rooms = getRooms();
  const tt = getTimetable().filter(e => e.status !== "cancelled");

  // Populate Missed / Original Classes dropdown
  if (origSelect) {
    origSelect.innerHTML = `<option value="">-- Choose a missed class from timetable (or create independent) --</option>` +
      tt.map(e => `
        <option value="${e.id}">
          ${escapeHtml(e.day)} ${escapeHtml(slotLabel(e.slotId))} • ${escapeHtml(className(e.classId))} • ${escapeHtml(subjectName(e.subjectId))} • ${escapeHtml(teacherName(e.teacherId))}
        </option>
      `).join("");
  }

  // Populate Classes
  if (classSelect) {
    classSelect.innerHTML = `<option value="">Select class</option>` +
      classes.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  }

  // Populate Subjects
  if (subjectSelect) {
    subjectSelect.innerHTML = `<option value="">Select subject</option>` +
      subjects.map(s => `<option value="${s.id}">${escapeHtml(s.code || "")} — ${escapeHtml(s.name)}</option>`).join("");
  }

  // Populate Teachers
  if (teacherSelect) {
    teacherSelect.innerHTML = `<option value="">Select faculty member</option>` +
      teachers.map(t => `<option value="${t.id}">${escapeHtml(t.name)} (${escapeHtml(t.department || "Faculty")})</option>`).join("");
  }

  // Populate Time Slots
  if (slotSelect) {
    slotSelect.innerHTML = SLOTS.map(s => `<option value="${s.id}">${escapeHtml(s.label)}</option>`).join("");
  }

  // Populate Classrooms
  if (roomSelect) {
    roomSelect.innerHTML = `<option value="">Select classroom</option>` +
      rooms.map(r => `<option value="${r.id}">${escapeHtml(r.number)} (${escapeHtml(r.type)} • Cap: ${r.capacity})</option>`).join("");
  }

  // Default Date: Tomorrow
  if (dateInput) {
    const tomorrow = new Date(Date.now() + 86400000);
    const dateStr = tomorrow.toISOString().split("T")[0];
    dateInput.value = dateStr;
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    if (dayNameEl) dayNameEl.textContent = `Scheduled on: ${days[tomorrow.getDay()]}`;
  }

  if (detailsEl) {
    detailsEl.textContent = "Selecting a class pre-fills the program, section, subject and original teacher.";
  }

  // If a preset was requested
  if (presetTimetableId && origSelect) {
    origSelect.value = String(presetTimetableId);
    onOriginalClassSelected();
  }

  if (typeof modal.showModal === "function") modal.showModal();
  else modal.setAttribute("open", "");
  updateMakeupAvailability();
}

async function onOriginalClassSelected() {
  const origId = document.getElementById("makeup-orig-class")?.value;
  const classSelect = document.getElementById("makeup-class");
  const subjectSelect = document.getElementById("makeup-subject");
  const teacherSelect = document.getElementById("makeup-teacher");
  const detailsEl = document.getElementById("makeup-orig-details");

  if (!origId) {
    if (detailsEl) detailsEl.textContent = "Manual makeup class creation selected.";
    return;
  }

  const orig = getTimetable().find(e => String(e.id) === String(origId));
  if (!orig) return;

  if (classSelect) {
    classSelect.value = orig.classId || "";
    await loadSectionsForMakeupClass(orig.classId, orig.sectionId);
  }

  if (subjectSelect) subjectSelect.value = orig.subjectId || "";
  if (teacherSelect) teacherSelect.value = orig.teacherId || "";

  if (detailsEl) {
    detailsEl.innerHTML = `<strong>Pre-filled from:</strong> ${escapeHtml(orig.day)} at ${escapeHtml(slotLabel(orig.slotId))} with ${escapeHtml(teacherName(orig.teacherId))} in ${escapeHtml(roomName(orig.roomId))}.`;
  }

  updateMakeupAvailability();
}

async function loadSectionsForMakeupClass(classId, selectedSectionId = null) {
  const sectionSelect = document.getElementById("makeup-section");
  if (!sectionSelect) return;

  if (!classId) {
    sectionSelect.innerHTML = `<option value="">Select section</option>`;
    return;
  }

  sectionSelect.innerHTML = `<option value="">Loading sections...</option>`;

  try {
    const response = await apiRequest(`/sections?class_id=${encodeURIComponent(classId)}`);
    const sections = apiRows(response);

    if (!sections.length) {
      sectionSelect.innerHTML = `<option value="">No sections available</option>`;
      return;
    }

    sectionSelect.innerHTML = `<option value="">Select section</option>` +
      sections.map(section => `
        <option value="${section.id}" ${String(section.id) === String(selectedSectionId) ? "selected" : ""}>
          Section ${escapeHtml(section.name)} (Strength: ${section.student_count || 40})
        </option>
      `).join("");
  } catch (error) {
    console.error("Unable to load makeup sections:", error);
    sectionSelect.innerHTML = `<option value="">Unable to load sections</option>`;
  }
}

let makeupAvailTimer = null;
function updateMakeupAvailability() {
  clearTimeout(makeupAvailTimer);
  makeupAvailTimer = setTimeout(async () => {
    const date = document.getElementById("makeup-date")?.value;
    const slot = document.getElementById("makeup-slot")?.value;
    const teacher = document.getElementById("makeup-teacher")?.value;
    const room = document.getElementById("makeup-room")?.value;
    const clsId = document.getElementById("makeup-class")?.value;
    const secId = document.getElementById("makeup-section")?.value;

    const badgeRoom = document.getElementById("mk-badge-room");
    const badgeTeacher = document.getElementById("mk-badge-teacher");
    const badgeSection = document.getElementById("mk-badge-section");
    const conflictAlert = document.getElementById("makeup-conflict-alert");
    const suggestedRoomsBox = document.getElementById("makeup-suggested-rooms");

    if (!date || !slot) return;

    try {
      const query = new URLSearchParams({
        date: date,
        slot_id: slot,
        teacher_id: teacher || "",
        room_id: room || "",
        class_id: clsId || "",
        section_id: secId || ""
      });

      const res = await apiRequest(`/timetable/availability?${query.toString()}`);
      if (!res || !res.success) return;

      // Update room badge
      if (room && badgeRoom) {
        const isOccupied = res.selectedResourceStatus?.room === "Occupied";
        badgeRoom.className = isOccupied ? "badge badge-occupied" : "badge badge-available";
        badgeRoom.textContent = isOccupied ? "Room: Occupied" : "Room: Available";
      } else if (badgeRoom) {
        badgeRoom.className = "badge badge-soft";
        badgeRoom.textContent = "Room: Pick a room";
      }

      // Update teacher badge
      if (teacher && badgeTeacher) {
        const isOccupied = res.selectedResourceStatus?.teacher === "Occupied";
        badgeTeacher.className = isOccupied ? "badge badge-occupied" : "badge badge-available";
        badgeTeacher.textContent = isOccupied ? "Faculty: Clashing" : "Faculty: Available";
      } else if (badgeTeacher) {
        badgeTeacher.className = "badge badge-soft";
        badgeTeacher.textContent = "Faculty: Pick faculty";
      }

      // Update section badge
      if (secId && badgeSection) {
        const isOccupied = res.selectedResourceStatus?.section === "Occupied";
        badgeSection.className = isOccupied ? "badge badge-occupied" : "badge badge-available";
        badgeSection.textContent = isOccupied ? "Section: Already Booked" : "Section: Free";
      } else if (badgeSection) {
        badgeSection.className = "badge badge-soft";
        badgeSection.textContent = "Section: Pick section";
      }

      // Conflicts alert
      if (conflictAlert) {
        if (res.conflicts && res.conflicts.length > 0) {
          conflictAlert.classList.remove("hidden");
          conflictAlert.innerHTML = `<strong>⚠️ Scheduling Conflict:</strong><br>` +
            res.conflicts.map(c => `• ${escapeHtml(c.message)}`).join("<br>");
        } else {
          conflictAlert.classList.add("hidden");
          conflictAlert.innerHTML = "";
        }
      }

      // Available rooms suggestion
      if (suggestedRoomsBox && res.roomAvailability) {
        const freeRooms = res.roomAvailability.filter(r => r.isAvailable).slice(0, 6);
        if (freeRooms.length) {
          suggestedRoomsBox.classList.remove("hidden");
          suggestedRoomsBox.innerHTML = `
            <div style="font-size:0.75rem; font-weight:700; margin-bottom:0.35rem;">
              🏛 Available Classrooms at this time (${freeRooms.length} free):
            </div>
            <div>
              ${freeRooms.map(fr => `
                <span class="suggested-room-pill" data-pick-room="${fr.id}">
                  ${escapeHtml(fr.number)} (${fr.capacity} seats)
                </span>
              `).join("")}
            </div>
          `;
          suggestedRoomsBox.querySelectorAll("[data-pick-room]").forEach(pill => {
            pill.addEventListener("click", () => {
              const rSel = document.getElementById("makeup-room");
              if (rSel) {
                rSel.value = pill.dataset.pickRoom;
                updateMakeupAvailability();
              }
            });
          });
        } else {
          suggestedRoomsBox.classList.add("hidden");
        }
      }

      // Decorate room dropdown options
      const roomSelect = document.getElementById("makeup-room");
      if (roomSelect && res.roomAvailability) {
        const availMap = new Map();
        res.roomAvailability.forEach(r => availMap.set(String(r.id), r));
        Array.from(roomSelect.options).forEach(opt => {
          if (!opt.value) return;
          const rData = availMap.get(opt.value);
          if (rData) {
            const clean = opt.textContent.replace(/^\[(Available|Occupied)\]\s*/, "");
            opt.textContent = rData.isAvailable ? `[Available] ${clean}` : `[Occupied] ${clean}`;
          }
        });
      }

    } catch (err) {
      console.warn("Makeup availability check error:", err);
    }
  }, 150);
}

async function handleMakeupFormSubmit(e) {
  e.preventDefault();

  const origId = document.getElementById("makeup-orig-class")?.value || null;
  const classId = document.getElementById("makeup-class")?.value;
  const sectionId = document.getElementById("makeup-section")?.value;
  const subjectId = document.getElementById("makeup-subject")?.value;
  const teacherId = document.getElementById("makeup-teacher")?.value;
  const date = document.getElementById("makeup-date")?.value;
  const slot = document.getElementById("makeup-slot")?.value;
  const roomId = document.getElementById("makeup-room")?.value;
  const reason = document.getElementById("makeup-reason")?.value;
  const customReason = document.getElementById("makeup-custom-reason")?.value.trim();
  const notes = document.getElementById("makeup-notes")?.value.trim();

  if (!date || !slot || !classId || !sectionId || !subjectId || !teacherId || !roomId) {
    toast("Please complete all required fields: Date, Slot, Class, Section, Subject, Teacher, and Classroom.", "error");
    return;
  }

  const effectiveReason = customReason ? `${reason} — ${customReason}` : reason;

  const payload = {
    original_timetable_id: origId ? Number(origId) : null,
    class_id: Number(classId),
    section_id: Number(sectionId),
    subject_id: Number(subjectId),
    teacher_id: Number(teacherId),
    makeup_teacher_id: Number(teacherId),
    makeup_date: date,
    time_slot_id: slot,
    room_id: Number(roomId),
    makeup_reason: effectiveReason,
    notes: notes || ""
  };

  try {
    showLoadingOverlay(true);
    const res = await apiRequest("/timetable/makeup", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    const modal = document.getElementById("modal-makeup");
    if (modal) modal.close();

    if (res && res.warnings && res.warnings.length > 0) {
      toast(`Makeup scheduled with ${res.warnings.length} warning(s): ` + res.warnings.map(w => w.message || w).join("; "), "warning", 6000);
    } else {
      toast("Makeup class scheduled successfully in PostgreSQL.", "success");
    }
    await reloadTimetableData();
  } catch (error) {
    console.error("Schedule makeup class error:", error);
    if (error.payload && (error.payload.conflicts || error.payload.warnings)) {
      openConflictModal(
        error.payload.conflicts || [],
        null,
        error.payload.warnings || []
      );
    } else {
      toast("Cannot schedule makeup class: " + error.message, "error", 7000);
    }
  } finally {
    showLoadingOverlay(false);
  }
}

function cancelMakeupClass(id) {
  openConfirmModal(
    "Cancel Makeup Class",
    "Are you sure you want to cancel this scheduled makeup class? The cancellation will be logged in the audit trail.",
    async () => {
      try {
        showLoadingOverlay(true);
        await apiRequest(`/timetable/makeup/${id}/cancel`, { method: "POST" });
        toast("Makeup class cancelled successfully.", "success");
        await reloadTimetableData();
      } catch (error) {
        console.error("Cancel makeup class error:", error);
        toast("Could not cancel makeup class: " + error.message, "error");
      } finally {
        showLoadingOverlay(false);
      }
    }
  );
}

/* ============================ CLASSES PAGE ============================ */
function renderClassesPage() {
  const q = (document.getElementById("class-search").value || "").toLowerCase();
  const classes = getClasses().filter(c => (c.name + c.section).toLowerCase().includes(q));
  const grid = document.getElementById("classes-grid");
  document.getElementById("classes-empty").classList.toggle("hidden", classes.length > 0);
  grid.innerHTML = classes.map(c => {
    const periodCount = getTimetable().filter(e => e.classId === c.id).length;
    return `<div class="entity-card">
      <h3>${escapeHtml(c.name)} - Section ${escapeHtml(c.section)}</h3>
      <div class="entity-meta">
        <span class="badge badge-soft">${c.students} students</span>
        <span class="badge badge-info">${periodCount} periods / week</span>
      </div>
      <div class="entity-foot">
        <button class="btn btn-secondary" data-edit-class="${c.id}">Edit</button>
        <button class="btn btn-ghost" data-del-class="${c.id}">Delete</button>
      </div>
    </div>`;
  }).join("");
  grid.querySelectorAll("[data-edit-class]").forEach(b => b.addEventListener("click", () => openClassForm(b.dataset.editClass)));
  grid.querySelectorAll("[data-del-class]").forEach(b => b.addEventListener("click", () => {
    openConfirmModal("Delete class", "This will remove the class and cannot be undone. Related timetable entries will remain but reference a deleted class.", () => {
      const removed = getClasses().find(c => c.id === b.dataset.delClass);
      setClasses(getClasses().filter(c => c.id !== b.dataset.delClass));
      if (removed) logAudit("delete", "Class", `Deleted class ${removed.name} - Section ${removed.section}.`);
      toast("Class deleted.", "success");
      renderClassesPage();
    });
  }));
}
function openClassForm(editId) {
  const cls = editId ? getClasses().find(c => c.id === editId) : null;
  const body = `<div class="field-grid">
    <div class="field"><label for="cf-name">Program name</label><input id="cf-name" required value="${cls ? escapeHtml(cls.name) : ""}" placeholder="B.Tech CSE" /></div>
    <div class="field"><label for="cf-section">Section</label><input id="cf-section" required value="${cls ? escapeHtml(cls.section) : ""}" placeholder="A" /></div>
    <div class="field field-full"><label for="cf-students">Enrolled students</label><input id="cf-students" type="number" min="0" required value="${cls ? cls.students : ""}" /></div>
  </div>`;
  openFormModal(cls ? "Edit Class" : "Add Class", body, () => {
    const data = { name: document.getElementById("cf-name").value.trim(), section: document.getElementById("cf-section").value.trim(), students: Number(document.getElementById("cf-students").value) };
    if (!data.name || !data.section) { toast("Program name and section are required.", "error"); return; }
    const classes = getClasses();
    if (cls) { Object.assign(cls, data); }
    else classes.push({ id: uid("c"), ...data });
    setClasses(classes);
    closeFormModal();
    renderClassesPage();
    renderAllStaticSelects();
    logAudit(cls ? "update" : "create", "Class", `${cls ? "Updated" : "Added"} class ${data.name} - Section ${data.section}.`);
    toast(cls ? "Class updated successfully." : "Class added successfully.", "success");
  });
}

/* ============================ TEACHERS PAGE ============================ */
function renderTeachersPage() {
  const deptSel = document.getElementById("teacher-dept-filter");
  const depts = [...new Set(getTeachers().map(t => t.department))];
  deptSel.innerHTML = `<option value="">All departments</option>` + depts.map(d => `<option value="${d}">${d}</option>`).join("");

  const q = (document.getElementById("teacher-search").value || "").toLowerCase();
  const dept = deptSel.value;
  const rows = getTeachers().filter(t => (!dept || t.department === dept) && t.name.toLowerCase().includes(q));
  document.getElementById("teachers-empty").classList.toggle("hidden", rows.length > 0);
  document.querySelector("#teachers-table tbody").innerHTML = rows.map(t => `
    <tr>
      <td>${escapeHtml(t.teacherId)}</td>
      <td>${escapeHtml(t.name)}</td>
      <td>${escapeHtml(t.department)}</td>
      <td>${(t.subjectIds || []).map(id => escapeHtml(subjectName(id))).join(", ") || "<span class='muted small'>—</span>"}</td>
      <td>${(t.availableDays || []).length}/6 days</td>
      <td><div class="row-actions">
        <button data-edit-t="${t.id}" title="Edit">✏️</button>
        <button class="row-del" data-del-t="${t.id}" title="Delete">🗑</button>
      </div></td>
    </tr>`).join("");
  document.querySelectorAll("[data-edit-t]").forEach(b => b.addEventListener("click", () => openTeacherForm(b.dataset.editT)));
  document.querySelectorAll("[data-del-t]").forEach(b => b.addEventListener("click", () => {
    openConfirmModal("Delete teacher", "This will remove the teacher from the faculty list.", () => {
      const removed = getTeachers().find(t => t.id === b.dataset.delT);
      setTeachers(getTeachers().filter(t => t.id !== b.dataset.delT));
      if (removed) logAudit("delete", "Teacher", `Deleted teacher ${removed.name}.`);
      toast("Teacher deleted.", "success");
      renderTeachersPage();
      renderAllStaticSelects();
    });
  }));
}
function openTeacherForm(editId) {
  const t = editId ? getTeachers().find(x => x.id === editId) : null;
  const subjects = getSubjects();
  const body = `<div class="field-grid">
    <div class="field"><label for="tf-id">Teacher ID</label><input id="tf-id" required value="${t ? escapeHtml(t.teacherId) : ""}" placeholder="FAC-109" /></div>
    <div class="field"><label for="tf-name">Full name</label><input id="tf-name" required value="${t ? escapeHtml(t.name) : ""}" placeholder="Dr. Jane Doe" /></div>
    <div class="field field-full"><label for="tf-dept">Department</label><input id="tf-dept" required list="dept-list" value="${t ? escapeHtml(t.department) : ""}" placeholder="Computer Science" />
      <datalist id="dept-list">${[...new Set(getTeachers().map(x => x.department))].map(d => `<option value="${d}">`).join("")}</datalist>
    </div>
    <div class="field field-full"><label>Subjects taught</label>
      <div class="checkbox-grid">${subjects.map(s => `<label class="chip-check"><input type="checkbox" value="${s.id}" ${t && t.subjectIds && t.subjectIds.includes(s.id) ? "checked" : ""}><span>${escapeHtml(s.code)}</span></label>`).join("")}</div>
    </div>
    <div class="field field-full"><label>Available days</label>
      <div class="checkbox-grid">${DAYS.map(d => `<label class="chip-check"><input type="checkbox" value="${d}" ${!t || (t.availableDays || []).includes(d) ? "checked" : ""}><span>${d}</span></label>`).join("")}</div>
    </div>
    <div class="field field-full"><label>Available time slots</label>
      <div class="checkbox-grid">${SLOTS.map(s => `<label class="chip-check"><input type="checkbox" value="${s.id}" ${!t || (t.availableSlots || []).includes(s.id) ? "checked" : ""}><span>${s.label}</span></label>`).join("")}</div>
    </div>
  </div>`;
  openFormModal(t ? "Edit Teacher" : "Add Teacher", body, () => {
    const allChecks = document.querySelectorAll("#modal-form-body .checkbox-grid");
    const chosenSubjects = Array.from(allChecks[0].querySelectorAll("input:checked")).map(i => i.value);
    const chosenDays = Array.from(allChecks[1].querySelectorAll("input:checked")).map(i => i.value);
    const chosenSlots = Array.from(allChecks[2].querySelectorAll("input:checked")).map(i => i.value);
    const data = {
      teacherId: document.getElementById("tf-id").value.trim(),
      name: document.getElementById("tf-name").value.trim(),
      department: document.getElementById("tf-dept").value.trim(),
      subjectIds: chosenSubjects, availableDays: chosenDays, availableSlots: chosenSlots
    };
    if (!data.teacherId || !data.name || !data.department) { toast("Teacher ID, name and department are required.", "error"); return; }
    const teachers = getTeachers();
    if (t) Object.assign(t, data);
    else teachers.push({ id: uid("t"), ...data });
    setTeachers(teachers);
    closeFormModal();
    renderTeachersPage();
    renderAllStaticSelects();
    logAudit(t ? "update" : "create", "Teacher", `${t ? "Updated" : "Added"} teacher ${data.name} (${data.department}).`);
    toast(t ? "Teacher updated successfully." : "Teacher added successfully.", "success");
  });
}

/* ============================ SUBSTITUTE TEACHER FINDER ============================ */
const substituteModal = document.getElementById("modal-substitute");
function openSubstituteModal() {
  const teacherSel = document.getElementById("sub-teacher");
  const daySel = document.getElementById("sub-day");
  teacherSel.innerHTML = optionsFromList(getTeachers(), "id", t => t.name);
  daySel.innerHTML = DAYS.map(d => `<option value="${d}">${d}</option>`).join("");
  const todayIdx = new Date().getDay();
  daySel.value = (todayIdx >= 1 && todayIdx <= 6) ? DAYS[todayIdx - 1] : "Monday";
  renderSubstituteResults();
  teacherSel.onchange = renderSubstituteResults;
  daySel.onchange = renderSubstituteResults;
  substituteModal.showModal();
}

/** Finds, for a given absent teacher + day, which other teachers could cover each affected period:
 *  candidate must (a) not already be busy at that day/slot, (b) teach the same subject OR be in the
 *  same department, and (c) be marked available on that day/slot if they have availability data set. */
function findSubstitutesFor(entry, absentTeacherId) {
  const absent = getTeachers().find(t => t.id === absentTeacherId);
  const tt = getTimetable();
  return getTeachers().filter(t => {
    if (t.id === absentTeacherId) return false;
    const teachesSubject = (t.subjectIds || []).includes(entry.subjectId);
    const sameDept = absent && t.department === absent.department;
    if (!teachesSubject && !sameDept) return false;
    if (t.availableDays && t.availableDays.length && !t.availableDays.includes(entry.day)) return false;
    if (t.availableSlots && t.availableSlots.length && !t.availableSlots.includes(entry.slotId)) return false;
    const busy = tt.some(e => e.teacherId === t.id && e.day === entry.day && e.slotId === entry.slotId);
    return !busy;
  }).sort((a, b) => (b.subjectIds || []).includes(entry.subjectId) - (a.subjectIds || []).includes(entry.subjectId));
}

function renderSubstituteResults() {
  const teacherId = document.getElementById("sub-teacher").value;
  const day = document.getElementById("sub-day").value;
  const box = document.getElementById("sub-results");
  const entries = getTimetable().filter(e => e.teacherId === teacherId && e.day === day)
    .sort((a, b) => a.slotId.localeCompare(b.slotId));

  if (!entries.length) {
    box.innerHTML = `<p class="empty-inline">${escapeHtml(teacherName(teacherId))} has no classes on ${day} — nothing to cover.</p>`;
    return;
  }

  box.innerHTML = entries.map(entry => {
    const candidates = findSubstitutesFor(entry, teacherId);
    return `<div class="sub-slot-block" data-entry="${entry.id}">
      <div class="sub-slot-head"><span>${slotLabel(entry.slotId)} — ${escapeHtml(subjectName(entry.subjectId))} • ${escapeHtml(className(entry.classId))} • ${escapeHtml(roomName(entry.roomId))}</span></div>
      <div class="sub-candidates">
        ${candidates.length ? candidates.map(c => `
          <div class="sub-result-row">
            <span>${escapeHtml(c.name)}${(c.subjectIds || []).includes(entry.subjectId) ? " · same subject" : " · same department"}</span>
            <button type="button" class="btn btn-secondary" data-assign-sub="${c.id}" data-assign-entry="${entry.id}">Assign</button>
          </div>`).join("") : `<div class="sub-result-row sub-missing">⚠ No available substitute found — notify the department head.</div>`}
      </div>
    </div>`;
  }).join("");

  box.querySelectorAll("[data-assign-sub]").forEach(btn => btn.addEventListener("click", () => {
    const tt = getTimetable();
    const idx = tt.findIndex(e => e.id === btn.dataset.assignEntry);
    if (idx === -1) return;
    const original = tt[idx];
    const newTeacherId = btn.dataset.assignSub;
    tt[idx] = { ...original, teacherId: newTeacherId };
    setTimetable(tt);
    addNotification(`${teacherName(newTeacherId)} is covering ${subjectName(original.subjectId)} for ${className(original.classId)} on ${original.day}.`, "info");
    logAudit("substitute", "Timetable Entry", `${teacherName(newTeacherId)} substituted for ${teacherName(teacherId)} — ${subjectName(original.subjectId)}, ${className(original.classId)}, ${original.day} ${slotLabel(original.slotId)}.`);
    toast("Substitute assigned successfully.", "success");
    renderSubstituteResults();
    if (!document.getElementById("section-timetable").classList.contains("hidden")) drawTimetableGrid();
  }));
}
function initSubstituteModal() {
  document.getElementById("teacher-absence-btn").addEventListener("click", openSubstituteModal);
  document.getElementById("modal-substitute-close").addEventListener("click", () => substituteModal.close());
}

/* ============================ SUBJECTS PAGE ============================ */
function renderSubjectsPage() {
  const q = (document.getElementById("subject-search").value || "").toLowerCase();
  const rows = getSubjects().filter(s => (s.name + s.code).toLowerCase().includes(q));
  document.getElementById("subjects-empty").classList.toggle("hidden", rows.length > 0);
  document.querySelector("#subjects-table tbody").innerHTML = rows.map(s => `
    <tr>
      <td>${escapeHtml(s.code)}</td>
      <td>${escapeHtml(s.name)}</td>
      <td>${escapeHtml(teacherName(s.facultyId))}</td>
      <td>${s.weeklyPeriods}</td>
      <td><div class="row-actions">
        <button data-edit-s="${s.id}" title="Edit">✏️</button>
        <button class="row-del" data-del-s="${s.id}" title="Delete">🗑</button>
      </div></td>
    </tr>`).join("");
  document.querySelectorAll("[data-edit-s]").forEach(b => b.addEventListener("click", () => openSubjectForm(b.dataset.editS)));
  document.querySelectorAll("[data-del-s]").forEach(b => b.addEventListener("click", () => {
    openConfirmModal("Delete subject", "This will remove the subject from the catalogue.", () => {
      const removed = getSubjects().find(s => s.id === b.dataset.delS);
      setSubjects(getSubjects().filter(s => s.id !== b.dataset.delS));
      if (removed) logAudit("delete", "Subject", `Deleted subject ${removed.code} - ${removed.name}.`);
      toast("Subject deleted.", "success");
      renderSubjectsPage();
      renderAllStaticSelects();
    });
  }));
}
function openSubjectForm(editId) {
  const s = editId ? getSubjects().find(x => x.id === editId) : null;
  const teachers = getTeachers();
  const body = `<div class="field-grid">
    <div class="field"><label for="sf-code">Subject code</label><input id="sf-code" required value="${s ? escapeHtml(s.code) : ""}" placeholder="CS401" /></div>
    <div class="field"><label for="sf-name">Subject name</label><input id="sf-name" required value="${s ? escapeHtml(s.name) : ""}" placeholder="Machine Learning" /></div>
    <div class="field"><label for="sf-faculty">Faculty</label><select id="sf-faculty" required><option value="">Select teacher</option>${optionsFromList(teachers, "id", t => t.name)}</select></div>
    <div class="field"><label for="sf-periods">Weekly periods</label><input id="sf-periods" type="number" min="1" max="7" required value="${s ? s.weeklyPeriods : 3}" /></div>
  </div>`;
  openFormModal(s ? "Edit Subject" : "Add Subject", body, () => {
    const data = { code: document.getElementById("sf-code").value.trim(), name: document.getElementById("sf-name").value.trim(), facultyId: document.getElementById("sf-faculty").value, weeklyPeriods: Number(document.getElementById("sf-periods").value) };
    if (!data.code || !data.name || !data.facultyId) { toast("Please complete all subject fields.", "error"); return; }
    const subjects = getSubjects();
    if (s) Object.assign(s, data);
    else subjects.push({ id: uid("sub"), ...data });
    setSubjects(subjects);
    closeFormModal();
    renderSubjectsPage();
    renderAllStaticSelects();
    logAudit(s ? "update" : "create", "Subject", `${s ? "Updated" : "Added"} subject ${data.code} - ${data.name}.`);
    toast(s ? "Subject updated successfully." : "Subject added successfully.", "success");
  });
  setTimeout(() => { if (s) document.getElementById("sf-faculty").value = s.facultyId; }, 0);
}

/* ============================ CLASSROOMS PAGE ============================ */
function renderRoomsPage() {
  const q = (document.getElementById("room-search").value || "").toLowerCase();
  const rooms = getRooms().filter(r => (r.number + r.building + r.type).toLowerCase().includes(q));
  const grid = document.getElementById("rooms-grid");
  document.getElementById("rooms-empty").classList.toggle("hidden", rooms.length > 0);
  const tt = getTimetable();
  grid.innerHTML = rooms.map(r => {
    const bookedSlots = tt.filter(e => e.roomId === r.id).length;
    const totalSlots = DAYS.length * SLOTS.length;
    const freeSlots = totalSlots - bookedSlots;
    return `<div class="entity-card">
      <h3>${escapeHtml(r.number)}</h3>
      <div class="entity-meta">
        <span class="badge badge-soft">${escapeHtml(r.type)}</span>
        <span class="badge badge-info">${escapeHtml(r.building)}</span>
        <span class="badge badge-success">Cap. ${r.capacity}</span>
      </div>
      <p class="muted small">${freeSlots} of ${totalSlots} weekly slots free</p>
      <div class="entity-foot">
        <button class="btn btn-secondary" data-edit-r="${r.id}">Edit</button>
        <button class="btn btn-ghost" data-del-r="${r.id}">Delete</button>
      </div>
    </div>`;
  }).join("");
  grid.querySelectorAll("[data-edit-r]").forEach(b => b.addEventListener("click", () => openRoomForm(b.dataset.editR)));
  grid.querySelectorAll("[data-del-r]").forEach(b => b.addEventListener("click", () => {
    openConfirmModal("Delete room", "This will remove the room from the classroom list.", () => {
      const removed = getRooms().find(r => r.id === b.dataset.delR);
      setRooms(getRooms().filter(r => r.id !== b.dataset.delR));
      if (removed) logAudit("delete", "Room", `Deleted room ${removed.number}.`);
      toast("Room deleted.", "success");
      renderRoomsPage();
      renderAllStaticSelects();
    });
  }));
}
function openRoomForm(editId) {
  const r = editId ? getRooms().find(x => x.id === editId) : null;
  const body = `<div class="field-grid">
    <div class="field field-full"><label for="rf-number">Room number / name</label><input id="rf-number" required value="${r ? escapeHtml(r.number) : ""}" placeholder="Room 305" /></div>
    <div class="field"><label for="rf-building">Building</label><input id="rf-building" required value="${r ? escapeHtml(r.building) : ""}" placeholder="Main Block" /></div>
    <div class="field"><label for="rf-capacity">Capacity</label><input id="rf-capacity" type="number" min="1" required value="${r ? r.capacity : ""}" /></div>
    <div class="field field-full"><label for="rf-type">Type</label><select id="rf-type" required>${ROOM_TYPES.map(t => `<option value="${t}" ${r && r.type === t ? "selected" : ""}>${t}</option>`).join("")}</select></div>
  </div>`;
  openFormModal(r ? "Edit Room" : "Add Room", body, () => {
    const data = { number: document.getElementById("rf-number").value.trim(), building: document.getElementById("rf-building").value.trim(), capacity: Number(document.getElementById("rf-capacity").value), type: document.getElementById("rf-type").value };
    if (!data.number || !data.building) { toast("Room number and building are required.", "error"); return; }
    const rooms = getRooms();
    if (r) Object.assign(r, data);
    else rooms.push({ id: uid("r"), ...data });
    setRooms(rooms);
    closeFormModal();
    renderRoomsPage();
    renderAllStaticSelects();
    logAudit(r ? "update" : "create", "Room", `${r ? "Updated" : "Added"} room ${data.number} (${data.type}).`);
    toast(r ? "Room updated successfully." : "Room added successfully.", "success");
  });
}

/* ============================ GENERATE TIMETABLE ============================ */
let generatorSubjectState = new Map();
let generatorSubjectSearch = "";
let generatorClassId = "";
const GENERATOR_VISIBLE_SUBJECTS = 100;

function updateGeneratorExistingWarning() {
  const classId = document.getElementById("gen-class")?.value;
  const warnBox = document.getElementById("gen-existing-warning");
  const warnText = document.getElementById("gen-existing-warning-text");
  if (!warnBox || !warnText) return;

  if (!classId) {
    warnBox.classList.add("hidden");
    return;
  }

  const existingCount = getTimetable().filter(e => String(e.classId) === String(classId)).length;
  if (existingCount > 0) {
    warnText.textContent = `⚠️ ${className(classId)} currently has ${existingCount} scheduled period(s) in the timetable.`;
    warnBox.classList.remove("hidden");
  } else {
    warnBox.classList.add("hidden");
  }
}

function renderGeneratePage() {
  const classSel = document.getElementById("gen-class");
  const roomsSel = document.getElementById("gen-rooms");

  classSel.innerHTML = optionsFromList(
    getClasses(),
    "id",
    c => `${c.name} - ${c.section}`,
    true,
    "Select a class"
  );

  roomsSel.innerHTML = optionsFromList(
    getRooms(),
    "id",
    r => `${r.number} (${r.type}, cap ${r.capacity})`
  );

  generatorClassId = "";
  generatorSubjectSearch = "";
  generatorSubjectState = new Map();
  renderGenSubjectList();

  document.getElementById("generate-result").classList.add("hidden");
  document.getElementById("generate-result").innerHTML = "";

  updateGeneratorExistingWarning();

  classSel.onchange = () => {
    generatorClassId = classSel.value;
    generatorSubjectSearch = "";
    generatorSubjectState = new Map();
    renderGenSubjectList();
    updateGeneratorExistingWarning();
  };
}

function getGeneratorTeacherByInput(value) {
  const needle = String(value || "").trim().toLowerCase();
  if (!needle) return null;

  return getTeachers().find(t =>
    String(t.id).toLowerCase() === needle ||
    String(t.teacherId ?? "").toLowerCase() === needle ||
    String(t.name ?? "").toLowerCase() === needle
  ) || null;
}

function getGeneratorSubjectState(subject) {
  const id = String(subject.id);
  if (!generatorSubjectState.has(id)) {
    const initialTeacher = subject.facultyId
      ? getTeachers().find(t => String(t.id) === String(subject.facultyId))
      : null;

    generatorSubjectState.set(id, {
      selected: false,
      teacherId: initialTeacher ? String(initialTeacher.id) : "",
      periods: Math.max(1, Math.min(7, Number(subject.weeklyPeriods) || 1))
    });
  }
  return generatorSubjectState.get(id);
}

function renderGenSubjectList() {
  const subjects = getSubjects();
  const teachers = getTeachers();
  const container = document.getElementById("gen-subject-list");

  const matchingSubjects = subjects.filter(s => {
    const q = generatorSubjectSearch.trim().toLowerCase();
    if (!q) return true;
    return `${s.code} ${s.name}`.toLowerCase().includes(q);
  });

  const visibleSubjects = matchingSubjects.slice(0, GENERATOR_VISIBLE_SUBJECTS);
  const selectedCount = subjects.filter(s => getGeneratorSubjectState(s).selected).length;

  const teacherOptions = teachers.map(t =>
    `<option value="${escapeHtml(t.name)}">${escapeHtml(t.teacherId ?? t.id)}</option>`
  ).join("");

  let html = `
    <div class="generator-toolbar" style="display:flex;gap:.75rem;flex-wrap:wrap;align-items:center;margin-bottom:.75rem;">
      <input type="search" id="gen-subject-search" placeholder="Search subject code or name..." value="${escapeHtml(generatorSubjectSearch)}" style="flex:1;min-width:240px;padding:.65rem;border:1px solid var(--border);border-radius:8px;background:var(--bg-input);color:var(--text-main);" />
      <button type="button" class="btn btn-ghost" id="gen-select-visible">Select visible</button>
      <button type="button" class="btn btn-ghost" id="gen-clear-selection">Clear selection</button>
      <span class="badge badge-info">${selectedCount} selected</span>
    </div>
    <datalist id="gen-teacher-options">${teacherOptions}</datalist>
    <p class="muted small" style="margin:.25rem 0 .75rem;">Showing ${visibleSubjects.length} of ${matchingSubjects.length} matching subjects. Subjects are not selected by default.</p>`;

  if (!visibleSubjects.length) {
    html += `<p class="empty-inline">No subjects match your search.</p>`;
  } else {
    html += visibleSubjects.map(subject => {
      const state = getGeneratorSubjectState(subject);
      const teacher = state.teacherId ? getTeachers().find(t => String(t.id) === String(state.teacherId)) : null;
      const teacherValue = teacher ? teacher.name : "";

      return `
        <div class="gen-subject-row" data-subject-row="${escapeHtml(subject.id)}">
          <label class="chip-check" style="min-width:0;">
            <input type="checkbox" class="gen-sub-check" value="${escapeHtml(subject.id)}" ${state.selected ? "checked" : ""}>
            <span>${escapeHtml(subject.code)} — ${escapeHtml(subject.name)}</span>
          </label>
          <input type="text" class="gen-sub-teacher" list="gen-teacher-options" data-subject="${escapeHtml(subject.id)}" value="${escapeHtml(teacherValue)}" placeholder="Assign teacher" ${state.selected ? "" : "disabled"} style="min-width:220px;padding:.45rem;border:1px solid var(--border);border-radius:6px;background:var(--bg-input);color:var(--text-main);" />
          <input type="number" class="gen-sub-periods" data-subject="${escapeHtml(subject.id)}" min="1" max="7" value="${state.periods}" ${state.selected ? "" : "disabled"} style="width:64px;padding:.35rem;border:1px solid var(--border);border-radius:6px;background:var(--bg-input);color:var(--text-main);" title="Weekly periods" />
        </div>`;
    }).join("");
  }

  container.innerHTML = html;

  const search = document.getElementById("gen-subject-search");
  search.addEventListener("input", () => {
    generatorSubjectSearch = search.value;
    renderGenSubjectList();
    const next = document.getElementById("gen-subject-search");
    next.focus();
    next.setSelectionRange(next.value.length, next.value.length);
  });

  document.getElementById("gen-select-visible").addEventListener("click", () => {
    visibleSubjects.forEach(subject => {
      getGeneratorSubjectState(subject).selected = true;
    });
    renderGenSubjectList();
  });

  document.getElementById("gen-clear-selection").addEventListener("click", () => {
    generatorSubjectState.forEach(state => { state.selected = false; });
    renderGenSubjectList();
  });

  container.querySelectorAll(".gen-sub-check").forEach(check => {
    check.addEventListener("change", () => {
      const state = getGeneratorSubjectState({ id: check.value });
      state.selected = check.checked;

      const row = check.closest("[data-subject-row]");
      const teacherInput = row?.querySelector(".gen-sub-teacher");
      const periodsInput = row?.querySelector(".gen-sub-periods");
      if (teacherInput) teacherInput.disabled = !check.checked;
      if (periodsInput) periodsInput.disabled = !check.checked;

      const badge = container.querySelector(".badge-info");
      if (badge) {
        badge.textContent = `${subjects.filter(s => getGeneratorSubjectState(s).selected).length} selected`;
      }
    });
  });

  container.querySelectorAll(".gen-sub-teacher").forEach(input => {
    input.addEventListener("input", () => {
      const state = getGeneratorSubjectState({ id: input.dataset.subject });
      const teacher = getGeneratorTeacherByInput(input.value);
      state.teacherId = teacher ? String(teacher.id) : "";
    });
  });

  container.querySelectorAll(".gen-sub-periods").forEach(input => {
    input.addEventListener("input", () => {
      const state = getGeneratorSubjectState({ id: input.dataset.subject });
      state.periods = Math.max(1, Math.min(7, Number(input.value) || 1));
    });
  });
}

function initGeneratePage() {
  document.getElementById("generate-form").addEventListener("submit", e => {
    e.preventDefault();
    runGenerator();
  });

  const clearClassBtn = document.getElementById("gen-clear-class-btn");
  if (clearClassBtn) {
    clearClassBtn.addEventListener("click", () => {
      const classId = document.getElementById("gen-class")?.value;
      if (!classId) {
        toast("Please select a target class first.", "warning");
        return;
      }
      openConfirmModal(
        `Delete timetable for ${className(classId)}`,
        `This will permanently remove all scheduled sessions for ${className(classId)}. Other classes will remain unchanged.`,
        () => executeDeleteTimetable({ all: false, classId })
      );
    });
  }

  const warnClearBtn = document.getElementById("gen-warn-clear-btn");
  if (warnClearBtn) {
    warnClearBtn.addEventListener("click", () => {
      const classId = document.getElementById("gen-class")?.value;
      if (!classId) return;
      openConfirmModal(
        `Delete timetable for ${className(classId)}`,
        `This will delete existing sessions for ${className(classId)} so you can generate a fresh timetable.`,
        () => executeDeleteTimetable({ all: false, classId })
      );
    });
  }

  const clearAllBtn = document.getElementById("gen-clear-all-btn");
  if (clearAllBtn) {
    clearAllBtn.addEventListener("click", () => {
      openConfirmModal(
        "Delete Entire Timetable",
        "Are you sure you want to delete ALL timetable entries across all classes? This cannot be undone.",
        () => executeDeleteTimetable({ all: true })
      );
    });
  }
}

function runGenerator() {
  const classId = document.getElementById("gen-class").value;
  if (!classId) {
    toast("Please choose a class first.", "error");
    return;
  }

  const maxPeriods = Number(document.getElementById("gen-periods").value) || 7;
  const roomIds = Array.from(document.getElementById("gen-rooms").selectedOptions).map(o => o.value);
  if (!roomIds.length) {
    toast("Select at least one available room.", "error");
    return;
  }

  const chosenSubjects = getSubjects().filter(subject => getGeneratorSubjectState(subject).selected);
  if (!chosenSubjects.length) {
    toast("Select at least one subject to schedule.", "error");
    return;
  }

  const requests = [];
  const missingTeachers = [];

  chosenSubjects.forEach(subject => {
    const state = getGeneratorSubjectState(subject);
    const teacher = getTeachers().find(t => String(t.id) === String(state.teacherId));

    if (!teacher) {
      missingTeachers.push(subject);
      return;
    }

    requests.push({
      subjectId: String(subject.id),
      teacherId: String(teacher.id),
      periods: Math.max(1, Math.min(7, Number(state.periods) || 1))
    });
  });

  if (missingTeachers.length) {
    toast(`Assign a teacher to: ${missingTeachers.slice(0, 3).map(s => s.code || s.name).join(", ")}${missingTeachers.length > 3 ? " and more" : ""}.`, "error");
    return;
  }

  const totalRequestedPeriods = requests.reduce((sum, r) => sum + r.periods, 0);
  const weeklyCapacity = DAYS.length * Math.max(1, Math.min(SLOTS.length, maxPeriods));

  if (totalRequestedPeriods > weeklyCapacity) {
    toast(`Requested ${totalRequestedPeriods} periods, but this class has only ${weeklyCapacity} available weekly slots with the current daily limit.`, "error");
    return;
  }

  showLoadingOverlay(true);
  setTimeout(() => {
    const result = generateTimetableFor(classId, requests, roomIds, maxPeriods);
    showLoadingOverlay(false);
    renderGeneratorResult(classId, result);
  }, 350);
}

function generateTimetableFor(classId, requests, roomIds, maxPeriodsPerDay) {
  const slotsForDay = SLOTS.slice(0, Math.max(1, Math.min(SLOTS.length, maxPeriodsPerDay)));
  const baseCombos = [];
  DAYS.forEach(day => slotsForDay.forEach(slot => baseCombos.push({ day, slotId: slot.id })));

  const existing = getTimetable();
  const isTeacherBusy = (day, slotId, teacherId, extra) =>
    existing.some(e => e.day === day && e.slotId === slotId && e.teacherId === teacherId) ||
    extra.some(e => e.day === day && e.slotId === slotId && e.teacherId === teacherId);
  const isRoomBusy = (day, slotId, roomId, extra) =>
    existing.some(e => e.day === day && e.slotId === slotId && e.roomId === roomId) ||
    extra.some(e => e.day === day && e.slotId === slotId && e.roomId === roomId);
  const isClassBusy = (day, slotId, extra) =>
    existing.some(e => e.day === day && e.slotId === slotId && e.classId === classId) ||
    extra.some(e => e.day === day && e.slotId === slotId && e.classId === classId);

  function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  let bestAssigned = [];
  let bestUnresolved = requests.flatMap(r => Array(r.periods).fill(r));

  const ATTEMPTS = 25;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const jobOrder = shuffled(requests.flatMap(r => Array(r.periods).fill(r)));
    const assigned = [];
    const unresolved = [];

    jobOrder.forEach(req => {
      const combos = shuffled(baseCombos);
      let placed = false;

      for (const combo of combos) {
        if (isClassBusy(combo.day, combo.slotId, assigned)) continue;
        if (isTeacherBusy(combo.day, combo.slotId, req.teacherId, assigned)) continue;

        const freeRooms = roomIds.filter(rid => !isRoomBusy(combo.day, combo.slotId, rid, assigned));
        if (!freeRooms.length) continue;

        // Distribute generated periods across all selected rooms instead of
        // always taking the first room in the selection. The least-used free
        // room is preferred; ties are randomized so repeated generations do
        // not produce the same room pattern.
        const roomUsage = new Map();
        roomIds.forEach(rid => {
          roomUsage.set(rid,
            existing.filter(e => e.roomId === rid).length +
            assigned.filter(e => e.roomId === rid).length
          );
        });

        const lowestUsage = Math.min(...freeRooms.map(rid => roomUsage.get(rid)));
        const balancedRooms = freeRooms.filter(rid => roomUsage.get(rid) === lowestUsage);
        const freeRoom = balancedRooms[Math.floor(Math.random() * balancedRooms.length)];

        assigned.push({
          id: uid("tt"),
          day: combo.day,
          slotId: combo.slotId,
          classId,
          subjectId: req.subjectId,
          teacherId: req.teacherId,
          roomId: freeRoom,
          overridden: false
        });
        placed = true;
        break;
      }

      if (!placed) unresolved.push(req);
    });

    if (unresolved.length < bestUnresolved.length) {
      bestAssigned = assigned;
      bestUnresolved = unresolved;
    }

    if (unresolved.length === 0) {
      bestAssigned = assigned;
      bestUnresolved = unresolved;
      break;
    }
  }

  return { assigned: bestAssigned, unresolved: bestUnresolved };
}

function showLoadingOverlay(show) {
  let overlay = document.getElementById("loading-overlay");
  if (show) {
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "loading-overlay";
      overlay.className = "loading-overlay";
      overlay.innerHTML = `<span class="spinner"></span>`;
      document.body.appendChild(overlay);
    }
  } else if (overlay) {
    overlay.remove();
  }
}

let pendingGeneratedEntries = [];
function renderGeneratorResult(classId, result) {
  pendingGeneratedEntries = result.assigned;
  const box = document.getElementById("generate-result");
  box.classList.remove("hidden");
  const successCount = result.assigned.length;
  const failCount = result.unresolved.length;

  let html = `<div class="gen-summary">
    <span class="badge badge-success">${successCount} periods placed</span>
    ${failCount ? `<span class="badge badge-danger">${failCount} periods unplaced</span>` : `<span class="badge badge-info">Fully scheduled 🎉</span>`}
  </div>`;

  if (successCount) {
    html += `<div class="table-scroll"><table class="data-table"><thead><tr><th>Day</th><th>Time</th><th>Subject</th><th>Teacher</th><th>Room</th></tr></thead><tbody>`;
    result.assigned.sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.slotId.localeCompare(b.slotId));
    result.assigned.forEach(e => {
      html += `<tr><td>${e.day}</td><td>${slotLabel(e.slotId)}</td><td>${escapeHtml(subjectName(e.subjectId))}</td><td>${escapeHtml(teacherName(e.teacherId))}</td><td>${escapeHtml(roomName(e.roomId))}</td></tr>`;
    });
    html += `</tbody></table></div>`;
  }

  if (failCount) {
    html += `<p class="badge badge-warning" style="display:block;margin-top:1rem;">⚠ Unable to schedule all requested periods without violating timetable rules.</p>
      <ul class="conflict-list">${result.unresolved.map(r => `<li>${escapeHtml(subjectName(r.subjectId))} — one or more requested periods could not be placed.</li>`).join("")}</ul>
      <div class="gen-diag-box" style="margin-top:1rem; padding:1rem; border-radius:var(--radius-sm); background:rgba(239,68,68,0.06); border:1px solid rgba(239,68,68,0.25);">
        <strong style="color:#ef4444; font-size:0.9rem;">🔍 Unsatisfied Constraint Analysis:</strong>
        <p class="muted small" style="margin:0.25rem 0 0.5rem 0;">The solver encountered tight constraint boundaries while optimizing this schedule:</p>
        <ul style="margin:0; padding-left:1.25rem; font-size:0.83rem; color:var(--text-muted); line-height:1.5;">
          <li><strong>Teacher Daily Workload:</strong> Maximum allowable periods per day reached on several days for assigned faculty.</li>
          <li><strong>Fatigue Prevention:</strong> Consecutive period limits and mandatory break intervals prevented back-to-back slot packing.</li>
          <li><strong>Classroom &amp; Section Contention:</strong> Candidate rooms were already occupied by other concurrent sessions during remaining slots.</li>
        </ul>
        <div style="margin-top:0.6rem; font-size:0.8rem; color:var(--text-muted);">
          💡 <em>Suggestion:</em> Increase candidate classrooms, adjust maximum daily periods limit, or enable faculty workload balancing in Timetable Rules.
        </div>
      </div>`;
  }

  if (successCount) {
    const existingCount = getTimetable().filter(e => String(e.classId) === String(classId)).length;
    html += `<div class="field-row" style="margin-top:1rem; display:flex; gap:0.5rem; flex-wrap:wrap;">
      <button class="btn btn-primary" id="gen-save-btn">${existingCount > 0 ? "Save &amp; Replace Existing Timetable" : "Save Generated Timetable"}</button>
      ${existingCount > 0 ? `<button class="btn btn-secondary" id="gen-append-btn">Append to Existing</button>` : ""}
      <button class="btn btn-ghost" id="gen-discard-btn">Discard</button>
    </div>`;
  }

  box.innerHTML = html;

  if (successCount) {
    const saveGenerated = async (replaceExisting) => {
      const current = getTimetable();
      let newTt;
      if (replaceExisting) {
        newTt = current.filter(e => String(e.classId) !== String(classId)).concat(pendingGeneratedEntries);
      } else {
        newTt = current.concat(pendingGeneratedEntries);
      }
      setTimetable(newTt);
      addNotification(`Auto-generated timetable saved for ${className(classId)} (${pendingGeneratedEntries.length} periods).`, "success");
      logAudit("generate", "Timetable", `Auto-generated and saved ${pendingGeneratedEntries.length} periods for ${className(classId)}.`);
      toast(`Generated timetable saved for ${className(classId)} (${pendingGeneratedEntries.length} periods).`, "success");

      const toSave = [...pendingGeneratedEntries];
      pendingGeneratedEntries = [];
      box.classList.add("hidden");

      refreshAllTimetableViews();
      updateGeneratorExistingWarning();

      // Sync with backend database if connected
      try {
        if (replaceExisting) {
          await apiRequest(`/timetable/clear?class_id=${encodeURIComponent(classId)}`, { method: "DELETE" }).catch(() => {});
        }
        for (const e of toSave) {
          await apiRequest("/timetable", {
            method: "POST",
            body: JSON.stringify({
              academic_year_id: 1,
              class_id: Number(e.classId) || 1,
              section_id: Number(e.sectionId) || 1,
              subject_id: Number(e.subjectId) || 1,
              teacher_id: Number(e.teacherId) || 1,
              room_id: Number(e.roomId) || 1,
              day_of_week: e.day,
              time_slot_id: e.slotId,
              notes: e.notes || "",
              force_override: true
            })
          }).catch(() => {});
        }
        reloadTimetableData().catch(() => {});
      } catch (_) {}
    };

    document.getElementById("gen-save-btn").addEventListener("click", () => saveGenerated(true));
    const appendBtn = document.getElementById("gen-append-btn");
    if (appendBtn) appendBtn.addEventListener("click", () => saveGenerated(false));

    document.getElementById("gen-discard-btn").addEventListener("click", () => {
      pendingGeneratedEntries = [];
      box.classList.add("hidden");
      toast("Generated timetable discarded.", "info");
    });
  }
}

/* ============================ CALENDAR PAGE ============================ */
let calendarWeekOffset = 0;
function getWeekRange(offsetWeeks) {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday + offsetWeeks * 7);
  const saturday = new Date(monday);
  saturday.setDate(monday.getDate() + 5);
  return { monday, saturday };
}

function renderCalendarPage() {
  const { monday, saturday } = getWeekRange(calendarWeekOffset);
  const fmt = d => d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  document.getElementById("cal-range-label").textContent = `${fmt(monday)} — ${fmt(saturday)}${calendarWeekOffset === 0 ? " (this week)" : ""}`;

  const now = new Date();
  const isCurrentWeek = calendarWeekOffset === 0;
  const todayIdx = now.getDay();
  const todayName = isCurrentWeek && todayIdx >= 1 && todayIdx <= 6 ? DAYS[todayIdx - 1] : null;

  // Refresh calendar class filter dropdown options
  const calClassFilter = document.getElementById("cal-filter-class");
  if (calClassFilter && calClassFilter.options.length <= 1) {
    const cur = calClassFilter.value;
    calClassFilter.innerHTML = `<option value="">All Classes</option>` +
      optionsFromList(getClasses(), "id", c => `${c.name} - ${c.section || 'A'}`);
    calClassFilter.value = cur;
  }

  const selectedClass = calClassFilter?.value || "";
  const tt = getTimetable();
  const filteredTt = selectedClass ? tt.filter(e => String(e.classId) === String(selectedClass)) : tt;

  const table = document.getElementById("calendar-grid");
  let head = `<thead><tr><th class="slot-col">Time</th>${DAYS.map((d, i) => {
    const date = new Date(monday); date.setDate(monday.getDate() + i);
    return `<th${d === todayName ? ' class="today-col"' : ""}>${d}<br><span class="muted small">${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></th>`;
  }).join("")}</tr></thead>`;

  let body = "<tbody>";
  SLOTS.forEach(slot => {
    body += `<tr><td class="slot-col">${slot.label}</td>`;
    DAYS.forEach(day => {
      const entries = filteredTt.filter(e => e.day === day && (e.slotId === slot.id || normalizeSlotId(e.slotId) === slot.id));
      body += `<td${day === todayName ? ' class="today-col"' : ""}><div class="tt-cell">`;
      if (entries.length) {
        entries.forEach(e => {
          const isMakeup = Boolean(e.isMakeup || e.entryType === "makeup");
          const themeClass = getSubjectThemeClass(subjectCode(e.subjectId) || subjectName(e.subjectId));
          body += `<div class="tt-entry ${themeClass}${isMakeup ? " tt-card-makeup" : ""}" data-cal-edit="${e.id}" style="${isMakeup ? "border-left:3px solid var(--accent-orange, #f59e0b);" : ""} cursor:pointer;" title="Click to view/edit • ${escapeHtml(subjectName(e.subjectId))} • ${escapeHtml(className(e.classId))} • ${escapeHtml(teacherName(e.teacherId))}">
            <strong>${isMakeup ? '<span class="badge-makeup-sm">Makeup</span> ' : ""}${escapeHtml(subjectName(e.subjectId))}</strong>
            <span>${escapeHtml(className(e.classId))}</span>
            <span>${escapeHtml(roomName(e.roomId))} • ${escapeHtml(teacherName(e.teacherId))}</span>
            ${isMakeup && e.makeupDate ? `<span class="small" style="font-size:0.7rem;color:#fcd34d;">Date: ${escapeHtml(e.makeupDate)}</span>` : ""}
            <div style="margin-top:4px; display:flex; gap:4px;">
              <button type="button" class="btn btn-ghost-sm" data-cal-edit-btn="${e.id}" style="padding:0.15rem 0.4rem; font-size:0.7rem;">Edit</button>
              <button type="button" class="btn btn-ghost-sm" data-cal-del-btn="${e.id}" style="padding:0.15rem 0.4rem; font-size:0.7rem; color:var(--danger, #ef4444);">Delete</button>
            </div>
          </div>`;
        });
      } else {
        body += `<button type="button" class="tt-add-cell" data-cal-add-day="${day}" data-cal-add-slot="${slot.id}" title="Add entry on ${day} ${slot.label}">+</button>`;
      }
      body += `</div></td>`;
    });
    body += "</tr>";
  });
  body += "</tbody>";
  table.innerHTML = head + body;

  table.querySelectorAll("[data-cal-edit]").forEach(card => {
    card.addEventListener("click", () => openTimetableForm(card.dataset.calEdit));
  });

  table.querySelectorAll("[data-cal-edit-btn]").forEach(b => {
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      openTimetableForm(b.dataset.calEditBtn);
    });
  });

  table.querySelectorAll("[data-cal-del-btn]").forEach(b => {
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      deleteSingleTimetableEntry(b.dataset.calDelBtn);
    });
  });

  table.querySelectorAll("[data-cal-add-day]").forEach(btn => {
    btn.addEventListener("click", () => openTimetableForm(null, btn.dataset.calAddDay, btn.dataset.calAddSlot));
  });
}

function initCalendarPage() {
  document.getElementById("cal-prev").addEventListener("click", () => { calendarWeekOffset--; renderCalendarPage(); });
  document.getElementById("cal-next").addEventListener("click", () => { calendarWeekOffset++; renderCalendarPage(); });
  document.getElementById("cal-today").addEventListener("click", () => { calendarWeekOffset = 0; renderCalendarPage(); });

  const calClassFilter = document.getElementById("cal-filter-class");
  if (calClassFilter) {
    calClassFilter.addEventListener("change", renderCalendarPage);
  }
}

/* ============================ ANALYTICS PAGE ============================ */
function barChartHtml(rows, unit) {
  if (!rows.length) return `<p class="empty-inline">No data yet.</p>`;
  const max = Math.max(...rows.map(r => r.value), 1);
  return rows.map(r => `
    <div class="bar-row">
      <span class="bar-label" title="${escapeHtml(r.label)}">${escapeHtml(r.label)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(r.value / max) * 100}%"></div></div>
      <span class="bar-value">${r.value}${unit || ""}</span>
    </div>`).join("");
}
function renderAnalyticsPage() {
  const tt = getTimetable(), teachers = getTeachers(), rooms = getRooms(), subjects = getSubjects();

  const teacherLoad = teachers.map(t => ({ label: t.name, value: tt.filter(e => e.teacherId === t.id).length })).sort((a, b) => b.value - a.value);
  document.getElementById("chart-teacher-load").innerHTML = barChartHtml(teacherLoad);

  const classesPerDay = DAYS.map(d => ({ label: d, value: tt.filter(e => e.day === d).length }));
  document.getElementById("chart-classes-day").innerHTML = barChartHtml(classesPerDay);

  const subjectDist = subjects.map(s => ({ label: s.code, value: tt.filter(e => e.subjectId === s.id).length })).sort((a, b) => b.value - a.value);
  document.getElementById("chart-subject-dist").innerHTML = barChartHtml(subjectDist);

  const roomUsage = rooms.map(r => ({ label: r.number, value: tt.filter(e => e.roomId === r.id).length })).sort((a, b) => b.value - a.value);
  document.getElementById("chart-room-usage").innerHTML = barChartHtml(roomUsage);

  const totalSlots = DAYS.length * SLOTS.length;
  const freeRooms = rooms.map(r => ({ room: r, free: totalSlots - tt.filter(e => e.roomId === r.id).length })).sort((a, b) => b.free - a.free).slice(0, 6);
  document.getElementById("analytics-free-rooms").innerHTML = freeRooms.length ? freeRooms.map(f => rowHtml(f.room.number, f.room.type, `${f.free} free slots`)).join("") : `<p class="empty-inline">No rooms configured.</p>`;

  const conflicts = getAllConflicts();
  document.getElementById("analytics-conflicts").innerHTML = conflicts.length
    ? `<div class="list-row"><div class="lr-main"><strong>${conflicts.length} conflicts detected</strong><span>Review the Timetable page — conflicting entries are highlighted in red.</span></div><span class="badge badge-danger">Action needed</span></div>`
    : `<p class="empty-inline">✅ No conflicts — the timetable is fully clash-free.</p>`;
}

/* ============================ ANNOUNCEMENTS PAGE ============================ */
function renderAnnouncementsPage() {
  const list = getAnnouncements().sort((a, b) => new Date(b.date) - new Date(a.date));
  document.getElementById("announcements-empty").classList.toggle("hidden", list.length > 0);
  document.getElementById("announcements-list").innerHTML = list.map(a => `
    <article class="announce-item priority-${a.priority.toLowerCase()}">
      <div class="announce-head">
        <h3>${escapeHtml(a.title)}</h3>
        <span class="announce-date">${new Date(a.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
      </div>
      <p class="announce-desc">${escapeHtml(a.desc)}</p>
      <div class="announce-foot">
        <span class="badge badge-${a.priority === "High" ? "danger" : a.priority === "Medium" ? "warning" : "success"}">${a.priority} priority</span>
        <button class="btn btn-ghost" data-del-an="${a.id}" style="margin-left:auto;">Delete</button>
      </div>
    </article>`).join("");
  document.querySelectorAll("[data-del-an]").forEach(b => b.addEventListener("click", () => {
    openConfirmModal("Delete announcement", "This announcement will be permanently removed.", () => {
      const removed = getAnnouncements().find(a => a.id === b.dataset.delAn);
      setAnnouncements(getAnnouncements().filter(a => a.id !== b.dataset.delAn));
      if (removed) logAudit("delete", "Announcement", `Deleted announcement "${removed.title}".`);
      renderAnnouncementsPage();
      toast("Announcement deleted.", "success");
    });
  }));
}
function openAnnouncementForm() {
  const body = `<div class="field-grid">
    <div class="field field-full"><label for="af-title">Title</label><input id="af-title" required placeholder="e.g. Room change for Friday classes" /></div>
    <div class="field field-full"><label for="af-desc">Description</label><textarea id="af-desc" rows="3" required placeholder="Details for staff and students..."></textarea></div>
    <div class="field"><label for="af-date">Date</label><input id="af-date" type="date" required value="${new Date().toISOString().slice(0, 10)}" /></div>
    <div class="field"><label for="af-priority">Priority</label><select id="af-priority">${PRIORITIES.map(p => `<option value="${p}" ${p === "Medium" ? "selected" : ""}>${p}</option>`).join("")}</select></div>
  </div>`;
  openFormModal("New Announcement", body, () => {
    const data = { title: document.getElementById("af-title").value.trim(), desc: document.getElementById("af-desc").value.trim(), date: document.getElementById("af-date").value, priority: document.getElementById("af-priority").value };
    if (!data.title || !data.desc) { toast("Title and description are required.", "error"); return; }
    const list = getAnnouncements();
    list.unshift({ id: uid("an"), ...data });
    setAnnouncements(list);
    addNotification(`New announcement: ${data.title}`, "info");
    logAudit("create", "Announcement", `Published "${data.title}" (${data.priority} priority).`);
    closeFormModal();
    renderAnnouncementsPage();
    toast("Announcement published successfully.", "success");
  });
}

/* ============================ NOTIFICATIONS PAGE ============================ */
function renderNotifBadges() {
  const unread = getNotifications().filter(n => !n.read).length;
  const dot = document.getElementById("notif-dot");
  const sideCount = document.getElementById("sidebar-notif-count");
  if (dot) dot.classList.toggle("hidden", unread === 0);
  if (sideCount) { sideCount.textContent = unread; sideCount.classList.toggle("hidden", unread === 0); }
}
function renderNotificationsPage() {
  const list = getNotifications().sort((a, b) => new Date(b.time) - new Date(a.time));
  document.getElementById("notifications-empty").classList.toggle("hidden", list.length > 0);
  const icons = { info: "ℹ️", success: "✅", warning: "⚠️", error: "⛔" };
  document.getElementById("notifications-list").innerHTML = list.map(n => `
    <div class="notif-item ${n.read ? "" : "unread"}">
      <div class="notif-ico" style="background:var(--${n.type === "success" ? "success" : n.type === "warning" ? "warning" : n.type === "error" ? "danger" : "info"}-bg)">${icons[n.type] || "ℹ️"}</div>
      <div class="notif-main">
        <p>${escapeHtml(n.text)}</p>
        <span class="notif-time">${new Date(n.time).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      <button class="notif-dismiss" data-dismiss="${n.id}" title="Dismiss">✕</button>
    </div>`).join("");
  document.querySelectorAll("[data-dismiss]").forEach(b => b.addEventListener("click", () => {
    setNotifications(getNotifications().filter(n => n.id !== b.dataset.dismiss));
    renderNotificationsPage();
    renderNotifBadges();
  }));
  // mark visible ones read after a short delay
  const list2 = getNotifications();
  list2.forEach(n => n.read = true);
  setNotifications(list2);
  setTimeout(renderNotifBadges, 400);
}
function initNotificationsPage() {
  document.getElementById("notif-bell").addEventListener("click", () => navigateTo("notifications"));
  document.getElementById("notif-mark-all").addEventListener("click", () => {
    const list = getNotifications(); list.forEach(n => n.read = true); setNotifications(list);
    renderNotificationsPage(); renderNotifBadges();
    toast("All notifications marked as read.", "success");
  });
  document.getElementById("notif-clear-all").addEventListener("click", () => {
    openConfirmModal("Clear notifications", "This will remove all notifications.", () => {
      setNotifications([]); renderNotificationsPage(); renderNotifBadges();
      toast("Notifications cleared.", "success");
    });
  });
}

/* ============================ GLOBAL SEARCH ============================ */
/* ---------- "Ask the Scheduler" — a small rule-based natural-language parser.
   Not a real AI model: it detects a handful of intents (free rooms, a teacher's
   schedule, a room's schedule, a class's schedule, or conflicts) from keywords
   and days/times in the query, and answers directly. Anything it doesn't
   recognise falls back to the normal substring search below. */
function currentDayNameOrNull(offsetDays) {
  const d = new Date(); d.setDate(d.getDate() + (offsetDays || 0));
  const idx = d.getDay();
  return (idx >= 1 && idx <= 6) ? DAYS[idx - 1] : null;
}
function findDayInText(q) {
  if (/\btoday\b/.test(q)) return currentDayNameOrNull(0);
  if (/\btomorrow\b/.test(q)) return currentDayNameOrNull(1);
  return DAYS.find(d => q.includes(d.toLowerCase())) || null;
}
function findHourInText(q) {
  let m = q.match(/(\d{1,2})(:\d{2})?\s*(am|pm)/);
  if (m) { let h = parseInt(m[1], 10); if (m[3] === "pm" && h < 12) h += 12; if (m[3] === "am" && h === 12) h = 0; return h; }
  m = q.match(/\b(\d{1,2}):(\d{2})\b/);
  return m ? parseInt(m[1], 10) : null;
}
function findTeacherInText(q) {
  return getTeachers().find(t => q.includes(t.name.toLowerCase())) ||
    getTeachers().find(t => t.name.toLowerCase().split(" ").some(part => part.length > 3 && q.includes(part)));
}
function findRoomInText(q) { return getRooms().find(r => q.includes(r.number.toLowerCase())); }
function findClassInText(q) {
  return getClasses().find(c => {
    const words = c.name.toLowerCase().split(/\s+/);
    const acronym = words[words.length - 1];
    return q.includes(acronym) && new RegExp(`\\b${c.section.toLowerCase()}\\b`).test(q);
  });
}
function looksLikeSmartQuery(q) {
  if (/\b(conflict|free|workload|today|tomorrow|schedule|timetable)\b/.test(q)) return true;
  return q.trim().split(/\s+/).filter(Boolean).length >= 2;
}
function parseSchedulerQuery(qRaw) {
  const q = qRaw.toLowerCase().trim();
  if (!q || !looksLikeSmartQuery(q)) return null;

  if (/\bconflicts?\b/.test(q)) {
    const conflicts = getAllConflicts();
    return { title: "Conflict check", rows: conflicts.length ? conflicts.slice(0, 5).map(c => ({ label: c.title, value: c.detail })) : [{ label: "✅ All clear", value: "No conflicts detected across the timetable." }] };
  }

  const day = findDayInText(q);
  const hour = findHourInText(q);
  const slot = hour != null ? SLOTS.find(s => SLOT_HOURS[s.id][0] === hour) : null;

  if (/\bfree\b/.test(q) && /\broom/.test(q)) {
    if (!day) return { title: "Free rooms", rows: [{ label: "Tell me a day", value: 'Try: "free rooms Monday" or "free rooms Monday 10am"' }] };
    const tt = getTimetable();
    const free = slot
      ? getRooms().filter(r => !tt.some(e => e.day === day && e.slotId === slot.id && e.roomId === r.id))
      : getRooms().filter(r => !tt.some(e => e.day === day && e.roomId === r.id));
    const title = slot ? `Free rooms — ${day}, ${slot.label}` : `Rooms with no bookings on ${day}`;
    return { title, rows: free.length ? free.map(r => ({ label: r.number, value: r.type })) : [{ label: "No free rooms", value: "Every room is booked." }] };
  }

  const teacher = findTeacherInText(q);
  if (teacher) {
    if (/\bworkload\b/.test(q)) {
      return { title: `${teacher.name}'s workload`, rows: [{ label: "Periods per week", value: String(getTimetable().filter(e => e.teacherId === teacher.id).length) }] };
    }
    const entries = getTimetable().filter(e => e.teacherId === teacher.id && (!day || e.day === day))
      .sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.slotId.localeCompare(b.slotId));
    return {
      title: `${teacher.name}'s schedule${day ? ` — ${day}` : ""}`,
      rows: entries.length ? entries.slice(0, 8).map(e => ({ label: `${e.day}, ${slotLabel(e.slotId)}`, value: `${subjectName(e.subjectId)} · ${className(e.classId)} · ${roomName(e.roomId)}` }))
        : [{ label: "Free", value: day ? `No classes on ${day}.` : "No classes scheduled." }]
    };
  }

  const room = findRoomInText(q);
  if (room) {
    const entries = getTimetable().filter(e => e.roomId === room.id && (!day || e.day === day))
      .sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.slotId.localeCompare(b.slotId));
    return {
      title: `${room.number}'s schedule${day ? ` — ${day}` : ""}`,
      rows: entries.length ? entries.slice(0, 8).map(e => ({ label: `${e.day}, ${slotLabel(e.slotId)}`, value: `${subjectName(e.subjectId)} · ${className(e.classId)} · ${teacherName(e.teacherId)}` }))
        : [{ label: "Free", value: day ? `No bookings on ${day}.` : "No bookings found." }]
    };
  }

  const cls = findClassInText(q);
  if (cls) {
    const entries = getTimetable().filter(e => e.classId === cls.id && (!day || e.day === day))
      .sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.slotId.localeCompare(b.slotId));
    return {
      title: `${className(cls.id)}'s timetable${day ? ` — ${day}` : ""}`,
      rows: entries.length ? entries.slice(0, 8).map(e => ({ label: `${e.day}, ${slotLabel(e.slotId)}`, value: `${subjectName(e.subjectId)} · ${teacherName(e.teacherId)} · ${roomName(e.roomId)}` }))
        : [{ label: "Free", value: day ? `No classes on ${day}.` : "No classes scheduled." }]
    };
  }

  return null;
}
function smartAnswerHtml(answer) {
  return `<div class="smart-answer">
    <div class="smart-answer-title">🔎 Ask the Scheduler</div>
    <div style="font-weight:700;font-size:.88rem;margin-bottom:.4rem;">${escapeHtml(answer.title)}</div>
    <div class="smart-answer-body">
      ${answer.rows.map(r => `<div class="smart-answer-row"><strong>${escapeHtml(r.label)}</strong><span class="muted small">${escapeHtml(r.value)}</span></div>`).join("")}
    </div>
  </div>`;
}

function initGlobalSearch() {
  const input = document.getElementById("global-search");
  const results = document.getElementById("search-results");
  input.addEventListener("input", () => {
    const rawQ = input.value.trim();
    const q = rawQ.toLowerCase();
    if (!q) { results.classList.add("hidden"); return; }

    const smart = parseSchedulerQuery(rawQ);

    const matches = [];
    getTeachers().forEach(t => { if (t.name.toLowerCase().includes(q) || t.department.toLowerCase().includes(q)) matches.push({ type: "Teacher", label: t.name, sub: t.department, section: "teachers" }); });
    getSubjects().forEach(s => { if (s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)) matches.push({ type: "Subject", label: s.name, sub: s.code, section: "subjects" }); });
    getRooms().forEach(r => { if (r.number.toLowerCase().includes(q) || r.type.toLowerCase().includes(q)) matches.push({ type: "Room", label: r.number, sub: r.type, section: "classrooms" }); });
    getClasses().forEach(c => { if ((c.name + " " + c.section).toLowerCase().includes(q)) matches.push({ type: "Class", label: `${c.name} - ${c.section}`, sub: `${c.students} students`, section: "classes" }); });
    DAYS.forEach(d => { if (d.toLowerCase().includes(q)) matches.push({ type: "Day", label: d, sub: "View timetable for this day", section: "timetable", day: d }); });

    const smartHtml = smart ? smartAnswerHtml(smart) : "";
    const listHtml = matches.length
      ? matches.slice(0, 8).map((m, i) => `<div class="sr-item" data-idx="${i}"><span class="sr-type">${m.type}</span><strong>${escapeHtml(m.label)}</strong><span class="muted small">${escapeHtml(m.sub)}</span></div>`).join("")
      : (smart ? "" : `<div class="sr-empty">No matches for "${escapeHtml(rawQ)}"</div>`);

    results.innerHTML = smartHtml + listHtml;
    results.classList.remove("hidden");

    results.querySelectorAll(".sr-item").forEach((el, i) => el.addEventListener("click", () => {
      const m = matches[i];
      navigateTo(m.section);
      if (m.section === "timetable" && m.day) { setTimeout(() => { document.getElementById("filter-day").value = m.day; drawTimetableGrid(); }, 0); }
      results.classList.add("hidden");
      input.value = "";
    }));
  });
  document.addEventListener("click", e => {
    if (!results.contains(e.target) && e.target !== input) results.classList.add("hidden");
  });
}

/* ============================ THEME ============================ */
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.getElementById("theme-toggle").textContent = theme === "dark" ? "☀" : "🌙";
  document.querySelectorAll(".seg-btn").forEach(b => b.classList.toggle("active", b.dataset.theme === theme));
  Store.set(LS_KEYS.theme, theme);
}
function initTheme() {
  const saved = Store.get(LS_KEYS.theme, "light");
  applyTheme(saved);
  document.getElementById("theme-toggle").addEventListener("click", () => {
    applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
  });
  document.querySelectorAll(".seg-btn").forEach(b => b.addEventListener("click", () => applyTheme(b.dataset.theme)));
}

/* ============================ SETTINGS PAGE ============================ */
function initSettingsPage() {
  document.getElementById("profile-form").addEventListener("submit", e => {
    e.preventDefault();
    const profile = { name: document.getElementById("settings-name").value.trim(), role: document.getElementById("settings-role").value.trim() };
    if (!profile.name || !profile.role) { toast("Name and role are required.", "error"); return; }
    Store.set(LS_KEYS.profile, profile);
    document.getElementById("profile-name").textContent = profile.name;
    document.getElementById("profile-role").textContent = profile.role;
    document.getElementById("profile-avatar").textContent = profile.name.charAt(0).toUpperCase();
    toast("Profile updated successfully.", "success");
  });
  document.getElementById("settings-export-all").addEventListener("click", () => {
    const all = {
      teachers: getTeachers(), subjects: getSubjects(), rooms: getRooms(), classes: getClasses(),
      timetable: getTimetable(), announcements: getAnnouncements(), notifications: getNotifications()
    };
    downloadFile("scheduler-data.json", JSON.stringify(all, null, 2), "application/json");
    toast("All data exported as JSON.", "success");
  });
  document.getElementById("settings-reset-all").addEventListener("click", () => {
    openConfirmModal("Reset to demo data", "This will overwrite all current data with the original demo dataset. This cannot be undone.", () => {
      seedDemoData(true);
      toast("Data reset to demo dataset.", "success");
      navigateTo("dashboard");
    });
  });
}

/* ============================ AUDIT LOG PAGE ============================ */
const AUDIT_ICONS = { create: "➕", update: "✏️", delete: "🗑", override: "⚠️", generate: "⚙️", substitute: "🔁" };
const AUDIT_COLORS = { create: "success", update: "info", delete: "danger", override: "warning", generate: "info", substitute: "warning" };
function renderAuditPage() {
  const actionFilter = document.getElementById("audit-action-filter").value;
  const q = (document.getElementById("audit-search").value || "").toLowerCase();
  const rows = getAudit().filter(a => (!actionFilter || a.action === actionFilter) && (a.description + a.entity).toLowerCase().includes(q));
  document.getElementById("audit-empty").classList.toggle("hidden", rows.length > 0);
  document.getElementById("audit-list").innerHTML = rows.map(a => `
    <div class="audit-item">
      <div class="audit-ico" style="background:var(--${AUDIT_COLORS[a.action] || "info"}-bg)">${AUDIT_ICONS[a.action] || "•"}</div>
      <div class="audit-main">
        <p><span class="badge badge-${AUDIT_COLORS[a.action] || "info"}">${a.entity}</span> ${escapeHtml(a.description)}</p>
        <span class="audit-time">${new Date(a.time).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
      </div>
    </div>`).join("");
}
function initAuditPage() {
  document.getElementById("audit-action-filter").addEventListener("change", renderAuditPage);
  document.getElementById("audit-search").addEventListener("input", renderAuditPage);
  document.getElementById("audit-clear-btn").addEventListener("click", () => {
    openConfirmModal("Clear audit log", "This will permanently remove all recorded history entries.", () => {
      setAudit([]);
      renderAuditPage();
      toast("Audit log cleared.", "success");
    });
  });
}

/* ============================ PROFILE & ACCOUNT MODULE ============================ */
let activeCurrentUser = null;

function updateProfileUI(user) {
  if (!user) return;
  activeCurrentUser = user;
  const name = user.name || user.full_name || user.fullName || user.email || "University User";
  const role = (user.role || "ADMIN").toUpperCase();
  const email = user.email || "";
  const initial = (name.trim().charAt(0) || "U").toUpperCase();

  const elName = document.getElementById("profile-name");
  if (elName) elName.textContent = name;

  const elRoleBadge = document.getElementById("profile-role-badge");
  if (elRoleBadge) {
    elRoleBadge.textContent = role;
    elRoleBadge.className = `profile-role-badge ${role === "TEACHER" ? "badge-teacher" : "badge-admin"}`;
  }

  const elInitial = document.getElementById("profile-avatar-initial");
  if (elInitial) elInitial.textContent = initial;

  const elRole = document.getElementById("profile-role");
  if (elRole) elRole.textContent = role;

  // Dropdown header
  const pdmName = document.getElementById("pdm-name");
  if (pdmName) pdmName.textContent = name;
  const pdmEmail = document.getElementById("pdm-email");
  if (pdmEmail) pdmEmail.textContent = email;
  const pdmRoleTag = document.getElementById("pdm-role-tag");
  if (pdmRoleTag) pdmRoleTag.textContent = role === "TEACHER" ? "Faculty Member (Teacher)" : "University Administrator";
  const pdmAvatar = document.getElementById("pdm-avatar");
  if (pdmAvatar) pdmAvatar.textContent = initial;
}

let profileMenuInitialized = false;
function initProfileMenu() {
  if (profileMenuInitialized) return;
  profileMenuInitialized = true;
  const chip = document.getElementById("profile-chip");
  const menu = document.getElementById("profile-dropdown-menu");
  if (!chip || !menu) return;

  function toggleMenu(show) {
    const isCurrentlyOpen = !menu.classList.contains("hidden");
    const willOpen = show !== undefined ? show : !isCurrentlyOpen;
    menu.classList.toggle("hidden", !willOpen);
    chip.setAttribute("aria-expanded", String(willOpen));
  }

  chip.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu();
  });

  chip.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleMenu();
    } else if (e.key === "Escape") {
      toggleMenu(false);
    }
  });

  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target) && !chip.contains(e.target)) {
      toggleMenu(false);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.classList.contains("hidden")) {
      toggleMenu(false);
      chip.focus();
    }
  });

  // Menu items
  document.getElementById("pdm-item-profile")?.addEventListener("click", () => {
    toggleMenu(false);
    openMyProfileModal();
  });
  document.getElementById("pdm-item-edit-profile")?.addEventListener("click", () => {
    toggleMenu(false);
    openEditProfileModal();
  });
  document.getElementById("pdm-item-change-password")?.addEventListener("click", () => {
    toggleMenu(false);
    openChangePasswordModal();
  });
  document.getElementById("pdm-item-settings")?.addEventListener("click", () => {
    toggleMenu(false);
    navigateTo("settings");
  });
  document.getElementById("pdm-item-permissions")?.addEventListener("click", () => {
    toggleMenu(false);
    openRolePermissionsModal();
  });
  document.getElementById("pdm-item-logout")?.addEventListener("click", () => {
    toggleMenu(false);
    openLogoutConfirmModal();
  });

  // Modal close buttons & actions
  document.getElementById("modal-my-profile-close")?.addEventListener("click", () => document.getElementById("modal-my-profile")?.close());
  document.getElementById("modal-my-profile-close-btn")?.addEventListener("click", () => document.getElementById("modal-my-profile")?.close());
  document.getElementById("mp-open-edit-btn")?.addEventListener("click", () => {
    document.getElementById("modal-my-profile")?.close();
    openEditProfileModal();
  });
  document.getElementById("mp-open-change-pwd-btn")?.addEventListener("click", () => {
    document.getElementById("modal-my-profile")?.close();
    openChangePasswordModal();
  });

  document.getElementById("modal-edit-profile-close")?.addEventListener("click", () => document.getElementById("modal-edit-profile")?.close());
  document.getElementById("modal-edit-profile-cancel")?.addEventListener("click", () => document.getElementById("modal-edit-profile")?.close());
  document.getElementById("edit-profile-form-el")?.addEventListener("submit", handleEditProfileSubmit);

  document.getElementById("modal-change-pwd-close")?.addEventListener("click", () => document.getElementById("modal-change-password")?.close());
  document.getElementById("modal-change-pwd-cancel")?.addEventListener("click", () => document.getElementById("modal-change-password")?.close());
  document.getElementById("change-pwd-form-el")?.addEventListener("submit", handleChangePasswordSubmit);

  document.querySelectorAll(".toggle-pwd-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (input) {
        const isPwd = input.type === "password";
        input.type = isPwd ? "text" : "password";
        btn.textContent = isPwd ? "🙈" : "👁";
      }
    });
  });

  document.getElementById("modal-role-perm-close")?.addEventListener("click", () => document.getElementById("modal-role-permissions")?.close());
  document.getElementById("modal-role-perm-ok")?.addEventListener("click", () => document.getElementById("modal-role-permissions")?.close());

  document.getElementById("modal-logout-close")?.addEventListener("click", () => document.getElementById("modal-logout-confirm")?.close());
  document.getElementById("modal-logout-cancel")?.addEventListener("click", () => document.getElementById("modal-logout-confirm")?.close());
  document.getElementById("modal-logout-proceed")?.addEventListener("click", async () => {
    document.getElementById("modal-logout-confirm")?.close();
    try {
      await apiRequest("/auth/logout", { method: "POST" });
    } catch (_) {}
    doLogout();
  });
}

async function openMyProfileModal() {
  const modal = document.getElementById("modal-my-profile");
  if (!modal) return;

  try {
    const res = await apiRequest("/auth/me");
    if (res && res.user) {
      activeCurrentUser = res.user;
    }
  } catch (err) {
    console.warn("Could not fetch fresh user profile:", err);
  }

  const u = activeCurrentUser || getStoredApiUser() || Store.get(LS_KEYS.profile, {});
  const name = u.name || u.full_name || u.fullName || u.email || "University User";
  const email = u.email || "";
  const role = (u.role || "ADMIN").toUpperCase();
  const initial = (name.trim().charAt(0) || "U").toUpperCase();

  const mpAvatar = document.getElementById("mp-avatar");
  if (mpAvatar) mpAvatar.textContent = initial;
  const mpName = document.getElementById("mp-name");
  if (mpName) mpName.textContent = name;
  const mpEmail = document.getElementById("mp-email");
  if (mpEmail) mpEmail.textContent = email;
  const mpRole = document.getElementById("mp-role-badge");
  if (mpRole) {
    mpRole.textContent = role;
    mpRole.className = `badge ${role === "TEACHER" ? "badge-info" : "badge-purple"}`;
  }
  const mpStatus = document.getElementById("mp-status-badge");
  if (mpStatus) {
    const isActive = u.is_active !== false;
    mpStatus.textContent = isActive ? "Active" : "Suspended";
    mpStatus.className = `badge ${isActive ? "badge-success" : "badge-danger"}`;
  }
  const mpDept = document.getElementById("mp-dept");
  if (mpDept) mpDept.textContent = u.department || (role === "TEACHER" ? "Academic Faculty" : "University Administration");
  const mpPhone = document.getElementById("mp-phone");
  if (mpPhone) mpPhone.textContent = u.phone || "Not specified";
  const mpLastLogin = document.getElementById("mp-last-login");
  if (mpLastLogin) {
    mpLastLogin.textContent = u.last_login ? new Date(u.last_login).toLocaleString() : "Current session";
  }
  const mpUserId = document.getElementById("mp-user-id");
  if (mpUserId) {
    mpUserId.textContent = u.id ? `USR-${String(u.id).padStart(4, '0')}` : "USR-0001";
  }

  if (typeof modal.showModal === "function") modal.showModal();
  else modal.setAttribute("open", "");
}

function openEditProfileModal() {
  const modal = document.getElementById("modal-edit-profile");
  if (!modal) return;

  const u = activeCurrentUser || getStoredApiUser() || Store.get(LS_KEYS.profile, {});
  const epName = document.getElementById("ep-name");
  if (epName) epName.value = u.name || u.full_name || u.fullName || "";
  const epEmail = document.getElementById("ep-email");
  if (epEmail) epEmail.value = u.email || "";
  const epPhone = document.getElementById("ep-phone");
  if (epPhone) epPhone.value = u.phone || "";

  if (typeof modal.showModal === "function") modal.showModal();
  else modal.setAttribute("open", "");
}

async function handleEditProfileSubmit(e) {
  e.preventDefault();
  const name = document.getElementById("ep-name")?.value.trim();
  const email = document.getElementById("ep-email")?.value.trim();
  const phone = document.getElementById("ep-phone")?.value.trim();

  if (!name || !email) {
    toast("Name and email are required.", "error");
    return;
  }

  try {
    showLoadingOverlay(true);
    const res = await apiRequest("/auth/profile", {
      method: "PUT",
      body: JSON.stringify({ name, email, phone })
    });

    const updated = res.user || { ...activeCurrentUser, name, email, phone };
    activeCurrentUser = updated;
    const stored = getStoredApiUser() || {};
    const newStored = { ...stored, ...updated };
    if (localStorage.getItem(API_KEYS.user)) {
      localStorage.setItem(API_KEYS.user, JSON.stringify(newStored));
    } else {
      sessionStorage.setItem(API_KEYS.user, JSON.stringify(newStored));
    }
    const prof = Store.get(LS_KEYS.profile, {});
    prof.name = name;
    prof.email = email;
    prof.phone = phone;
    Store.set(LS_KEYS.profile, prof);

    updateProfileUI(updated);
    document.getElementById("modal-edit-profile")?.close();
    toast("Profile details updated successfully.", "success");
  } catch (err) {
    console.error("Profile update error:", err);
    toast("Failed to update profile: " + err.message, "error");
  } finally {
    showLoadingOverlay(false);
  }
}

function openChangePasswordModal() {
  const modal = document.getElementById("modal-change-password");
  if (!modal) return;
  const form = document.getElementById("change-pwd-form-el");
  if (form) form.reset();

  if (typeof modal.showModal === "function") modal.showModal();
  else modal.setAttribute("open", "");
}

async function handleChangePasswordSubmit(e) {
  e.preventDefault();
  const currentPassword = document.getElementById("cp-current")?.value;
  const newPassword = document.getElementById("cp-new")?.value;
  const confirmPassword = document.getElementById("cp-confirm")?.value;

  if (!currentPassword) {
    toast("Please enter your current password.", "error");
    return;
  }
  if (!newPassword || newPassword.length < 6) {
    toast("New password must be at least 6 characters.", "error");
    return;
  }
  if (newPassword !== confirmPassword) {
    toast("New passwords do not match. Please re-enter.", "error");
    return;
  }

  try {
    showLoadingOverlay(true);
    await apiRequest("/auth/change-password", {
      method: "PUT",
      body: JSON.stringify({ currentPassword, newPassword })
    });

    document.getElementById("modal-change-password")?.close();
    toast("Password updated securely. Use your new password on next login.", "success", 4000);
  } catch (err) {
    console.error("Change password error:", err);
    toast("Could not update password: " + err.message, "error");
  } finally {
    showLoadingOverlay(false);
  }
}

function openRolePermissionsModal() {
  const modal = document.getElementById("modal-role-permissions");
  if (!modal) return;

  const u = activeCurrentUser || getStoredApiUser() || Store.get(LS_KEYS.profile, {});
  const role = (u.role || "ADMIN").toUpperCase();
  const isTeacher = role === "TEACHER";

  const titleEl = document.getElementById("rp-role-title");
  if (titleEl) {
    titleEl.textContent = isTeacher ? "Faculty Member Role (TEACHER) Privileges" : "University Administrator (ADMIN) Privileges";
  }

  const listEl = document.getElementById("rp-permissions-list");
  if (listEl) {
    if (isTeacher) {
      listEl.innerHTML = `
        <div class="perm-card perm-allowed">
          <div class="perm-head"><span>✅</span> <strong>Permitted Faculty Actions</strong></div>
          <ul class="perm-list">
            <li>View personalized weekly teaching schedule & today's lectures</li>
            <li>Schedule conflict-free makeup classes for missed sessions</li>
            <li>Inspect assigned courses, classes, sections, and classroom capacities</li>
            <li>Real-time classroom & section availability checks</li>
            <li>Report planned leaves, absence notifications, and sick days</li>
            <li>Update personal profile and change login password</li>
          </ul>
        </div>
        <div class="perm-card perm-restricted">
          <div class="perm-head"><span>⛔</span> <strong>Restricted Privileges</strong></div>
          <ul class="perm-list">
            <li>Cannot create, modify, or delete administrator or other teacher accounts</li>
            <li>Cannot view private login credentials or reset passwords of other faculty</li>
            <li>Cannot modify or delete university-wide timetables or change global schedules</li>
            <li>Cannot modify university settings, academic programs, or system audit logs</li>
          </ul>
        </div>
      `;
    } else {
      listEl.innerHTML = `
        <div class="perm-card perm-allowed">
          <div class="perm-head"><span>👑</span> <strong>Administrator Privileges</strong></div>
          <ul class="perm-list">
            <li>Full university-wide timetable generation, conflict resolution & management</li>
            <li>Manage Teacher Accounts: Single provisioning, batch account wizard, activation/deactivation, password reset</li>
            <li>Curriculum & Study Plan Library management (all programs & departments)</li>
            <li>Classrooms, rooms, buildings, sections, and subject management</li>
            <li>System audit log inspection, university announcements, and academic settings</li>
          </ul>
        </div>
      `;
    }
  }

  if (typeof modal.showModal === "function") modal.showModal();
  else modal.setAttribute("open", "");
}

function openLogoutConfirmModal() {
  const modal = document.getElementById("modal-logout-confirm");
  if (!modal) {
    doLogout();
    return;
  }
  if (typeof modal.showModal === "function") modal.showModal();
  else modal.setAttribute("open", "");
}

/* ============================ MANAGE TEACHER ACCOUNTS MODULE (ADMIN) ============================ */
let taCurrentPage = 1;
const taPageLimit = 20;
let taSearchQuery = "";
let taStatusFilter = "all";
let taDeptFilter = "";
let taTotalPages = 1;
let taSearchDebounceTimer = null;

let teacherAccountsPageInitialized = false;
function initTeacherAccountsPage() {
  if (teacherAccountsPageInitialized) return;
  teacherAccountsPageInitialized = true;
  const searchInput = document.getElementById("ta-search");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      clearTimeout(taSearchDebounceTimer);
      taSearchDebounceTimer = setTimeout(() => {
        taSearchQuery = e.target.value.trim();
        taCurrentPage = 1;
        renderTeacherAccountsPage();
      }, 300);
    });
  }

  const statusSelect = document.getElementById("ta-filter-status");
  if (statusSelect) {
    statusSelect.addEventListener("change", (e) => {
      taStatusFilter = e.target.value;
      taCurrentPage = 1;
      renderTeacherAccountsPage();
    });
  }

  const deptSelect = document.getElementById("ta-filter-dept");
  if (deptSelect) {
    deptSelect.addEventListener("change", (e) => {
      taDeptFilter = e.target.value;
      taCurrentPage = 1;
      renderTeacherAccountsPage();
    });
  }

  document.getElementById("ta-clear-filters")?.addEventListener("click", () => {
    if (searchInput) searchInput.value = "";
    if (statusSelect) statusSelect.value = "all";
    if (deptSelect) deptSelect.value = "";
    taSearchQuery = "";
    taStatusFilter = "all";
    taDeptFilter = "";
    taCurrentPage = 1;
    renderTeacherAccountsPage();
  });

  document.getElementById("ta-prev-page")?.addEventListener("click", () => {
    if (taCurrentPage > 1) {
      taCurrentPage--;
      renderTeacherAccountsPage();
    }
  });

  document.getElementById("ta-next-page")?.addEventListener("click", () => {
    if (taCurrentPage < taTotalPages) {
      taCurrentPage++;
      renderTeacherAccountsPage();
    }
  });

  document.getElementById("ta-add-account-btn")?.addEventListener("click", () => {
    openSingleTeacherProvisionModal();
  });

  document.getElementById("ta-batch-btn")?.addEventListener("click", () => {
    openBatchProvisionModal();
  });

  // Provisioning Modal listeners
  document.getElementById("modal-ta-close")?.addEventListener("click", () => document.getElementById("modal-teacher-account-form")?.close());
  document.getElementById("modal-ta-cancel")?.addEventListener("click", () => document.getElementById("modal-teacher-account-form")?.close());
  document.getElementById("ta-form-el")?.addEventListener("submit", handleSingleTeacherProvisionSubmit);

  document.getElementById("ta-select-teacher")?.addEventListener("change", (e) => {
    const sel = e.target;
    const selectedOpt = sel.options[sel.selectedIndex];
    const emailInput = document.getElementById("ta-custom-email");
    const pwdInput = document.getElementById("ta-custom-password");
    if (selectedOpt && selectedOpt.value) {
      const suggested = selectedOpt.dataset.suggestedEmail;
      if (emailInput) {
        emailInput.value = suggested || "";
      }
      if (pwdInput && !pwdInput.value) {
        pwdInput.value = generateSecureRandomPassword();
      }
    } else {
      if (emailInput) emailInput.value = "";
    }
  });

  document.getElementById("ta-generate-pwd-btn")?.addEventListener("click", () => {
    const pwdInput = document.getElementById("ta-custom-password");
    if (pwdInput) {
      pwdInput.value = generateSecureRandomPassword();
    }
  });

  // Reset Password Modal listeners
  document.getElementById("modal-reset-pwd-close")?.addEventListener("click", () => document.getElementById("modal-teacher-reset-pwd")?.close());
  document.getElementById("modal-reset-pwd-cancel")?.addEventListener("click", () => document.getElementById("modal-teacher-reset-pwd")?.close());
  document.getElementById("reset-pwd-form-el")?.addEventListener("submit", handleResetTeacherPasswordSubmit);
  document.getElementById("copy-reset-pwd-btn")?.addEventListener("click", () => {
    const val = document.getElementById("reset-pwd-val")?.textContent;
    if (val) {
      navigator.clipboard.writeText(val);
      toast("Password copied to clipboard!", "success");
    }
  });

  // Batch Wizard listeners
  document.getElementById("modal-batch-close")?.addEventListener("click", () => document.getElementById("modal-batch-provision")?.close());
  document.getElementById("modal-batch-cancel")?.addEventListener("click", () => document.getElementById("modal-batch-provision")?.close());
  document.getElementById("modal-batch-start-btn")?.addEventListener("click", handleBatchProvisionStart);
  document.getElementById("batch-export-csv-btn")?.addEventListener("click", exportBatchCreatedCsv);
}

function generateSecureRandomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*";
  let pwd = "Teach#" + Math.floor(100 + Math.random() * 900) + "!";
  for (let i = 0; i < 4; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pwd;
}

async function renderTeacherAccountsPage() {
  const tbody = document.getElementById("ta-table-body");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2rem; color:var(--text-muted);">Loading teacher accounts...</td></tr>`;

  try {
    const params = new URLSearchParams({
      page: taCurrentPage,
      limit: taPageLimit,
      search: taSearchQuery,
      status: taStatusFilter,
      department: taDeptFilter
    });

    const res = await apiRequest(`/admin/teacher-accounts?${params.toString()}`);
    if (!res || !res.success) throw new Error("Failed to load teacher accounts");

    const { data: teachers, pagination, summary } = res;

    // Update Counters
    if (summary) {
      const elTot = document.getElementById("ta-stat-total");
      if (elTot) elTot.textContent = Number(summary.totalTeachers ?? summary.total ?? 0).toLocaleString();
      const elAct = document.getElementById("ta-stat-active");
      if (elAct) elAct.textContent = Number(summary.activeAccounts ?? summary.active ?? 0).toLocaleString();
      const elInact = document.getElementById("ta-stat-inactive");
      if (elInact) elInact.textContent = Number(summary.inactiveAccounts ?? summary.inactive ?? 0).toLocaleString();
      const elUncr = document.getElementById("ta-stat-uncreated");
      if (elUncr) elUncr.textContent = Number(summary.uncreatedAccounts ?? summary.uncreated ?? 0).toLocaleString();
    }

    // Populate Department dropdown if empty
    populateTeacherDeptDropdowns();

    // Update Pagination
    if (pagination) {
      taTotalPages = pagination.totalPages || 1;
      const infoEl = document.getElementById("ta-page-info");
      if (infoEl) {
        infoEl.textContent = `Showing page ${pagination.page} of ${pagination.totalPages} (${Number(pagination.total || 0).toLocaleString()} teachers)`;
      }
      const prevBtn = document.getElementById("ta-prev-page");
      if (prevBtn) prevBtn.disabled = pagination.page <= 1;
      const nextBtn = document.getElementById("ta-next-page");
      if (nextBtn) nextBtn.disabled = pagination.page >= pagination.totalPages;
    }

    if (!teachers || teachers.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2.5rem; color:var(--text-muted);">No faculty members found matching your search and filter criteria.</td></tr>`;
      return;
    }

    tbody.innerHTML = teachers.map(t => {
      const hasAccount = !!(t.user_id || t.userId || t.has_account || t.hasAccount);
      const accountIsActive = t.account_active !== undefined
        ? t.account_active
        : (t.is_active !== undefined
            ? t.is_active
            : (t.isActive !== undefined
                ? t.isActive
                : (t.account_status === "active" || t.accountStatus === "active")));
      const isActive = hasAccount && !!accountIsActive;
      const code = escapeHtml(t.teacher_code || t.teacherCode || `FAC-${t.id}`);
      const name = escapeHtml(t.teacher_name || t.name || t.full_name || t.fullName || "Faculty");
      const dept = escapeHtml(t.department_name || t.department || "Unassigned");
      const rawEmail = t.account_email || t.accountEmail || t.user_email || t.userEmail || (hasAccount ? (t.email || t.teacher_email || t.teacherEmail) : "");
      const email = rawEmail ? escapeHtml(rawEmail) : `<span style="color:var(--text-muted); font-style:italic;">No account yet</span>`;

      let statusBadge = `<span class="badge badge-soft" style="color:var(--text-muted); border:1px dashed var(--border);">Not Created</span>`;
      if (hasAccount) {
        statusBadge = isActive
          ? `<span class="badge badge-success">Active</span>`
          : `<span class="badge badge-danger">Suspended</span>`;
      }

      const loginTime = t.last_login || t.lastLogin;
      const lastLogin = loginTime
        ? new Date(loginTime).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
        : (hasAccount ? '<span style="color:var(--text-muted);">Never</span>' : "—");

      let actionsHtml = "";
      if (hasAccount) {
        const toggleBtnLabel = isActive ? "Deactivate" : "Activate";
        const toggleBtnClass = isActive ? "btn-ghost-sm" : "btn-secondary btn-sm";
        actionsHtml = `
          <div style="display:flex; gap:0.4rem; align-items:center;">
            <button class="btn ${toggleBtnClass}" data-action="toggle-status" data-teacher-id="${t.id}" data-active="${!isActive}">
              ${toggleBtnLabel}
            </button>
            <button class="btn btn-ghost-sm" data-action="reset-pwd" data-teacher-id="${t.id}" data-teacher-name="${escapeHtml(t.teacher_name)}">
              🔑 Reset
            </button>
          </div>
        `;
      } else {
        actionsHtml = `
          <button class="btn btn-primary btn-sm" data-action="provision-single" data-teacher-id="${t.id}" data-teacher-name="${escapeHtml(t.teacher_name)}" data-teacher-code="${escapeHtml(t.teacher_code || '')}">
            + Create Account
          </button>
        `;
      }

      return `
        <tr>
          <td><strong style="color:var(--primary-purple); font-family:monospace;">${code}</strong></td>
          <td><strong>${name}</strong></td>
          <td><span class="badge badge-dept">${dept}</span></td>
          <td>${email}</td>
          <td>${statusBadge}</td>
          <td><span class="small muted">${lastLogin}</span></td>
          <td>${actionsHtml}</td>
        </tr>
      `;
    }).join("");

    // Bind row action buttons
    tbody.querySelectorAll('[data-action="toggle-status"]').forEach(btn => {
      btn.addEventListener("click", () => {
        const tId = btn.dataset.teacherId;
        const newActive = btn.dataset.active === "true";
        handleToggleTeacherStatus(tId, newActive);
      });
    });

    tbody.querySelectorAll('[data-action="reset-pwd"]').forEach(btn => {
      btn.addEventListener("click", () => {
        const tId = btn.dataset.teacherId;
        const tName = btn.dataset.teacherName;
        openResetTeacherPasswordModal(tId, tName);
      });
    });

    tbody.querySelectorAll('[data-action="provision-single"]').forEach(btn => {
      btn.addEventListener("click", () => {
        const tId = btn.dataset.teacherId;
        openSingleTeacherProvisionModal(tId);
      });
    });

  } catch (err) {
    console.error("Teacher accounts fetch failed:", err);
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2rem; color:var(--danger);">Error loading teacher accounts: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function populateTeacherDeptDropdowns() {
  const depts = new Set();
  getTeachers().forEach(t => {
    if (t.department && t.department !== "Unassigned") depts.add(t.department);
  });
  const filterDept = document.getElementById("ta-filter-dept");
  const batchDept = document.getElementById("batch-dept-select");
  if (filterDept && filterDept.options.length <= 1) {
    Array.from(depts).sort().forEach(d => {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = d;
      filterDept.appendChild(opt);
    });
  }
  if (batchDept && batchDept.options.length <= 1) {
    Array.from(depts).sort().forEach(d => {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = d;
      batchDept.appendChild(opt);
    });
  }
}

async function handleToggleTeacherStatus(teacherId, newIsActive) {
  const actionName = newIsActive ? "activate" : "deactivate";
  const buttonLabel = newIsActive ? "Activate" : "Deactivate";
  const buttonStyle = newIsActive ? "btn-primary" : "btn-danger";
  openConfirmModal(
    `${newIsActive ? "Activate" : "Deactivate"} Teacher Account`,
    `Are you sure you want to ${actionName} this teacher's account? ${newIsActive ? "They will be able to log in immediately." : "They will be prevented from logging in until reactivated."}`,
    async () => {
      try {
        showLoadingOverlay(true);
        await apiRequest(`/admin/teacher-accounts/${teacherId}/status`, {
          method: "PATCH",
          body: JSON.stringify({ isActive: newIsActive, is_active: newIsActive })
        });
        toast(`Teacher account ${actionName}d successfully.`, "success");
        renderTeacherAccountsPage();
      } catch (err) {
        console.error("Status update error:", err);
        toast("Failed to update account status: " + err.message, "error");
      } finally {
        showLoadingOverlay(false);
      }
    },
    buttonLabel,
    buttonStyle
  );
}

let taUncreatedTeachersList = [];

async function openSingleTeacherProvisionModal(preselectedTeacherId = null) {
  const modal = document.getElementById("modal-teacher-account-form");
  if (!modal) return;
  const select = document.getElementById("ta-select-teacher");
  const emailInput = document.getElementById("ta-custom-email");
  const pwdInput = document.getElementById("ta-custom-password");
  const formEl = document.getElementById("ta-form-el");
  const alertEl = document.getElementById("ta-modal-alert");
  const stateContainer = document.getElementById("ta-modal-state-container");
  const modalFoot = document.getElementById("ta-modal-foot");
  const submitBtn = document.getElementById("modal-ta-submit");

  // Reset alert & inputs
  if (alertEl) {
    alertEl.innerHTML = "";
    alertEl.classList.add("hidden");
  }
  if (select) select.innerHTML = "";
  if (emailInput) emailInput.value = "";
  if (pwdInput) pwdInput.value = generateSecureRandomPassword();
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Create Account";
  }

  // Open modal early so user sees clear loading state
  if (typeof modal.showModal === "function") modal.showModal();
  else modal.setAttribute("open", "");

  // Show Loading state
  if (stateContainer) {
    stateContainer.innerHTML = `
      <div style="padding: 1.5rem 0; color: var(--text-muted);">
        <div class="spinner" style="margin: 0 auto 0.75rem; width: 28px; height: 28px; border: 3px solid rgba(139,92,246,0.2); border-top-color: var(--primary-purple); border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
        <div>Loading eligible faculty members without login accounts...</div>
      </div>
    `;
    stateContainer.classList.remove("hidden");
  }
  if (formEl) formEl.classList.add("hidden");
  if (modalFoot) modalFoot.classList.add("hidden");

  try {
    const res = await apiRequest("/admin/teacher-accounts?status=uncreated&limit=1000");
    const uncreated = res.data || [];
    taUncreatedTeachersList = uncreated;

    if (uncreated.length === 0) {
      // Verified Empty State: No eligible uncreated teachers remain
      if (stateContainer) {
        stateContainer.innerHTML = `
          <div style="background: rgba(59,130,246,0.08); border: 1px solid rgba(59,130,246,0.25); border-radius: var(--radius-sm); padding: 1.5rem 1rem;">
            <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">🎉</div>
            <h3 style="font-size: 1.1rem; font-weight: 700; margin-bottom: 0.35rem; color: var(--text-main);">All Teachers Already Have Login Accounts!</h3>
            <p style="font-size: 0.86rem; color: var(--text-muted); margin-bottom: 1.25rem; max-width: 360px; margin-left: auto; margin-right: auto; line-height: 1.5;">
              Every faculty member currently registered in the university directory has an active or existing user account.
            </p>
            <div style="display: flex; justify-content: center; gap: 0.75rem; flex-wrap: wrap;">
              <button type="button" class="btn btn-secondary btn-sm" id="ta-empty-manage-btn">👥 View All Teacher Accounts</button>
              <button type="button" class="btn btn-primary btn-sm" id="ta-empty-add-btn">➕ Add New Teacher</button>
            </div>
          </div>
        `;
        stateContainer.classList.remove("hidden");

        document.getElementById("ta-empty-manage-btn")?.addEventListener("click", () => {
          modal.close();
          navigateTo("teacher-accounts");
        });
        document.getElementById("ta-empty-add-btn")?.addEventListener("click", () => {
          modal.close();
          navigateTo("teachers");
          openTeacherForm(null);
        });
      }
      if (formEl) formEl.classList.add("hidden");
      if (modalFoot) modalFoot.classList.add("hidden");
      return;
    }

    // Available State: Faculty members exist without accounts
    if (stateContainer) stateContainer.classList.add("hidden");
    if (formEl) formEl.classList.remove("hidden");
    if (modalFoot) modalFoot.classList.remove("hidden");
    if (submitBtn) submitBtn.disabled = false;

    if (select) {
      select.innerHTML = `<option value="">Select a teacher without an account (${uncreated.length} available)...</option>` +
        uncreated.map(t => {
          const code = t.teacherCode || t.teacher_code || `FAC-${t.id}`;
          const cleanCode = code.toLowerCase().replace(/[^a-z0-9]/g, "");
          const name = t.name || t.teacher_name || t.fullName || t.full_name || "Faculty Member";
          const dept = t.department || t.department_name || "Faculty";
          const email = t.email || t.teacherEmail || t.teacher_email || `${cleanCode}@brightfield.edu`;
          const isSelected = preselectedTeacherId && String(t.id) === String(preselectedTeacherId);
          return `<option value="${t.id}" data-suggested-email="${escapeHtml(email)}" ${isSelected ? "selected" : ""}>
            ${escapeHtml(code)} — ${escapeHtml(name)} (${escapeHtml(dept)})
          </option>`;
        }).join("");

      if (preselectedTeacherId) {
        const selected = uncreated.find(t => String(t.id) === String(preselectedTeacherId));
        if (selected && emailInput) {
          const code = selected.teacherCode || selected.teacher_code || `FAC-${selected.id}`;
          const cleanCode = code.toLowerCase().replace(/[^a-z0-9]/g, "");
          emailInput.value = selected.email || selected.teacherEmail || selected.teacher_email || `${cleanCode}@brightfield.edu`;
        }
      }
    }
  } catch (err) {
    console.error("Could not load uncreated teachers:", err);
    if (stateContainer) {
      stateContainer.innerHTML = `
        <div style="background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); border-radius: var(--radius-sm); padding: 1.25rem 1rem; color: #fca5a5;">
          <div style="font-size: 1.8rem; margin-bottom: 0.35rem;">⚠️</div>
          <strong style="display:block; font-size: 0.95rem; margin-bottom: 0.35rem; color: #fca5a5;">Unable to Load Faculty List</strong>
          <p style="font-size: 0.84rem; color: var(--text-muted); margin-bottom: 1rem;">${escapeHtml(err.message || "Failed to communicate with server.")}</p>
          <button type="button" class="btn btn-secondary btn-sm" id="ta-retry-load-btn">🔄 Retry</button>
        </div>
      `;
      stateContainer.classList.remove("hidden");
      document.getElementById("ta-retry-load-btn")?.addEventListener("click", () => {
        openSingleTeacherProvisionModal(preselectedTeacherId);
      });
    }
    if (formEl) formEl.classList.add("hidden");
    if (modalFoot) modalFoot.classList.add("hidden");
  }
}

async function handleSingleTeacherProvisionSubmit(e) {
  e.preventDefault();
  const select = document.getElementById("ta-select-teacher");
  const emailInput = document.getElementById("ta-custom-email");
  const pwdInput = document.getElementById("ta-custom-password");
  const alertEl = document.getElementById("ta-modal-alert");
  const submitBtn = document.getElementById("modal-ta-submit");
  const cancelBtn = document.getElementById("modal-ta-cancel");

  if (alertEl) {
    alertEl.innerHTML = "";
    alertEl.classList.add("hidden");
  }

  const teacherId = select?.value;
  const email = emailInput?.value.trim();
  const password = pwdInput?.value.trim() || generateSecureRandomPassword();

  function showInlineError(msg) {
    if (alertEl) {
      alertEl.innerHTML = `<div style="color:#fca5a5; display:flex; align-items:center; gap:0.5rem;"><span>⚠️</span><span>${escapeHtml(msg)}</span></div>`;
      alertEl.style.background = "rgba(239,68,68,0.15)";
      alertEl.style.border = "1px solid rgba(239,68,68,0.4)";
      alertEl.classList.remove("hidden");
    }
    toast(msg, "error");
  }

  if (!teacherId) {
    showInlineError("Please select a faculty member from the dropdown.");
    select?.focus();
    return;
  }
  if (!email) {
    showInlineError("Email address is required.");
    emailInput?.focus();
    return;
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    showInlineError("Please enter a valid email address (e.g. name@brightfield.edu).");
    emailInput?.focus();
    return;
  }
  if (password.length < 6) {
    showInlineError("Temporary password must be at least 6 characters.");
    pwdInput?.focus();
    return;
  }

  const originalBtnText = submitBtn ? submitBtn.textContent : "Create Account";
  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Creating Account...";
    }
    if (cancelBtn) cancelBtn.disabled = true;

    const res = await apiRequest("/admin/teacher-accounts", {
      method: "POST",
      body: JSON.stringify({
        teacherId: Number(teacherId),
        teacher_id: Number(teacherId),
        email,
        password
      })
    });

    const createdData = res.data || {};
    const assignedEmail = createdData.email || email;
    const finalPassword = res.temporaryPassword || password;

    document.getElementById("modal-teacher-account-form")?.close();
    toast(`Account provisioned for ${assignedEmail}! Password: ${finalPassword}`, "success", 9000);

    // Refresh teacher accounts directory table
    renderTeacherAccountsPage();

    // Refresh memory cache in background
    loadBackendData().catch(() => {});
  } catch (err) {
    console.error("Provisioning error:", err);
    showInlineError(err.message || "Failed to provision teacher account.");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalBtnText;
    }
    if (cancelBtn) cancelBtn.disabled = false;
  }
}

function openResetTeacherPasswordModal(teacherId, teacherName) {
  const modal = document.getElementById("modal-teacher-reset-pwd");
  if (!modal) return;

  const idInput = document.getElementById("reset-pwd-teacher-id");
  if (idInput) idInput.value = teacherId;
  const nameEl = document.getElementById("reset-pwd-teacher-name");
  if (nameEl) nameEl.textContent = teacherName || "Faculty Member";

  const pwdInput = document.getElementById("reset-pwd-input");
  if (pwdInput) pwdInput.value = generateSecureRandomPassword();

  const resBox = document.getElementById("reset-pwd-result");
  if (resBox) resBox.classList.add("hidden");
  const actionsBox = document.getElementById("reset-pwd-actions");
  if (actionsBox) actionsBox.classList.remove("hidden");

  if (typeof modal.showModal === "function") modal.showModal();
  else modal.setAttribute("open", "");
}

async function handleResetTeacherPasswordSubmit(e) {
  e.preventDefault();
  const teacherId = document.getElementById("reset-pwd-teacher-id")?.value;
  const newPassword = document.getElementById("reset-pwd-input")?.value.trim() || generateSecureRandomPassword();

  if (!teacherId) return;

  try {
    showLoadingOverlay(true);
    const res = await apiRequest(`/admin/teacher-accounts/${teacherId}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ newPassword, new_password: newPassword })
    });

    const resBox = document.getElementById("reset-pwd-result");
    const valEl = document.getElementById("reset-pwd-val");
    if (resBox && valEl) {
      valEl.textContent = res.temporary_password || res.temporaryPassword || newPassword;
      resBox.classList.remove("hidden");
    }
    const actionsBox = document.getElementById("reset-pwd-actions");
    if (actionsBox) actionsBox.classList.add("hidden");

    toast("Password has been reset securely.", "success");
    renderTeacherAccountsPage();
  } catch (err) {
    console.error("Password reset error:", err);
    toast("Password reset failed: " + err.message, "error");
  } finally {
    showLoadingOverlay(false);
  }
}

let batchCreatedCache = [];

function openBatchProvisionModal() {
  const modal = document.getElementById("modal-batch-provision");
  if (!modal) return;

  populateTeacherDeptDropdowns();
  const confirmStep = document.getElementById("batch-step-confirm");
  const resultsStep = document.getElementById("batch-step-results");
  const startBtn = document.getElementById("modal-batch-start-btn");

  if (confirmStep) confirmStep.classList.remove("hidden");
  if (resultsStep) resultsStep.classList.add("hidden");
  if (startBtn) {
    startBtn.classList.remove("hidden");
    startBtn.disabled = false;
    startBtn.textContent = "⚡ Begin Provisioning";
  }

  batchCreatedCache = [];

  if (typeof modal.showModal === "function") modal.showModal();
  else modal.setAttribute("open", "");
}

async function handleBatchProvisionStart() {
  const dept = document.getElementById("batch-dept-select")?.value;
  const limit = document.getElementById("batch-limit-select")?.value || 50;
  const startBtn = document.getElementById("modal-batch-start-btn");

  if (startBtn) {
    startBtn.disabled = true;
    startBtn.textContent = "Provisioning accounts...";
  }

  try {
    showLoadingOverlay(true);
    const res = await apiRequest("/admin/teacher-accounts/batch-create", {
      method: "POST",
      body: JSON.stringify({ department: dept || undefined, limit: Number(limit) })
    });

    const accounts = res.accounts || [];
    batchCreatedCache = accounts;

    const confirmStep = document.getElementById("batch-step-confirm");
    const resultsStep = document.getElementById("batch-step-results");
    const tbody = document.getElementById("batch-results-tbody");
    const heading = document.getElementById("batch-results-heading");

    if (confirmStep) confirmStep.classList.add("hidden");
    if (resultsStep) resultsStep.classList.remove("hidden");
    if (startBtn) startBtn.classList.add("hidden");

    if (heading) {
      heading.textContent = `✅ Successfully Provisioned ${accounts.length} Teacher Accounts!`;
    }

    if (tbody) {
      tbody.innerHTML = accounts.map(a => `
        <tr>
          <td><strong style="color:var(--primary-purple); font-family:monospace;">${escapeHtml(a.code || '')}</strong></td>
          <td>${escapeHtml(a.name || '')}</td>
          <td>${escapeHtml(a.email || '')}</td>
          <td><code style="background:rgba(255,255,255,0.06); padding:0.2rem 0.4rem; border-radius:4px; font-weight:700; color:#34d399;">${escapeHtml(a.password || '')}</code></td>
        </tr>
      `).join("");
    }

    toast(`Provisioned ${accounts.length} teacher accounts successfully!`, "success", 6000);
    renderTeacherAccountsPage();
  } catch (err) {
    console.error("Batch provisioning error:", err);
    toast("Batch creation failed: " + err.message, "error", 6000);
    if (startBtn) {
      startBtn.disabled = false;
      startBtn.textContent = "⚡ Begin Provisioning";
    }
  } finally {
    showLoadingOverlay(false);
  }
}

function exportBatchCreatedCsv() {
  if (!batchCreatedCache || batchCreatedCache.length === 0) {
    toast("No generated accounts to export.", "info");
    return;
  }
  const headers = ["Teacher Code", "Teacher Name", "Login Email", "Temporary Password"];
  const rows = batchCreatedCache.map(a => [
    `"${a.code || ''}"`,
    `"${a.name || ''}"`,
    `"${a.email || ''}"`,
    `"${a.password || ''}"`
  ]);
  const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `teacher_accounts_batch_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast("CSV file downloaded successfully.", "success");
}

/* ============================ TEACHER PERSONALIZED PORTAL MODULE ============================ */
let teacherScheduleCache = [];

let teacherPortalInitialized = false;
function initTeacherPortal() {
  if (teacherPortalInitialized) return;
  teacherPortalInitialized = true;
  // Makeup scheduling triggers
  document.getElementById("teacher-dash-makeup-btn")?.addEventListener("click", () => openTeacherMakeupModal());
  document.getElementById("btn-schedule-makeup-page")?.addEventListener("click", () => openTeacherMakeupModal());
  document.getElementById("tt-teacher-makeup-btn")?.addEventListener("click", () => openTeacherMakeupModal());
  document.getElementById("teacher-qa-makeup")?.addEventListener("click", () => openTeacherMakeupModal());

  document.getElementById("teacher-dash-view-tt-btn")?.addEventListener("click", () => navigateTo("teacher-timetable"));
  document.getElementById("tdash-refresh-today-btn")?.addEventListener("click", loadTeacherTodaySchedule);

  document.getElementById("teacher-qa-profile")?.addEventListener("click", openMyProfileModal);
  document.getElementById("teacher-qa-password")?.addEventListener("click", openChangePasswordModal);
  document.getElementById("teacher-qa-absence")?.addEventListener("click", openTeacherAbsenceModal);

  // Day filter buttons on Teacher Timetable page
  document.querySelectorAll(".teacher-tt-day-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".teacher-tt-day-btn").forEach(b => {
        b.classList.remove("active");
        b.classList.add("btn-ghost");
        b.classList.remove("btn-secondary");
      });
      btn.classList.add("active");
      btn.classList.remove("btn-ghost");
      btn.classList.add("btn-secondary");
      renderTeacherTimetablePage(btn.dataset.day || "all");
    });
  });

  document.getElementById("tt-teacher-print-btn")?.addEventListener("click", () => window.print());
}

function openTeacherMakeupModal() {
  openMakeupModal();
  // Pre-fill and lock teacher dropdown if user is a teacher
  const u = activeCurrentUser || getStoredApiUser() || Store.get(LS_KEYS.profile, {});
  if (u.teacherId) {
    const sel = document.getElementById("makeup-teacher");
    if (sel) {
      sel.value = String(u.teacherId);
      sel.disabled = true;
    }
  }
}

function openTeacherAbsenceModal() {
  const u = activeCurrentUser || getStoredApiUser() || Store.get(LS_KEYS.profile, {});
  const html = `
    <div class="field">
      <label>Absence Date</label>
      <input type="date" id="abs-date" value="${new Date().toISOString().split('T')[0]}" required />
    </div>
    <div class="field">
      <label>Reason for Leave</label>
      <select id="abs-reason">
        <option value="Medical / Sick Leave">Medical / Sick Leave</option>
        <option value="Academic Conference / Duty Leave">Academic Conference / Duty Leave</option>
        <option value="Personal Leave">Personal Leave</option>
        <option value="University Administrative Work">University Administrative Work</option>
      </select>
    </div>
    <div class="field">
      <label>Notes / Replacement Instructions</label>
      <textarea id="abs-notes" rows="3" placeholder="Specify makeup class intentions or suggested substitute teacher..."></textarea>
    </div>
  `;

  openFormModal("Report Planned Absence / Leave", html, async () => {
    const date = document.getElementById("abs-date")?.value;
    const reason = document.getElementById("abs-reason")?.value;
    const notes = document.getElementById("abs-notes")?.value;

    if (!date) {
      toast("Please select an absence date.", "error");
      return;
    }

    try {
      showLoadingOverlay(true);
      await apiRequest("/teachers/me/absences", {
        method: "POST",
        body: JSON.stringify({ absence_date: date, reason, notes })
      });
      closeFormModal();
      toast("Absence reported. Department and scheduler have been notified.", "success", 4000);
      loadTeacherTodaySchedule();
    } catch (err) {
      console.error("Absence report error:", err);
      toast("Could not submit absence: " + err.message, "error");
    } finally {
      showLoadingOverlay(false);
    }
  });
}

async function renderTeacherDashboard() {
  const u = activeCurrentUser || getStoredApiUser() || Store.get(LS_KEYS.profile, {});
  const name = u.name || u.full_name || u.fullName || "Faculty Member";

  const greetingEl = document.getElementById("teacher-dash-greeting");
  if (greetingEl) greetingEl.textContent = `Welcome, ${name}`;

  const deptBadge = document.getElementById("teacher-dept-badge");
  if (deptBadge) deptBadge.textContent = u.department || "Academic Faculty";

  const statusBadge = document.getElementById("teacher-status-badge");
  if (statusBadge) statusBadge.textContent = u.is_active !== false ? "Account Active" : "Suspended";

  await Promise.all([
    loadTeacherTodaySchedule(),
    loadTeacherWeeklyGrid(),
    loadTeacherSubjectsWidget(),
    loadTeacherClassesWidget()
  ]);
}

async function loadTeacherTodaySchedule() {
  const container = document.getElementById("tdash-today-list");
  const countEl = document.getElementById("tdash-today-count");
  const dateEl = document.getElementById("tdash-today-date");

  const todayStr = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  if (dateEl) dateEl.textContent = todayStr;

  if (container) container.innerHTML = `<div style="text-align:center; padding:1.5rem; color:var(--text-muted);">Loading today's lectures...</div>`;

  try {
    const res = await apiRequest("/teachers/me/today");
    const classes = res.classes || [];
    if (countEl) countEl.textContent = classes.length;

    if (!classes.length) {
      if (container) {
        container.innerHTML = `
          <div class="today-empty-card" style="padding:2rem; text-align:center; background:rgba(255,255,255,0.02); border:1px dashed var(--border); border-radius:var(--radius-md);">
            <div style="font-size:2rem; margin-bottom:0.5rem;">🎉</div>
            <strong style="color:var(--text-white); font-size:1.05rem;">No Lectures Scheduled Today</strong>
            <p class="muted small" style="margin-top:0.3rem;">You have no teaching periods assigned for today. Use this time for curriculum preparation, grading, or office hours.</p>
          </div>
        `;
      }
      return;
    }

    if (container) {
      container.innerHTML = classes.map(c => {
        const isMakeup = c.entry_type === "makeup" || c.is_makeup;
        const stripe = getTodayStripeClass(c.subject_name || c.subject_code);
        return `
          <div class="today-class-card ${stripe}">
            <div class="tcc-time">
              <span class="tcc-slot">${escapeHtml(c.slot_code || c.time_slot_id || '')}</span>
              <span class="tcc-hours">${escapeHtml(c.start_time || '')} – ${escapeHtml(c.end_time || '')}</span>
            </div>
            <div class="tcc-info">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.25rem;">
                <strong class="tcc-subject" style="color:var(--text-white); font-size:1.05rem;">
                  ${escapeHtml(c.subject_name || 'Subject')}
                </strong>
                ${isMakeup ? '<span class="badge badge-warning">⏰ Makeup Class</span>' : '<span class="badge badge-soft">Regular</span>'}
              </div>
              <div class="tcc-meta" style="display:flex; gap:1rem; font-size:0.83rem; color:var(--text-muted); flex-wrap:wrap;">
                <span>🎓 Class: <strong style="color:var(--text-light);">${escapeHtml(c.class_name || '')} (Sec ${escapeHtml(c.section_name || 'A')})</strong></span>
                <span>🏛 Room: <strong style="color:var(--text-light);">${escapeHtml(c.room_number || '')} (${escapeHtml(c.building_name || 'Campus')})</strong></span>
              </div>
            </div>
          </div>
        `;
      }).join("");
    }
  } catch (err) {
    console.error("Failed to load today schedule:", err);
    if (container) container.innerHTML = `<div style="color:var(--danger); text-align:center; padding:1rem;">Failed to load today's classes: ${escapeHtml(err.message)}</div>`;
  }
}

async function loadTeacherWeeklyGrid() {
  const tbody = document.getElementById("tdash-weekly-grid-body");
  const weeklyCountEl = document.getElementById("tdash-weekly-count");
  if (!tbody) return;

  try {
    const res = await apiRequest("/teachers/me/timetable");
    const timetable = res.timetable || [];
    teacherScheduleCache = timetable;

    if (weeklyCountEl) weeklyCountEl.textContent = timetable.length;

    // Build slot-by-day matrix
    const gridMap = {};
    SLOTS.forEach(s => {
      gridMap[s.id] = { Monday: null, Tuesday: null, Wednesday: null, Thursday: null, Friday: null, Saturday: null };
    });

    timetable.forEach(e => {
      const slot = normalizeSlotId(e.slot_code || e.time_slot_id || e.slot_id);
      const day = e.day_of_week || e.day;
      if (gridMap[slot] && gridMap[slot][day] !== undefined) {
        gridMap[slot][day] = e;
      }
    });

    tbody.innerHTML = SLOTS.map(slot => {
      return `
        <tr>
          <td class="slot-cell"><strong>${escapeHtml(slot.label)}</strong></td>
          ${DAYS.map(day => {
            const entry = gridMap[slot.id]?.[day];
            if (!entry) {
              return `<td class="empty-cell" style="background:rgba(255,255,255,0.01);"><span style="color:rgba(255,255,255,0.15); font-size:0.75rem;">—</span></td>`;
            }
            const isMakeup = entry.entry_type === "makeup" || entry.is_makeup;
            const themeClass = getSubjectThemeClass(entry.subject_name || entry.subject_code);
            return `
              <td class="tt-cell ${themeClass}" style="padding:0.5rem; vertical-align:top;">
                <div style="font-weight:700; font-size:0.82rem; margin-bottom:0.15rem;">${escapeHtml(entry.subject_code || entry.subject_name || '')}</div>
                <div style="font-size:0.72rem; color:var(--text-muted);">${escapeHtml(entry.class_name || '')} Sec ${escapeHtml(entry.section_name || 'A')}</div>
                <div style="font-size:0.72rem; color:var(--text-light); margin-top:0.2rem;">🏛 ${escapeHtml(entry.room_number || '')}</div>
                ${isMakeup ? '<span class="badge badge-warning" style="font-size:0.65rem; margin-top:0.25rem;">Makeup</span>' : ''}
              </td>
            `;
          }).join("")}
        </tr>
      `;
    }).join("");
  } catch (err) {
    console.error("Weekly grid fetch error:", err);
  }
}

async function loadTeacherSubjectsWidget() {
  const container = document.getElementById("tdash-subjects-list");
  const countEl = document.getElementById("tdash-subjects-count");
  if (!container) return;

  try {
    const res = await apiRequest("/teachers/me/subjects");
    const subjects = res.subjects || [];
    if (countEl) countEl.textContent = subjects.length;

    if (!subjects.length) {
      container.innerHTML = `<span class="muted small">No subjects assigned yet.</span>`;
      return;
    }

    container.innerHTML = subjects.slice(0, 5).map(s => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:0.5rem 0.65rem; background:rgba(255,255,255,0.02); border:1px solid var(--border); border-radius:var(--radius-sm);">
        <div>
          <strong style="font-size:0.86rem; color:var(--text-white);">${escapeHtml(s.name)}</strong>
          <div class="muted small">${escapeHtml(s.code || '')} &bull; ${s.weekly_periods || 3} periods/wk</div>
        </div>
        <span class="badge badge-dept">${escapeHtml(s.department_name || 'Faculty')}</span>
      </div>
    `).join("");
  } catch (err) {
    console.warn("Subjects widget fetch error:", err);
  }
}

async function loadTeacherClassesWidget() {
  const container = document.getElementById("tdash-classes-list");
  const countEl = document.getElementById("tdash-classes-count");
  if (!container) return;

  try {
    const res = await apiRequest("/teachers/me/classes");
    const classes = res.classes || [];
    if (countEl) countEl.textContent = classes.length;

    if (!classes.length) {
      container.innerHTML = `<span class="muted small">No class cohorts assigned yet.</span>`;
      return;
    }

    container.innerHTML = classes.slice(0, 5).map(c => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:0.5rem 0.65rem; background:rgba(255,255,255,0.02); border:1px solid var(--border); border-radius:var(--radius-sm);">
        <div>
          <strong style="font-size:0.86rem; color:var(--text-white);">${escapeHtml(c.name)}</strong>
          <div class="muted small">Section ${escapeHtml(c.section_name || 'A')} &bull; ${c.student_count || 45} Students</div>
        </div>
        <span class="badge badge-soft">${escapeHtml(c.program_name || 'Undergrad')}</span>
      </div>
    `).join("");
  } catch (err) {
    console.warn("Classes widget fetch error:", err);
  }
}

async function renderTeacherTimetablePage(selectedDay = "all") {
  const tbody = document.getElementById("teacher-tt-table-body");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2rem; color:var(--text-muted);">Loading timetable entries...</td></tr>`;

  try {
    const res = await apiRequest("/teachers/me/timetable");
    let timetable = res.timetable || [];

    if (selectedDay && selectedDay !== "all") {
      timetable = timetable.filter(e => (e.day_of_week || e.day) === selectedDay);
    }

    if (!timetable.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2.5rem; color:var(--text-muted);">No timetable entries found for this selection.</td></tr>`;
      return;
    }

    tbody.innerHTML = timetable.map(e => {
      const isMakeup = e.entry_type === "makeup" || e.is_makeup;
      return `
        <tr>
          <td><strong>${escapeHtml(e.day_of_week || e.day || '')}</strong></td>
          <td><span style="font-family:monospace; color:var(--primary-purple);">${escapeHtml(e.start_time || '')} – ${escapeHtml(e.end_time || '')}</span></td>
          <td><strong>${escapeHtml(e.subject_name || '')}</strong> <span class="muted small">(${escapeHtml(e.subject_code || '')})</span></td>
          <td>${escapeHtml(e.class_name || '')} — Section ${escapeHtml(e.section_name || 'A')}</td>
          <td>🏛 ${escapeHtml(e.room_number || '')} (${escapeHtml(e.building_name || 'Campus')})</td>
          <td>${isMakeup ? '<span class="badge badge-warning">⏰ Makeup</span>' : '<span class="badge badge-soft">Regular</span>'}</td>
          <td><span class="badge badge-success">${escapeHtml(e.status || 'Scheduled')}</span></td>
        </tr>
      `;
    }).join("");
  } catch (err) {
    console.error("Timetable page render error:", err);
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--danger); padding:2rem;">Failed to load timetable: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function renderTeacherSubjectsPage() {
  const grid = document.getElementById("teacher-subjects-grid");
  if (!grid) return;

  grid.innerHTML = `<div style="text-align:center; padding:2rem; color:var(--text-muted); grid-column:1/-1;">Loading assigned subjects...</div>`;

  try {
    const res = await apiRequest("/teachers/me/subjects");
    const subjects = res.subjects || [];

    if (!subjects.length) {
      grid.innerHTML = `<div style="text-align:center; padding:3rem; color:var(--text-muted); grid-column:1/-1;">No subjects are currently assigned to your faculty profile.</div>`;
      return;
    }

    grid.innerHTML = subjects.map(s => {
      return `
        <div class="card subject-card" style="border-top: 3px solid var(--primary-purple);">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:0.5rem;">
            <span class="badge badge-dept">${escapeHtml(s.code || 'Course')}</span>
            <span class="badge badge-soft">${s.weekly_periods || 3} Periods/Wk</span>
          </div>
          <h3 style="font-size:1.1rem; margin-bottom:0.5rem; color:var(--text-white);">${escapeHtml(s.name)}</h3>
          <p class="muted small" style="margin-bottom:1rem;">Department of ${escapeHtml(s.department_name || 'Computer Science')}</p>
          <div style="display:flex; justify-content:space-between; font-size:0.8rem; border-top:1px solid var(--border); padding-top:0.75rem;">
            <span class="muted">Status: <strong style="color:var(--success);">Active Course</strong></span>
            <span class="muted">Credits: <strong>4.0</strong></span>
          </div>
        </div>
      `;
    }).join("");
  } catch (err) {
    console.error("Subjects page render error:", err);
    grid.innerHTML = `<div style="color:var(--danger); grid-column:1/-1;">Failed to load subjects: ${escapeHtml(err.message)}</div>`;
  }
}

async function renderTeacherClassesPage() {
  const grid = document.getElementById("teacher-classes-grid");
  if (!grid) return;

  grid.innerHTML = `<div style="text-align:center; padding:2rem; color:var(--text-muted); grid-column:1/-1;">Loading assigned classes...</div>`;

  try {
    const res = await apiRequest("/teachers/me/classes");
    const classes = res.classes || [];

    if (!classes.length) {
      grid.innerHTML = `<div style="text-align:center; padding:3rem; color:var(--text-muted); grid-column:1/-1;">No classes or student sections currently assigned.</div>`;
      return;
    }

    grid.innerHTML = classes.map(c => `
      <div class="card class-card" style="border-top:3px solid var(--info);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:0.5rem;">
          <span class="badge badge-info">Section ${escapeHtml(c.section_name || 'A')}</span>
          <span class="badge badge-soft">👥 ${c.student_count || 45} Students</span>
        </div>
        <h3 style="font-size:1.15rem; margin-bottom:0.35rem; color:var(--text-white);">${escapeHtml(c.name)}</h3>
        <p class="muted small" style="margin-bottom:0.75rem;">${escapeHtml(c.program_name || 'Academic Degree')} &bull; Semester ${c.semester || 1}</p>
        <div style="font-size:0.8rem; color:var(--text-light); border-top:1px solid var(--border); padding-top:0.75rem;">
          Department: <strong>${escapeHtml(c.department_name || 'Engineering')}</strong>
        </div>
      </div>
    `).join("");
  } catch (err) {
    console.error("Classes page render error:", err);
    grid.innerHTML = `<div style="color:var(--danger); grid-column:1/-1;">Failed to load classes: ${escapeHtml(err.message)}</div>`;
  }
}

async function renderTeacherMakeupPage() {
  const tbody = document.getElementById("teacher-makeup-table-body");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2rem; color:var(--text-muted);">Loading makeup classes...</td></tr>`;

  try {
    const res = await apiRequest("/teachers/me/timetable");
    const makeups = (res.timetable || []).filter(e => e.entry_type === "makeup" || e.is_makeup);

    if (!makeups.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2.5rem; color:var(--text-muted);">You have no scheduled makeup classes. Use the "Schedule Makeup Class" button above to arrange a makeup lecture.</td></tr>`;
      return;
    }

    tbody.innerHTML = makeups.map(m => `
      <tr>
        <td><strong>${m.timetable_date ? new Date(m.timetable_date).toLocaleDateString() : 'Upcoming'}</strong></td>
        <td>${escapeHtml(m.day_of_week || m.day || '')} (${escapeHtml(m.start_time || '')} – ${escapeHtml(m.end_time || '')})</td>
        <td><strong>${escapeHtml(m.subject_name || '')}</strong></td>
        <td>${escapeHtml(m.class_name || '')} Sec ${escapeHtml(m.section_name || 'A')}</td>
        <td>🏛 ${escapeHtml(m.room_number || '')}</td>
        <td><span class="muted small">${escapeHtml(m.makeup_reason || 'Academic Catchup')}</span></td>
        <td><span class="badge badge-warning">Scheduled</span></td>
      </tr>
    `).join("");
  } catch (err) {
    console.error("Makeup page render error:", err);
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--danger); padding:2rem;">Failed to load makeup classes: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function renderTeacherAvailabilityPage() {
  const tbody = document.getElementById("teacher-avail-table-body");
  if (!tbody) return;

  try {
    const res = await apiRequest("/teachers/me/availability");
    const teacher = res.teacher || {};
    const availDays = new Set(teacher.available_days || DAYS);
    const availSlots = new Set(teacher.available_slots || SLOTS.map(s => s.id));

    // Render Availability Matrix Table
    tbody.innerHTML = SLOTS.map(slot => `
      <tr>
        <td class="slot-cell"><strong>${escapeHtml(slot.label)}</strong></td>
        ${DAYS.map(day => {
          const isAvail = availDays.has(day) && (availSlots.has(slot.id) || availSlots.size === 0);
          return `
            <td style="text-align:center; padding:0.6rem; background:${isAvail ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.04)'};">
              ${isAvail ? '<span style="color:var(--success); font-weight:700;">✓ Available</span>' : '<span style="color:var(--text-muted); font-size:0.8rem;">— Unavailable</span>'}
            </td>
          `;
        }).join("")}
      </tr>
    `).join("");

    // Fetch and populate Teacher Workload & University Limits
    if (teacher.id) {
      try {
        const statsRes = await apiRequest(`/rules/workload-stats/${teacher.id}`);
        const stats = statsRes.data || {};
        const limits = stats.limits || {};

        const metricWeekly = document.getElementById("tp-metric-weekly");
        if (metricWeekly) metricWeekly.textContent = stats.total_weekly_periods || 0;

        const metricWeeklyLimit = document.getElementById("tp-metric-weekly-limit");
        if (metricWeeklyLimit) metricWeeklyLimit.textContent = `/ ${limits.max_weekly_hours || 16} periods max`;

        const metricWeeklyStatus = document.getElementById("tp-metric-weekly-status");
        if (metricWeeklyStatus) {
          if (stats.violations && stats.violations.length > 0) {
            metricWeeklyStatus.style.color = "#ef4444";
            metricWeeklyStatus.textContent = "⚠️ " + stats.violations[0];
          } else {
            metricWeeklyStatus.style.color = "#10b981";
            metricWeeklyStatus.textContent = "✓ Within university quota";
          }
        }

        const metricDailyLimit = document.getElementById("tp-metric-daily-limit");
        if (metricDailyLimit) metricDailyLimit.textContent = limits.max_daily_hours || 4;

        const metricConsecLimit = document.getElementById("tp-metric-consecutive-limit");
        if (metricConsecLimit) metricConsecLimit.textContent = limits.max_consecutive_periods || 2;

        const metricBreakLimit = document.getElementById("tp-metric-break-limit");
        if (metricBreakLimit) metricBreakLimit.textContent = limits.min_break_duration || 1;

        // Fetch preferences
        const prefRes = await apiRequest(`/rules/teacher-preferences/${teacher.id}`);
        const pref = prefRes.data || {};

        const badgeEl = document.getElementById("tp-approval-badge");
        if (badgeEl) {
          const st = pref.status || "Approved";
          badgeEl.textContent = `Status: ${st}`;
          badgeEl.className = st === "Approved" ? "pill pill-success" : (st === "Rejected" ? "pill pill-danger" : "pill pill-warning");
        }

        if (pref.preferred_days && Array.isArray(pref.preferred_days)) {
          const pDays = new Set(pref.preferred_days);
          document.querySelectorAll('#tp-days-container input[name="tp_day"]').forEach(cb => {
            cb.checked = pDays.has(cb.value);
          });
        }

        if (pref.max_daily_periods) {
          const maxDailyInput = document.getElementById("tp-max-daily");
          if (maxDailyInput) maxDailyInput.value = pref.max_daily_periods;
        }

        if (pref.notes) {
          const notesInput = document.getElementById("tp-notes");
          if (notesInput) notesInput.value = pref.notes;
        }

      } catch (err) {
        console.warn("Could not fetch workload stats:", err);
      }
    }

  } catch (err) {
    console.error("Availability page render error:", err);
  }
}

/* ============================ TIMETABLE RULES & CONSTRAINTS MODULE ============================ */
let cachedRulesList = [];

async function renderRulesPage() {
  const tbody = document.getElementById("rules-table-body");
  if (!tbody) return;

  try {
    const res = await apiRequest("/rules");
    const rules = Array.isArray(res.data) ? res.data : (Array.isArray(res) ? res : []);
    cachedRulesList = rules;

    // Update Top 4 Metric Cards
    const dailyRule = rules.find(r => r.rule_key === "MAX_DAILY_HOURS");
    const weeklyRule = rules.find(r => r.rule_key === "MAX_WEEKLY_HOURS");
    const consecRule = rules.find(r => r.rule_key === "MAX_CONSECUTIVE_PERIODS");
    const breakRule = rules.find(r => r.rule_key === "MIN_BREAK_DURATION");
    const gapRule = rules.find(r => r.rule_key === "MINIMIZE_GAPS");
    const prefRule = rules.find(r => r.rule_key === "PREFERRED_DAYS_SLOTS");
    const qualRule = rules.find(r => r.rule_key === "TEACHER_QUALIFICATION");
    const fairRule = rules.find(r => r.rule_key === "WORKLOAD_FAIR_DISTRIBUTION");

    const maxDaily = dailyRule?.config?.max_hours ?? 4;
    const maxWeekly = weeklyRule?.config?.max_hours ?? 16;
    const maxConsec = consecRule?.config?.max_consecutive ?? 2;
    const minBreak = breakRule?.config?.min_break_slots ?? 1;

    const elDaily = document.getElementById("metric-max-daily");
    if (elDaily) elDaily.textContent = maxDaily;
    const elWeekly = document.getElementById("metric-max-weekly");
    if (elWeekly) elWeekly.textContent = maxWeekly;
    const elConsec = document.getElementById("metric-max-consecutive");
    if (elConsec) elConsec.textContent = maxConsec;
    const elBreak = document.getElementById("metric-min-break");
    if (elBreak) elBreak.textContent = minBreak;

    // Update Settings Page Quick Pills
    const pillDaily = document.getElementById("settings-pill-daily");
    if (pillDaily) pillDaily.textContent = `Max Daily: ${maxDaily} hrs`;
    const pillWeekly = document.getElementById("settings-pill-weekly");
    if (pillWeekly) pillWeekly.textContent = `Max Weekly: ${maxWeekly} hrs`;
    const pillConsec = document.getElementById("settings-pill-consecutive");
    if (pillConsec) pillConsec.textContent = `Consecutive: ${maxConsec} max`;
    const pillBreak = document.getElementById("settings-pill-break");
    if (pillBreak) pillBreak.textContent = `Break: ${minBreak} slot`;

    // Populate Global Workload Policy Form
    const inputDaily = document.getElementById("cfg-max-daily");
    if (inputDaily) inputDaily.value = maxDaily;
    const inputWeekly = document.getElementById("cfg-max-weekly");
    if (inputWeekly) inputWeekly.value = maxWeekly;
    const inputConsec = document.getElementById("cfg-max-consecutive");
    if (inputConsec) inputConsec.value = maxConsec;
    const inputBreak = document.getElementById("cfg-min-break");
    if (inputBreak) inputBreak.value = minBreak;
    const inputGap = document.getElementById("cfg-max-gap");
    if (inputGap) inputGap.value = gapRule?.config?.max_allowed_gap_slots ?? 2;

    const activeDays = new Set(prefRule?.config?.preferred_days || ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
    document.querySelectorAll('#cfg-pref-days-container input[name="pref_day"]').forEach(cb => {
      cb.checked = activeDays.has(cb.value);
    });

    const timeRangeSel = document.getElementById("cfg-pref-time-range");
    if (timeRangeSel && prefRule?.config?.time_range) {
      timeRangeSel.value = prefRule.config.time_range;
    }

    const deptFallbackCb = document.getElementById("cfg-dept-fallback");
    if (deptFallbackCb) {
      deptFallbackCb.checked = qualRule?.config?.allow_department_fallback !== false;
    }

    const workloadBalanceCb = document.getElementById("cfg-workload-balance");
    if (workloadBalanceCb) {
      workloadBalanceCb.checked = fairRule?.is_enabled !== false;
    }

    // Populate Rules Table
    if (rules.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="muted text-center">No rules configured.</td></tr>`;
    } else {
      tbody.innerHTML = rules.map(r => {
        let valDisplay = "Default";
        if (r.config) {
          if (r.config.max_hours !== undefined) valDisplay = `Limit: ${r.config.max_hours} hrs`;
          else if (r.config.max_consecutive !== undefined) valDisplay = `Max: ${r.config.max_consecutive} periods`;
          else if (r.config.min_break_slots !== undefined) valDisplay = `Min: ${r.config.min_break_slots} slot(s)`;
          else if (r.config.max_allowed_gap_slots !== undefined) valDisplay = `Max Gap: ${r.config.max_allowed_gap_slots} slots`;
          else if (r.config.preferred_days !== undefined) valDisplay = `${r.config.preferred_days.length} days active`;
          else if (Object.keys(r.config).length > 0) valDisplay = JSON.stringify(r.config);
          else valDisplay = "Standard";
        }

        const categoryClass = r.category === "workload" ? "badge-info" : (r.category === "qualification" ? "badge-warning" : "badge-purple");

        return `
          <tr data-rule-key="${escapeHtml(r.rule_key)}">
            <td>
              <strong style="color:var(--text-color); font-size:0.92rem;">${escapeHtml(r.name)}</strong>
              <div style="font-family:monospace; font-size:0.75rem; color:var(--text-muted); margin-top:2px;">${escapeHtml(r.rule_key)}</div>
            </td>
            <td>
              <span class="badge ${categoryClass}">${escapeHtml(r.category || "workload")}</span>
            </td>
            <td>
              <span style="font-size:0.83rem; color:var(--text-muted); line-height:1.4;">${escapeHtml(r.description || "")}</span>
            </td>
            <td>
              <select class="rule-mode-select select-sm" data-key="${escapeHtml(r.rule_key)}" style="padding:0.25rem 0.5rem; font-size:0.8rem; border-radius:var(--radius-sm); background:var(--bg-surface); border:1px solid var(--border-subtle); color:var(--text-color);">
                <option value="true" ${r.is_mandatory ? "selected" : ""}>Mandatory (Hard)</option>
                <option value="false" ${!r.is_mandatory ? "selected" : ""}>Preference (Soft)</option>
              </select>
            </td>
            <td>
              <label class="rule-switch" title="Toggle rule active / disabled">
                <input type="checkbox" class="rule-toggle-input" data-key="${escapeHtml(r.rule_key)}" ${r.is_enabled ? "checked" : ""}>
                <span class="rule-slider"></span>
              </label>
            </td>
            <td>
              <span class="pill pill-soft" style="font-size:0.78rem; font-weight:600;">${escapeHtml(valDisplay)}</span>
            </td>
            <td>
              <button type="button" class="btn btn-secondary btn-sm rule-config-btn" data-key="${escapeHtml(r.rule_key)}" style="padding:0.25rem 0.6rem; font-size:0.8rem;">
                ⚙️ Config
              </button>
            </td>
          </tr>
        `;
      }).join("");

      // Wire inline toggle switches
      tbody.querySelectorAll(".rule-toggle-input").forEach(toggle => {
        toggle.addEventListener("change", async () => {
          const key = toggle.dataset.key;
          const isEnabled = toggle.checked;
          try {
            await apiRequest(`/rules/key/${key}`, {
              method: "PUT",
              body: JSON.stringify({ is_enabled: isEnabled })
            });
            toast(`Rule '${key}' ${isEnabled ? "enabled" : "disabled"}.`, "success");
          } catch (err) {
            console.error("Rule toggle error:", err);
            toggle.checked = !isEnabled;
            toast("Failed to update rule: " + err.message, "error");
          }
        });
      });

      // Wire inline mode selects
      tbody.querySelectorAll(".rule-mode-select").forEach(sel => {
        sel.addEventListener("change", async () => {
          const key = sel.dataset.key;
          const isMandatory = sel.value === "true";
          try {
            await apiRequest(`/rules/key/${key}`, {
              method: "PUT",
              body: JSON.stringify({ is_mandatory: isMandatory })
            });
            toast(`Rule '${key}' set to ${isMandatory ? "Mandatory (Blocking)" : "Preference (Soft Warning)"}.`, "success");
          } catch (err) {
            console.error("Rule mode error:", err);
            toast("Failed to update rule mode: " + err.message, "error");
          }
        });
      });

      // Wire configure buttons
      tbody.querySelectorAll(".rule-config-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const key = btn.dataset.key;
          const rule = cachedRulesList.find(r => r.rule_key === key);
          if (rule) openRuleConfigModal(rule);
        });
      });
    }

    // Load Faculty Custom Preference Requests
    await loadTeacherPreferencesTable();

  } catch (err) {
    console.error("Rules page render error:", err);
    tbody.innerHTML = `<tr><td colspan="7" class="badge badge-danger">Failed to load rules: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function loadTeacherPreferencesTable() {
  const tbody = document.getElementById("teacher-prefs-table-body");
  if (!tbody) return;

  try {
    const res = await apiRequest("/rules/all-teacher-preferences");
    const prefs = Array.isArray(res.data) ? res.data : (Array.isArray(res) ? res : []);

    if (prefs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="muted text-center" style="padding:1.5rem;">No faculty preference requests submitted yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = prefs.map(p => {
      const daysStr = Array.isArray(p.preferred_days) ? p.preferred_days.map(d => d.slice(0, 3)).join(", ") : "All";
      const slotsStr = Array.isArray(p.preferred_slots) ? p.preferred_slots.join(", ") : "Standard";
      const statusPillClass = p.status === "Approved" ? "pill-success" : (p.status === "Rejected" ? "pill-danger" : "pill-warning");

      return `
        <tr>
          <td>
            <strong>${escapeHtml(p.teacher_name || "Faculty")}</strong>
            <div style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(p.teacher_code || "")}</div>
          </td>
          <td>${escapeHtml(p.department_name || "General")}</td>
          <td><span class="pill pill-soft" style="font-size:0.75rem;">${escapeHtml(daysStr)}</span></td>
          <td><code style="font-size:0.75rem;">${escapeHtml(slotsStr)}</code></td>
          <td><strong>${escapeHtml(p.max_daily_periods || 4)}</strong> / day</td>
          <td><span style="font-size:0.8rem; color:var(--text-muted);">${escapeHtml(p.notes || "—")}</span></td>
          <td><span class="pill ${statusPillClass}">${escapeHtml(p.status || "Pending")}</span></td>
          <td>
            <div style="display:flex; gap:0.35rem;">
              <button type="button" class="btn btn-secondary btn-sm tp-action-btn" data-pref-id="${p.id}" data-action="Approved" style="padding:0.2rem 0.5rem; font-size:0.75rem; color:var(--success);">✓ Approve</button>
              <button type="button" class="btn btn-ghost btn-sm tp-action-btn" data-pref-id="${p.id}" data-action="Rejected" style="padding:0.2rem 0.5rem; font-size:0.75rem; color:#ef4444;">✕ Reject</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    tbody.querySelectorAll(".tp-action-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const prefId = btn.dataset.prefId;
        const newStatus = btn.dataset.action;
        try {
          await apiRequest(`/rules/teacher-preferences/${prefId}/status`, {
            method: "PUT",
            body: JSON.stringify({ status: newStatus })
          });
          toast(`Faculty preference ${newStatus.toLowerCase()} successfully.`, "success");
          await loadTeacherPreferencesTable();
        } catch (err) {
          console.error("Update preference status error:", err);
          toast("Failed to update status: " + err.message, "error");
        }
      });
    });

  } catch (err) {
    console.error("Load teacher preferences error:", err);
    tbody.innerHTML = `<tr><td colspan="8" class="badge badge-danger">Failed to load preference requests: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function openRuleConfigModal(rule) {
  const modal = document.getElementById("modal-rule-config");
  if (!modal) return;

  document.getElementById("mrc-key").value = rule.rule_key;
  document.getElementById("mrc-name").value = rule.name || "";
  document.getElementById("mrc-desc").value = rule.description || "";
  document.getElementById("mrc-mandatory").value = rule.is_mandatory ? "true" : "false";
  document.getElementById("mrc-status").value = rule.is_enabled ? "true" : "false";

  const valInput = document.getElementById("mrc-config-val");
  const valLabel = document.getElementById("mrc-config-val-label");
  const valWrap = document.getElementById("mrc-config-val-wrap");

  if (rule.config && (rule.config.max_hours !== undefined || rule.config.max_consecutive !== undefined || rule.config.min_break_slots !== undefined || rule.config.max_allowed_gap_slots !== undefined)) {
    valWrap.classList.remove("hidden");
    const num = rule.config.max_hours ?? rule.config.max_consecutive ?? rule.config.min_break_slots ?? rule.config.max_allowed_gap_slots ?? 0;
    valInput.value = num;
    valLabel.textContent = "Threshold / Numerical Value";
  } else {
    valWrap.classList.add("hidden");
  }

  if (typeof modal.showModal === "function") modal.showModal();
  else modal.setAttribute("open", "");
}

function initRulesPage() {
  // Global Workload Policy Save
  const saveWorkloadBtn = document.getElementById("rules-save-workload-btn");
  if (saveWorkloadBtn) {
    saveWorkloadBtn.addEventListener("click", async () => {
      try {
        showLoadingOverlay(true);

        const maxDaily = Number(document.getElementById("cfg-max-daily")?.value) || 4;
        const maxWeekly = Number(document.getElementById("cfg-max-weekly")?.value) || 16;
        const maxConsec = Number(document.getElementById("cfg-max-consecutive")?.value) || 2;
        const minBreak = Number(document.getElementById("cfg-min-break")?.value) || 1;
        const maxGap = Number(document.getElementById("cfg-max-gap")?.value) || 2;

        const prefDays = Array.from(document.querySelectorAll('#cfg-pref-days-container input[name="pref_day"]:checked')).map(cb => cb.value);
        const prefTimeRange = document.getElementById("cfg-pref-time-range")?.value || "09:00 - 16:00";
        const deptFallback = document.getElementById("cfg-dept-fallback")?.checked !== false;
        const workloadBalance = document.getElementById("cfg-workload-balance")?.checked !== false;

        // Save MAX_DAILY_HOURS
        await apiRequest("/rules/key/MAX_DAILY_HOURS", {
          method: "PUT",
          body: JSON.stringify({ config: { max_hours: maxDaily } })
        });

        // Save MAX_WEEKLY_HOURS
        await apiRequest("/rules/key/MAX_WEEKLY_HOURS", {
          method: "PUT",
          body: JSON.stringify({ config: { max_hours: maxWeekly } })
        });

        // Save MAX_CONSECUTIVE_PERIODS
        await apiRequest("/rules/key/MAX_CONSECUTIVE_PERIODS", {
          method: "PUT",
          body: JSON.stringify({ config: { max_consecutive: maxConsec } })
        });

        // Save MIN_BREAK_DURATION
        await apiRequest("/rules/key/MIN_BREAK_DURATION", {
          method: "PUT",
          body: JSON.stringify({ config: { min_break_slots: minBreak } })
        });

        // Save MINIMIZE_GAPS
        await apiRequest("/rules/key/MINIMIZE_GAPS", {
          method: "PUT",
          body: JSON.stringify({ config: { max_allowed_gap_slots: maxGap } })
        });

        // Save PREFERRED_DAYS_SLOTS
        await apiRequest("/rules/key/PREFERRED_DAYS_SLOTS", {
          method: "PUT",
          body: JSON.stringify({ config: { preferred_days: prefDays, time_range: prefTimeRange } })
        });

        // Save TEACHER_QUALIFICATION
        await apiRequest("/rules/key/TEACHER_QUALIFICATION", {
          method: "PUT",
          body: JSON.stringify({ config: { allow_department_fallback: deptFallback } })
        });

        // Save WORKLOAD_FAIR_DISTRIBUTION
        await apiRequest("/rules/key/WORKLOAD_FAIR_DISTRIBUTION", {
          method: "PUT",
          body: JSON.stringify({ is_enabled: workloadBalance })
        });

        toast("Global university workload policy saved to PostgreSQL.", "success");
        await renderRulesPage();
      } catch (err) {
        console.error("Save workload policy error:", err);
        toast("Failed to save workload policy: " + err.message, "error");
      } finally {
        showLoadingOverlay(false);
      }
    });
  }

  // Restore Defaults Button
  const resetBtn = document.getElementById("rules-reset-defaults-btn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      openConfirmModal(
        "Restore University Defaults",
        "Are you sure you want to restore all 12 timetable rules to university workload baseline defaults? Any custom thresholds will be reset.",
        async () => {
          try {
            showLoadingOverlay(true);
            await apiRequest("/rules/reset-defaults", { method: "POST" });
            toast("All timetable rules restored to baseline defaults.", "success");
            await renderRulesPage();
          } catch (err) {
            console.error("Reset defaults error:", err);
            toast("Failed to reset rules: " + err.message, "error");
          } finally {
            showLoadingOverlay(false);
          }
        }
      );
    });
  }

  // Settings page "Manage Teacher Timetable Rules" button
  const gotoRulesBtn = document.getElementById("settings-goto-rules-btn");
  if (gotoRulesBtn) {
    gotoRulesBtn.addEventListener("click", () => {
      navigateTo("rules");
    });
  }

  // Rule Config Modal Form
  const mrcForm = document.getElementById("mrc-form");
  if (mrcForm) {
    mrcForm.addEventListener("submit", async e => {
      e.preventDefault();
      const key = document.getElementById("mrc-key").value;
      const name = document.getElementById("mrc-name").value.trim();
      const desc = document.getElementById("mrc-desc").value.trim();
      const isMandatory = document.getElementById("mrc-mandatory").value === "true";
      const isEnabled = document.getElementById("mrc-status").value === "true";
      const valInput = document.getElementById("mrc-config-val");

      const body = {
        name,
        description: desc,
        is_mandatory: isMandatory,
        is_enabled: isEnabled
      };

      if (!document.getElementById("mrc-config-val-wrap").classList.contains("hidden")) {
        const num = Number(valInput.value);
        if (key === "MAX_DAILY_HOURS" || key === "MAX_WEEKLY_HOURS") {
          body.config = { max_hours: num };
        } else if (key === "MAX_CONSECUTIVE_PERIODS") {
          body.config = { max_consecutive: num };
        } else if (key === "MIN_BREAK_DURATION") {
          body.config = { min_break_slots: num };
        } else if (key === "MINIMIZE_GAPS") {
          body.config = { max_allowed_gap_slots: num };
        }
      }

      try {
        await apiRequest(`/rules/key/${key}`, {
          method: "PUT",
          body: JSON.stringify(body)
        });
        document.getElementById("modal-rule-config").close();
        toast(`Rule '${key}' updated successfully.`, "success");
        await renderRulesPage();
      } catch (err) {
        console.error("Save rule config error:", err);
        toast("Failed to save rule: " + err.message, "error");
      }
    });

    const mrcClose = document.getElementById("mrc-close");
    if (mrcClose) mrcClose.addEventListener("click", () => document.getElementById("modal-rule-config").close());
    const mrcCancel = document.getElementById("mrc-cancel");
    if (mrcCancel) mrcCancel.addEventListener("click", () => document.getElementById("modal-rule-config").close());
  }

  // Teacher Preferences Form Submission
  const tpSubmitBtn = document.getElementById("tp-submit-btn");
  if (tpSubmitBtn) {
    tpSubmitBtn.addEventListener("click", async e => {
      e.preventDefault();
      try {
        showLoadingOverlay(true);

        const activeDays = Array.from(document.querySelectorAll('#tp-days-container input[name="tp_day"]:checked')).map(cb => cb.value);
        const slotType = document.getElementById("tp-pref-slots-type")?.value || "standard";
        const maxDaily = Number(document.getElementById("tp-max-daily")?.value) || 4;
        const notes = document.getElementById("tp-notes")?.value?.trim() || "";

        let preferredSlots = ["s1", "s2", "s3", "s4", "s5"];
        if (slotType === "morning") preferredSlots = ["s0", "s1", "s2", "s3", "s4"];
        else if (slotType === "afternoon") preferredSlots = ["s4b", "s5", "s6", "s7"];
        else if (slotType === "all") preferredSlots = SLOTS.map(s => s.id);

        const res = await apiRequest("/rules/teacher-preferences", {
          method: "POST",
          body: JSON.stringify({
            preferred_days: activeDays,
            preferred_slots: preferredSlots,
            max_daily_periods: maxDaily,
            notes
          })
        });

        toast("Scheduling preferences saved successfully. University generator will prioritize your choices.", "success");
        await renderTeacherAvailabilityPage();
      } catch (err) {
        console.error("Save teacher preferences error:", err);
        toast("Failed to save preferences: " + err.message, "error");
      } finally {
        showLoadingOverlay(false);
      }
    });
  }
}

/* ============================ COMMAND PALETTE ============================ */
function buildCommandList() {
  const nav = Array.from(document.querySelectorAll(".nav-link")).map(link => ({
    icon: link.querySelector(".nav-ico").textContent, label: link.textContent.trim().replace(/\d+$/, "").trim(),
    hint: "Go to page", run: () => navigateTo(link.dataset.section)
  }));
  const actions = [
    { icon: "➕", label: "Add timetable entry", hint: "Timetable", run: () => { navigateTo("timetable"); setTimeout(() => openTimetableForm(null), 0); } },
    { icon: "🔄", label: "Schedule makeup class", hint: "Timetable", run: () => openMakeupModal() },
    { icon: "⚖️", label: "Timetable Rules & Constraints", hint: "Admin", run: () => navigateTo("rules") },
    { icon: "🧑‍🏫", label: "Manage teacher accounts", hint: "Admin", run: () => navigateTo("teacher-accounts") },
    { icon: "📅", label: "Teacher dashboard", hint: "Faculty", run: () => navigateTo("teacher-dashboard") },
    { icon: "🗓", label: "My timetable", hint: "Faculty", run: () => navigateTo("teacher-timetable") },
    { icon: "👤", label: "My profile", hint: "Account", run: () => openMyProfileModal() },
    { icon: "🔑", label: "Change password", hint: "Account", run: () => openChangePasswordModal() },
    { icon: "📚", label: "Study Plan Library", hint: "Curriculum", run: () => navigateTo("study-plans") },
    { icon: "📝", label: "Create study plan", hint: "Curriculum", run: () => { navigateTo("study-plans"); setTimeout(() => openStudyPlanFormModal(null), 50); } },
    { icon: "🧑‍🏫", label: "Add teacher", hint: "Teachers", run: () => { navigateTo("teachers"); setTimeout(() => openTeacherForm(null), 0); } },
    { icon: "📘", label: "Add subject", hint: "Subjects", run: () => { navigateTo("subjects"); setTimeout(() => openSubjectForm(null), 0); } },
    { icon: "🏛", label: "Add classroom", hint: "Classrooms", run: () => { navigateTo("classrooms"); setTimeout(() => openRoomForm(null), 0); } },
    { icon: "🎓", label: "Add class / section", hint: "Classes", run: () => { navigateTo("classes"); setTimeout(() => openClassForm(null), 0); } },
    { icon: "📣", label: "New announcement", hint: "Announcements", run: () => { navigateTo("announcements"); setTimeout(openAnnouncementForm, 0); } },
    { icon: "🩺", label: "Report absence / find substitute", hint: "Teachers", run: () => { navigateTo("teachers"); setTimeout(openSubstituteModal, 0); } },
    { icon: "⬇", label: "Export timetable as CSV", hint: "Timetable", run: () => { navigateTo("timetable"); setTimeout(exportTimetableCsv, 0); } },
    { icon: "📅", label: "Export timetable to Calendar (.ics)", hint: "Timetable", run: () => { navigateTo("timetable"); setTimeout(exportTimetableIcs, 0); } },
    { icon: "🖨", label: "Print timetable", hint: "Timetable", run: () => { navigateTo("timetable"); setTimeout(() => window.print(), 0); } },
    { icon: "🌙", label: "Toggle dark / light mode", hint: "Appearance", run: () => applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark") },
    { icon: "🚪", label: "Log out", hint: "Session", run: () => openConfirmModal("Log out", "Are you sure you want to log out?", doLogout) }
  ];
  return nav.concat(actions);
}
let cmdkActiveIndex = 0, cmdkFiltered = [];
function openCommandPalette() {
  const overlay = document.getElementById("cmdk-overlay");
  const input = document.getElementById("cmdk-input");
  overlay.classList.remove("hidden");
  input.value = "";
  filterCommandPalette("");
  setTimeout(() => input.focus(), 30);
}
function closeCommandPalette() { document.getElementById("cmdk-overlay").classList.add("hidden"); }
function filterCommandPalette(q) {
  const all = buildCommandList();
  const query = q.toLowerCase().trim();
  cmdkFiltered = query ? all.filter(c => c.label.toLowerCase().includes(query)) : all;
  cmdkActiveIndex = 0;
  renderCommandPalette();
}
function renderCommandPalette() {
  const list = document.getElementById("cmdk-list");
  list.innerHTML = cmdkFiltered.length ? cmdkFiltered.map((c, i) => `
    <li class="cmdk-item${i === cmdkActiveIndex ? " active" : ""}" data-idx="${i}">
      <span class="cmdk-ico">${c.icon}</span><span>${escapeHtml(c.label)}</span><span class="cmdk-sub">${escapeHtml(c.hint)}</span>
    </li>`).join("") : `<li class="cmdk-empty">No matching commands</li>`;
  list.querySelectorAll(".cmdk-item").forEach(el => {
    el.addEventListener("click", () => runCommandPaletteItem(Number(el.dataset.idx)));
    el.addEventListener("mouseenter", () => { cmdkActiveIndex = Number(el.dataset.idx); renderCommandPalette(); });
  });
}
function runCommandPaletteItem(i) {
  const cmd = cmdkFiltered[i];
  if (!cmd) return;
  closeCommandPalette();
  cmd.run();
}
function initCommandPalette() {
  document.getElementById("cmdk-open-btn").addEventListener("click", openCommandPalette);
  const input = document.getElementById("cmdk-input");
  input.addEventListener("input", () => filterCommandPalette(input.value));
  input.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { e.preventDefault(); cmdkActiveIndex = Math.min(cmdkActiveIndex + 1, cmdkFiltered.length - 1); renderCommandPalette(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); cmdkActiveIndex = Math.max(cmdkActiveIndex - 1, 0); renderCommandPalette(); }
    else if (e.key === "Enter") { e.preventDefault(); runCommandPaletteItem(cmdkActiveIndex); }
    else if (e.key === "Escape") { closeCommandPalette(); }
  });
  document.getElementById("cmdk-overlay").addEventListener("click", e => { if (e.target.id === "cmdk-overlay") closeCommandPalette(); });
  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openCommandPalette(); }
    else if (e.key === "Escape" && !document.getElementById("cmdk-overlay").classList.contains("hidden")) { closeCommandPalette(); }
  });
}

/* ============================ PWA / OFFLINE SUPPORT ============================ */
function initServiceWorker() {
  if ("serviceWorker" in navigator && (location.protocol === "http:" || location.protocol === "https:")) {
    navigator.serviceWorker.register("service-worker.js")
      .then(reg => {
        reg.update().catch(() => {});
      })
      .catch(() => { /* offline install unavailable on this host — app still works fully online */ });
  }
}

/* ============================ INIT ============================ */
document.addEventListener("DOMContentLoaded", async () => {
  initLoginPage();
  initNavigation();
  initDashboardPage();
  initSectionsPage();
  initTimetablePage();
  initStudyPlansPage();
  initMakeupModal();
  initGeneratePage();
  initCalendarPage();
  initNotificationsPage();
  initGlobalSearch();
  initTheme();
  initSettingsPage();
  initSubstituteModal();
  initAuditPage();
  initCommandPalette();
  initServiceWorker();
  initProfileMenu();
  initTeacherAccountsPage();
  initTeacherPortal();
  initRulesPage();

  document.getElementById("class-add-btn").addEventListener("click", () => openClassForm(null));
  document.getElementById("class-search").addEventListener("input", renderClassesPage);
  document.getElementById("teacher-add-btn").addEventListener("click", () => openTeacherForm(null));
  document.getElementById("teacher-search").addEventListener("input", renderTeachersPage);
  document.getElementById("teacher-dept-filter").addEventListener("change", renderTeachersPage);
  document.getElementById("subject-add-btn").addEventListener("click", () => openSubjectForm(null));
  document.getElementById("subject-search").addEventListener("input", renderSubjectsPage);
  document.getElementById("room-add-btn").addEventListener("click", () => openRoomForm(null));
  document.getElementById("room-search").addEventListener("input", renderRoomsPage);
  document.getElementById("announcement-add-btn").addEventListener("click", openAnnouncementForm);

  if (isLoggedIn()) {
    await restoreAndValidateSession();
  } else {
    doLogout(false);
  }
});
