/* ===================================================================
   Smart Classroom & Timetable Scheduler
   Vanilla JS application logic. Organised into clearly named modules:
   Storage -> Auth -> Toast/Modal -> Router -> per-page renderers ->
   Conflict engine -> Generator -> Calendar -> Analytics -> Init
   =================================================================== */

/* ============================ CONSTANTS ============================ */
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SLOTS = [
  { id: "s1", label: "9:00 - 10:00" },
  { id: "s2", label: "10:00 - 11:00" },
  { id: "s3", label: "11:00 - 12:00" },
  { id: "s4", label: "12:00 - 1:00" },
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
  s1: [9, 10], s2: [10, 11], s3: [11, 12], s4: [12, 13],
  s5: [14, 15], s6: [15, 16], s7: [16, 17]
};

const DEMO_USERS = [
  { email: "admin@brightfield.edu", password: "admin123", name: "Alex Morgan", role: "Administrator" },
  { email: "teacher@brightfield.edu", password: "teacher123", name: "Priya Nair", role: "Teacher" }
];


/* ============================ BACKEND API MODULE ============================ */
const API_BASE_URL = "http://localhost:5000/api";
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
  } else {
    sessionStorage.setItem(API_KEYS.token, token);
    sessionStorage.removeItem(API_KEYS.user);
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
    throw new Error(message);
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
  const raw = String(x);
  if (/^s[1-7]$/.test(raw)) return raw;
  const map = {
    "09:00": "s1", "9:00": "s1",
    "10:00": "s2",
    "11:00": "s3",
    "12:00": "s4",
    "14:00": "s5", "2:00": "s5",
    "15:00": "s6", "3:00": "s6",
    "16:00": "s7", "4:00": "s7"
  };
  return map[raw] || raw;
}

function normalizeTimetable(x) {
  return {
    id: String(x.id ?? x.timetable_id ?? x.timetableId),
    classId: String(x.class_id ?? x.classId),
    subjectId: String(x.subject_id ?? x.subjectId),
    teacherId: String(x.teacher_id ?? x.teacherId),
    roomId: String(x.room_id ?? x.roomId),
    timeSlotId: x.time_slot_id ?? x.timeSlotId ?? null,
    slotId: normalizeSlotId(x.slot_id ?? x.slotId ?? x.time_slot ?? x.timeSlot),
    day: x.day_of_week ?? x.day ?? x.dayOfWeek ?? "",
    timetableDate: x.timetable_date ?? x.timetableDate ?? null,
    overridden: Boolean(x.overridden ?? false),
    status: x.status ?? "active",
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

/* ============================ LOOKUP HELPERS ============================ */
function teacherName(id) { const t = getTeachers().find(x => x.id === id); return t ? t.name : "Unassigned"; }
function subjectName(id) { const s = getSubjects().find(x => x.id === id); return s ? s.name : "Unknown subject"; }
function roomName(id) { const r = getRooms().find(x => x.id === id); return r ? r.number : "Unknown room"; }
function className(id) { const c = getClasses().find(x => x.id === id); return c ? (c.name + " - " + c.section) : "Unknown class"; }
function slotLabel(id) { const s = SLOTS.find(x => x.id === id); return s ? s.label : id; }
function escapeHtml(str) {
  return String(str == null ? "" : str).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

/* ============================ DEMO DATA SEEDING ============================ */
function seedDemoData(force) {
  if (!force && Store.get(LS_KEYS.seeded, false)) return;

  const teachers = [
    { id: "t1", teacherId: "FAC-101", name: "Dr. Ravi Kumar", department: "Computer Science", subjectIds: [], availableDays: DAYS.slice(0, 6), availableSlots: SLOTS.map(s => s.id) },
    { id: "t2", teacherId: "FAC-102", name: "Priya Nair", department: "Computer Science", subjectIds: [], availableDays: DAYS.slice(0, 6), availableSlots: SLOTS.map(s => s.id) },
    { id: "t3", teacherId: "FAC-103", name: "Dr. Anjali Mehta", department: "Mathematics", subjectIds: [], availableDays: DAYS.slice(0, 6), availableSlots: SLOTS.map(s => s.id) },
    { id: "t4", teacherId: "FAC-104", name: "Sameer Sharma", department: "Physics", subjectIds: [], availableDays: DAYS.slice(0, 6), availableSlots: SLOTS.map(s => s.id) },
    { id: "t5", teacherId: "FAC-105", name: "Neha Kapoor", department: "Electronics", subjectIds: [], availableDays: DAYS.slice(0, 6), availableSlots: SLOTS.map(s => s.id) },
    { id: "t6", teacherId: "FAC-106", name: "Dr. Vikram Rao", department: "Computer Science", subjectIds: [], availableDays: DAYS.slice(0, 6), availableSlots: SLOTS.map(s => s.id) },
    { id: "t7", teacherId: "FAC-107", name: "Fatima Sheikh", department: "English", subjectIds: [], availableDays: DAYS.slice(0, 6), availableSlots: SLOTS.map(s => s.id) },
    { id: "t8", teacherId: "FAC-108", name: "Arjun Verma", department: "Mechanical", subjectIds: [], availableDays: DAYS.slice(0, 6), availableSlots: SLOTS.map(s => s.id) }
  ];

  const subjects = [
    { id: "sub1", code: "CS201", name: "Data Structures", facultyId: "t1", weeklyPeriods: 4 },
    { id: "sub2", code: "CS202", name: "Database Systems", facultyId: "t2", weeklyPeriods: 3 },
    { id: "sub3", code: "MA101", name: "Engineering Mathematics", facultyId: "t3", weeklyPeriods: 4 },
    { id: "sub4", code: "PH101", name: "Applied Physics", facultyId: "t4", weeklyPeriods: 3 },
    { id: "sub5", code: "EC201", name: "Digital Electronics", facultyId: "t5", weeklyPeriods: 3 },
    { id: "sub6", code: "CS301", name: "Operating Systems", facultyId: "t6", weeklyPeriods: 4 },
    { id: "sub7", code: "HS101", name: "Technical English", facultyId: "t7", weeklyPeriods: 2 },
    { id: "sub8", code: "ME101", name: "Engineering Workshop", facultyId: "t8", weeklyPeriods: 2 }
  ];

  const rooms = [
    { id: "r1", number: "Room 101", building: "Main Block", capacity: 60, type: "Lecture Hall" },
    { id: "r2", number: "Room 102", building: "Main Block", capacity: 60, type: "Lecture Hall" },
    { id: "r3", number: "Lab 201", building: "Tech Block", capacity: 35, type: "Laboratory" },
    { id: "r4", number: "Computer Lab 1", building: "Tech Block", capacity: 40, type: "Computer Lab" },
    { id: "r5", number: "Computer Lab 2", building: "Tech Block", capacity: 40, type: "Computer Lab" },
    { id: "r6", number: "Seminar Hall", building: "Main Block", capacity: 120, type: "Seminar Hall" }
  ];

  const classes = [
    { id: "c1", name: "B.Tech CSE", section: "A", students: 58 },
    { id: "c2", name: "B.Tech CSE", section: "B", students: 55 },
    { id: "c3", name: "B.Tech ECE", section: "A", students: 50 },
    { id: "c4", name: "B.Tech ME", section: "A", students: 48 }
  ];

  // Build a realistic conflict-free demo timetable (>= 20 entries) across classes.
  const timetable = [];
  const plan = [
    // classId, day, slotId, subjectId, teacherId, roomId
    ["c1", "Monday", "s1", "sub1", "t1", "r1"],
    ["c1", "Monday", "s2", "sub3", "t3", "r1"],
    ["c1", "Monday", "s3", "sub2", "t2", "r4"],
    ["c1", "Tuesday", "s1", "sub6", "t6", "r1"],
    ["c1", "Tuesday", "s2", "sub7", "t7", "r1"],
    ["c1", "Wednesday", "s1", "sub1", "t1", "r4"],
    ["c1", "Wednesday", "s4", "sub3", "t3", "r1"],
    ["c1", "Thursday", "s2", "sub2", "t2", "r4"],
    ["c1", "Friday", "s1", "sub6", "t6", "r1"],
    ["c1", "Friday", "s5", "sub1", "t1", "r1"],

    ["c2", "Monday", "s4", "sub1", "t1", "r2"],
    ["c2", "Monday", "s5", "sub2", "t2", "r5"],
    ["c2", "Tuesday", "s3", "sub3", "t3", "r2"],
    ["c2", "Wednesday", "s2", "sub6", "t6", "r2"],
    ["c2", "Thursday", "s1", "sub7", "t7", "r2"],
    ["c2", "Friday", "s3", "sub2", "t2", "r5"],

    ["c3", "Monday", "s1", "sub5", "t5", "r3"],
    ["c3", "Monday", "s3", "sub4", "t4", "r6"],
    ["c3", "Tuesday", "s4", "sub3", "t3", "r6"],
    ["c3", "Wednesday", "s5", "sub5", "t5", "r3"],
    ["c3", "Thursday", "s3", "sub7", "t7", "r6"],
    ["c3", "Friday", "s2", "sub4", "t4", "r6"],

    ["c4", "Tuesday", "s5", "sub8", "t8", "r3"],
    ["c4", "Wednesday", "s3", "sub3", "t3", "r6"],
    ["c4", "Thursday", "s5", "sub4", "t4", "r6"],
    ["c4", "Friday", "s4", "sub8", "t8", "r3"]
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
    { id: uid("an"), title: "Friday's timetable has been changed", desc: "Section CSE-A's Physics class on Friday has moved from Room 101 to the Seminar Hall due to maintenance.", date: new Date().toISOString().slice(0, 10), priority: "High" },
    { id: uid("an"), title: "Mid-semester exam schedule released", desc: "Please check the calendar view for updated slots during exam week. Regular classes resume the following Monday.", date: new Date(Date.now() - 86400000).toISOString().slice(0, 10), priority: "Medium" },
    { id: uid("an"), title: "New Computer Lab 2 now available", desc: "Computer Lab 2 in the Tech Block is now open for scheduling from this week onward.", date: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10), priority: "Low" }
  ];

  const notifications = [
    { id: uid("no"), text: "Timetable updated for B.Tech CSE - Section A", time: new Date().toISOString(), read: false, type: "info" },
    { id: uid("no"), text: "Room 204 is unavailable for maintenance this week", time: new Date(Date.now() - 3600000).toISOString(), read: false, type: "warning" },
    { id: uid("no"), text: "New class scheduled: Engineering Workshop for B.Tech ME - A", time: new Date(Date.now() - 7200000).toISOString(), read: true, type: "success" }
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
function openConfirmModal(title, text, onConfirm) {
  document.getElementById("modal-confirm-title").textContent = title;
  document.getElementById("modal-confirm-text").textContent = text;
  const okBtn = document.getElementById("modal-confirm-ok");
  const clone = okBtn.cloneNode(true);
  okBtn.parentNode.replaceChild(clone, okBtn);
  clone.addEventListener("click", () => { onConfirm(); confirmModal.close(); });
  confirmModal.showModal();
}
document.getElementById("modal-confirm-close").addEventListener("click", () => confirmModal.close());
document.getElementById("modal-confirm-cancel").addEventListener("click", () => confirmModal.close());

const conflictModal = document.getElementById("modal-conflict");
function openConflictModal(conflicts, onOverride) {
  const list = document.getElementById("modal-conflict-list");
  list.innerHTML = conflicts.map(c => `<li>${escapeHtml(c)}</li>`).join("");
  const overrideBtn = document.getElementById("modal-conflict-override");
  const clone = overrideBtn.cloneNode(true);
  overrideBtn.parentNode.replaceChild(clone, overrideBtn);
  clone.addEventListener("click", () => { onOverride(); conflictModal.close(); });
  conflictModal.showModal();
}
document.getElementById("modal-conflict-close").addEventListener("click", () => conflictModal.close());
document.getElementById("modal-conflict-cancel").addEventListener("click", () => conflictModal.close());

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
    name: user.name || user.full_name || user.fullName || user.email || "Admin User",
    role: user.role || "Administrator",
    email: user.email || ""
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

function doLogout() {
  clearApiSession();
  localStorage.removeItem(LS_KEYS.auth);
  sessionStorage.removeItem(LS_KEYS.auth);
  localStorage.removeItem(LS_KEYS.profile);
  sessionStorage.removeItem(LS_KEYS.profile);

  document.getElementById("app-shell").classList.add("hidden");
  document.getElementById("login-page").classList.remove("hidden");
  document.getElementById("login-form").reset();
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

function showApp() {
  document.getElementById("login-page").classList.add("hidden");
  document.getElementById("app-shell").classList.remove("hidden");

  const apiUser = getStoredApiUser();
  const profile = Store.get(LS_KEYS.profile, {
    name: apiUser?.name || apiUser?.email || "Admin User",
    role: apiUser?.role || "Administrator"
  });

  document.getElementById("profile-name").textContent = profile.name;
  document.getElementById("profile-role").textContent = profile.role;
  document.getElementById("profile-avatar").textContent = profile.name.charAt(0).toUpperCase();
  document.getElementById("settings-name").value = profile.name;
  document.getElementById("settings-role").value = profile.role;

  navigateTo("dashboard");
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
    timetable: renderTimetablePage,
    generate: renderGeneratePage,
    classes: renderClassesPage,
    teachers: renderTeachersPage,
    subjects: renderSubjectsPage,
    classrooms: renderRoomsPage,
    calendar: renderCalendarPage,
    analytics: renderAnalyticsPage,
    announcements: renderAnnouncementsPage,
    notifications: renderNotificationsPage,
    audit: renderAuditPage,
    settings: () => {}
  };
  if (renderers[section]) renderers[section]();
}

function initNavigation() {
  document.querySelectorAll(".nav-link").forEach(link => {
    link.addEventListener("click", e => {
      e.preventDefault();
      navigateTo(link.dataset.section);
    });
  });
  document.getElementById("sidebar-open").addEventListener("click", openSidebarMobile);
  document.getElementById("sidebar-close").addEventListener("click", closeSidebarMobile);
  document.getElementById("sidebar-scrim").addEventListener("click", closeSidebarMobile);
  document.getElementById("logout-btn").addEventListener("click", () => {
    openConfirmModal("Log out", "Are you sure you want to log out?", doLogout);
  });
}
function openSidebarMobile() {
  document.getElementById("sidebar").classList.add("open");
  document.getElementById("sidebar-scrim").classList.add("show");
}
function closeSidebarMobile() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebar-scrim").classList.remove("show");
}

/* ============================ SHARED SELECT RENDERERS ============================ */
function renderAllStaticSelects() {
  renderFilterSelects();
}
function optionsFromList(list, valueKey, labelFn, includeBlank, blankLabel) {
  let html = includeBlank ? `<option value="">${blankLabel || "Select..."}</option>` : "";
  html += list.map(item => `<option value="${item[valueKey]}">${escapeHtml(labelFn(item))}</option>`).join("");
  return html;
}

/* ============================ DASHBOARD ============================ */
function renderDashboard() {
  const teachers = getTeachers(), subjects = getSubjects(), rooms = getRooms(), classes = getClasses(), tt = getTimetable();
  const conflicts = getAllConflicts();
  const isWeekday = new Date().getDay() >= 1 && new Date().getDay() <= 6;
  const todayLabel = isWeekday ? DAYS[new Date().getDay() - 1] : "Sunday (no classes)";

  document.getElementById("dash-date").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const stats = [
    { label: "Total Classes", value: classes.length, icon: "🎓", bg: "var(--blue-50)", color: "var(--blue-600)" },
    { label: "Total Teachers", value: teachers.length, icon: "🧑‍🏫", bg: "var(--success-bg)", color: "var(--success)" },
    { label: "Total Classrooms", value: rooms.length, icon: "🏛", bg: "var(--warning-bg)", color: "var(--warning)" },
    { label: "Total Subjects", value: subjects.length, icon: "📘", bg: "var(--info-bg)", color: "var(--info)" },
    { label: "Today's Classes", value: isWeekday ? tt.filter(e => e.day === todayLabel).length : 0, icon: "🗓", bg: "var(--blue-50)", color: "var(--blue-600)" },
    { label: "Timetable Conflicts", value: conflicts.length, icon: "⚠️", bg: "var(--danger-bg)", color: "var(--danger)" }
  ];
  document.getElementById("stat-grid").innerHTML = stats.map(s => `
    <div class="stat-card">
      <div class="stat-ico" style="background:${s.bg};color:${s.color}">${s.icon}</div>
      <div class="stat-meta"><span class="stat-num">${s.value}</span><span class="stat-label">${s.label}</span></div>
    </div>`).join("");

  document.getElementById("today-label").textContent = isWeekday ? todayLabel : "It's the weekend";
  const todayEntries = isWeekday ? tt.filter(e => e.day === todayLabel).sort((a, b) => a.slotId.localeCompare(b.slotId)) : [];
  document.getElementById("today-classes-list").innerHTML = todayEntries.length ? todayEntries.map(e => rowHtml(
    `${subjectName(e.subjectId)}`, `${className(e.classId)} • ${teacherName(e.teacherId)} • ${roomName(e.roomId)}`, slotLabel(e.slotId)
  )).join("") : `<p class="empty-inline">No classes scheduled for today.</p>`;

  const upcoming = getUpcomingEntries(6);
  document.getElementById("upcoming-classes-list").innerHTML = upcoming.length ? upcoming.map(e => rowHtml(
    `${subjectName(e.subjectId)}`, `${className(e.classId)} • ${roomName(e.roomId)}`, `${e.day} • ${slotLabel(e.slotId)}`
  )).join("") : `<p class="empty-inline">No upcoming classes found.</p>`;

  document.getElementById("conflict-count-label").textContent = conflicts.length ? `${conflicts.length} active` : "All clear";
  document.getElementById("dash-conflicts-list").innerHTML = conflicts.length ? conflicts.slice(0, 6).map(c => rowHtml(c.title, c.detail, "")).join("") : `<p class="empty-inline">✅ No conflicts detected across the timetable.</p>`;

  renderHealthScore();
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
          ${result.suggestions.map(s => `<li style="background:var(--blue-50);color:var(--text);">${escapeHtml(s)}</li>`).join("")}
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
  return {
    classId: document.getElementById("filter-class").value,
    teacherId: document.getElementById("filter-teacher").value,
    roomId: document.getElementById("filter-room").value,
    day: document.getElementById("filter-day").value,
    q: document.getElementById("tt-search").value.trim().toLowerCase()
  };
}

function entryMatchesFilters(e, f) {
  if (f.classId && e.classId !== f.classId) return false;
  if (f.teacherId && e.teacherId !== f.teacherId) return false;
  if (f.roomId && e.roomId !== f.roomId) return false;
  if (f.day && e.day !== f.day) return false;
  if (f.q) {
    const haystack = [subjectName(e.subjectId), teacherName(e.teacherId), roomName(e.roomId), className(e.classId), e.day, slotLabel(e.slotId)].join(" ").toLowerCase();
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
  const tt = getTimetable().filter(e => entryMatchesFilters(e, filters));
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
          body += `<div class="tt-entry${hasConflict ? " conflicted" : ""}" draggable="true" data-drag-id="${e.id}">
            <strong>${escapeHtml(subjectName(e.subjectId))}</strong>
            <span>${escapeHtml(className(e.classId))}</span>
            <span>${escapeHtml(teacherName(e.teacherId))} • ${escapeHtml(roomName(e.roomId))}</span>
            ${hasConflict ? `<span class="badge badge-danger small">⚠ Conflict</span>` : ""}
            <span class="drag-handle">⠿ drag to reschedule</span>
            <div class="tt-actions">
              <button type="button" data-edit="${e.id}">Edit</button>
              <button type="button" class="tt-del" data-del="${e.id}">Delete</button>
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
    openConfirmModal("Delete timetable entry", "This will permanently remove this class from the timetable.", () => {
      const removed = getTimetable().find(e => e.id === btn.dataset.del);
      setTimetable(getTimetable().filter(e => e.id !== btn.dataset.del));
      addNotification("A timetable entry was deleted.", "warning");
      if (removed) logAudit("delete", "Timetable Entry", `Deleted ${subjectName(removed.subjectId)} for ${className(removed.classId)} on ${removed.day} at ${slotLabel(removed.slotId)}.`);
      drawTimetableGrid();
      toast("Timetable entry deleted.", "success");
    });
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
      <div class="field"><label for="f-day">Day</label>
        <select id="f-day" required>${DAYS.map(d => `<option value="${d}" ${entry && entry.day === d ? "selected" : ""}>${d}</option>`).join("")}</select>
      </div>
      <div class="field"><label for="f-slot">Time slot</label>
        <select id="f-slot" required>${SLOTS.map(s => `<option value="${s.id}" ${entry && entry.slotId === s.id ? "selected" : ""}>${s.label}</option>`).join("")}</select>
      </div>
      <div class="field field-full"><label for="f-class">Class</label>
        <select id="f-class" required>
          <option value="">Select class</option>
          ${optionsFromList(classes, "id", c => `${c.name}`)}
        </select>
      </div>
      <div class="field field-full"><label for="f-section">Section</label>
        <select id="f-section" required>
          <option value="">Select section</option>
        </select>
      </div>
      <div class="field"><label for="f-subject">Subject</label>
        <select id="f-subject" required><option value="">Select subject</option>${optionsFromList(subjects, "id", s => `${s.code} - ${s.name}`)}</select>
      </div>
      <div class="field"><label for="f-teacher">Teacher</label>
        <select id="f-teacher" required><option value="">Select teacher</option>${optionsFromList(teachers, "id", t => t.name)}</select>
      </div>
      <div class="field field-full"><label for="f-room">Room</label>
        <select id="f-room" required><option value="">Select room</option>${optionsFromList(rooms, "id", r => `${r.number} (${r.type})`)}</select>
      </div>
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

    if (!sections.length) {
      sectionSelect.innerHTML = `<option value="">No sections available</option>`;
      return;
    }

    sectionSelect.innerHTML = `<option value="">Select section</option>` +
      sections.map(section => `
        <option value="${section.id}" ${String(section.id) === String(selectedSectionId) ? "selected" : ""}>
          Section ${escapeHtml(section.name)}
        </option>
      `).join("");
  } catch (error) {
    console.error("Unable to load sections:", error);
    sectionSelect.innerHTML = `<option value="">Unable to load sections</option>`;
    toast("Could not load sections for this class.", "error");
  }
}

function openTimetableForm(editId, presetDay, presetSlot) {
  const entry = editId
    ? getTimetable().find(e => String(e.id) === String(editId))
    : null;

  openFormModal(
    entry ? "Edit Timetable Entry" : "Add Timetable Entry",
    timetableFormFields(entry),
    () => {
      const classId = document.getElementById("f-class").value;
      const sectionId = document.getElementById("f-section").value;
      const cls = getClasses().find(c => String(c.id) === String(classId));

      const data = {
        day: document.getElementById("f-day").value,
        slotId: document.getElementById("f-slot").value,
        classId: classId,
        sectionId: sectionId,
        subjectId: document.getElementById("f-subject").value,
        teacherId: document.getElementById("f-teacher").value,
        roomId: document.getElementById("f-room").value,
        academicYearId: entry?.academicYearId ?? entry?.academic_year_id ?? cls?.academicYearId ?? cls?.academic_year_id ?? null
      };

      if (!data.classId || !data.sectionId || !data.subjectId || !data.teacherId || !data.roomId) {
        toast("Please select class, section, subject, teacher and room before saving.", "error");
        return;
      }

      saveTimetableEntry(data, editId);
    }
  );

  setTimeout(async () => {
    const classSelect = document.getElementById("f-class");
    const sectionSelect = document.getElementById("f-section");

    if (!classSelect || !sectionSelect) return;

    classSelect.addEventListener("change", async () => {
      await loadSectionsForClass(classSelect.value);
    });

    if (presetDay) {
      const daySelect = document.getElementById("f-day");
      const slotSelect = document.getElementById("f-slot");

      if (daySelect) daySelect.value = presetDay;
      if (slotSelect) slotSelect.value = presetSlot;
    }

    if (entry) {
      classSelect.value = entry.classId ?? entry.class_id ?? "";

      const selectedSectionId = entry.sectionId ?? entry.section_id ?? null;
      await loadSectionsForClass(classSelect.value, selectedSectionId);

      const subjectSelect = document.getElementById("f-subject");
      const teacherSelect = document.getElementById("f-teacher");
      const roomSelect = document.getElementById("f-room");

      if (subjectSelect) subjectSelect.value = entry.subjectId ?? entry.subject_id ?? "";
      if (teacherSelect) teacherSelect.value = entry.teacherId ?? entry.teacher_id ?? "";
      if (roomSelect) roomSelect.value = entry.roomId ?? entry.room_id ?? "";
    }
  }, 0);
}

function saveTimetableEntry(data, editId) {
  const conflicts = findConflicts(data, editId);
  const persist = (overridden) => {
    const tt = getTimetable();
    if (editId) {
      const idx = tt.findIndex(e => e.id === editId);
      tt[idx] = { ...tt[idx], ...data, overridden: overridden || false };
    } else {
      tt.push({ id: uid("tt"), ...data, overridden: overridden || false });
    }
    setTimetable(tt);
    closeFormModal();
    drawTimetableGrid();
    addNotification(`Timetable updated: ${subjectName(data.subjectId)} for ${className(data.classId)} on ${data.day}.`, overridden ? "warning" : "success");
    logAudit(overridden ? "override" : (editId ? "update" : "create"), "Timetable Entry",
      `${overridden ? "Overrode a conflict and " : ""}${editId ? "updated" : "added"} ${subjectName(data.subjectId)} for ${className(data.classId)} on ${data.day} at ${slotLabel(data.slotId)}.`);
    toast(editId ? "Timetable entry updated successfully." : "Timetable entry added successfully.", "success");
  };
  if (conflicts.length) {
    openConflictModal(conflicts, () => { persist(true); toast("Entry saved with an overridden conflict.", "warning"); });
  } else {
    persist(false);
  }
}

function initTimetablePage() {
  ["filter-class", "filter-teacher", "filter-room", "filter-day"].forEach(id =>
    document.getElementById(id).addEventListener("change", drawTimetableGrid));
  document.getElementById("tt-search").addEventListener("input", drawTimetableGrid);
  document.getElementById("tt-clear-filters").addEventListener("click", () => {
    ["filter-class", "filter-teacher", "filter-room", "filter-day"].forEach(id => document.getElementById(id).value = "");
    document.getElementById("tt-search").value = "";
    drawTimetableGrid();
  });
  document.getElementById("tt-add-btn").addEventListener("click", () => openTimetableForm(null));
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

  classSel.onchange = () => {
    generatorClassId = classSel.value;
    generatorSubjectSearch = "";
    generatorSubjectState = new Map();
    renderGenSubjectList();
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
      <input type="search" id="gen-subject-search" placeholder="Search subject code or name..." value="${escapeHtml(generatorSubjectSearch)}" style="flex:1;min-width:240px;padding:.65rem;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);" />
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
          <input type="text" class="gen-sub-teacher" list="gen-teacher-options" data-subject="${escapeHtml(subject.id)}" value="${escapeHtml(teacherValue)}" placeholder="Assign teacher" ${state.selected ? "" : "disabled"} style="min-width:220px;padding:.45rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);" />
          <input type="number" class="gen-sub-periods" data-subject="${escapeHtml(subject.id)}" min="1" max="7" value="${state.periods}" ${state.selected ? "" : "disabled"} style="width:64px;padding:.35rem;border:1px solid var(--border);border-radius:6px;" title="Weekly periods" />
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
    html += `<p class="badge badge-warning" style="display:block;margin-top:1rem;">⚠ Unable to schedule all requested periods without a clash.</p>
      <ul class="conflict-list">${result.unresolved.map(r => `<li>${escapeHtml(subjectName(r.subjectId))} — one or more requested periods could not be placed.</li>`).join("")}</ul>`;
  }

  if (successCount) {
    html += `<div class="field-row" style="margin-top:1rem;">
      <button class="btn btn-primary" id="gen-save-btn">Save generated timetable</button>
      <button class="btn btn-ghost" id="gen-discard-btn">Discard</button>
    </div>`;
  }

  box.innerHTML = html;

  if (successCount) {
    document.getElementById("gen-save-btn").addEventListener("click", () => {
      const tt = getTimetable().concat(pendingGeneratedEntries);
      setTimetable(tt);
      addNotification(`Auto-generated timetable saved for ${className(classId)} (${pendingGeneratedEntries.length} periods).`, "success");
      logAudit("generate", "Timetable", `Auto-generated and saved ${pendingGeneratedEntries.length} periods for ${className(classId)}.`);
      toast("Generated timetable saved successfully.", "success");
      pendingGeneratedEntries = [];
      box.classList.add("hidden");
    });

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

  const tt = getTimetable();
  const table = document.getElementById("calendar-grid");
  let head = `<thead><tr><th class="slot-col">Time</th>${DAYS.map((d, i) => {
    const date = new Date(monday); date.setDate(monday.getDate() + i);
    return `<th${d === todayName ? ' class="today-col"' : ""}>${d}<br><span class="muted small">${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></th>`;
  }).join("")}</tr></thead>`;
  let body = "<tbody>";
  SLOTS.forEach(slot => {
    body += `<tr><td class="slot-col">${slot.label}</td>`;
    DAYS.forEach(day => {
      const entries = tt.filter(e => e.day === day && e.slotId === slot.id);
      body += `<td${day === todayName ? ' class="today-col"' : ""}><div class="tt-cell">`;
      entries.forEach(e => {
        body += `<div class="tt-entry"><strong>${escapeHtml(subjectName(e.subjectId))}</strong><span>${escapeHtml(className(e.classId))}</span><span>${escapeHtml(roomName(e.roomId))}</span></div>`;
      });
      body += `</div></td>`;
    });
    body += "</tr>";
  });
  body += "</tbody>";
  table.innerHTML = head + body;
}
function initCalendarPage() {
  document.getElementById("cal-prev").addEventListener("click", () => { calendarWeekOffset--; renderCalendarPage(); });
  document.getElementById("cal-next").addEventListener("click", () => { calendarWeekOffset++; renderCalendarPage(); });
  document.getElementById("cal-today").addEventListener("click", () => { calendarWeekOffset = 0; renderCalendarPage(); });
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

/* ============================ COMMAND PALETTE ============================ */
function buildCommandList() {
  const nav = Array.from(document.querySelectorAll(".nav-link")).map(link => ({
    icon: link.querySelector(".nav-ico").textContent, label: link.textContent.trim().replace(/\d+$/, "").trim(),
    hint: "Go to page", run: () => navigateTo(link.dataset.section)
  }));
  const actions = [
    { icon: "➕", label: "Add timetable entry", hint: "Timetable", run: () => { navigateTo("timetable"); setTimeout(() => openTimetableForm(null), 0); } },
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
    navigator.serviceWorker.register("service-worker.js").catch(() => { /* offline install unavailable on this host — app still works fully online */ });
  }
}

/* ============================ INIT ============================ */
document.addEventListener("DOMContentLoaded", async () => {
  initLoginPage();
  initNavigation();
  initTimetablePage();
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
    const loaded = await loadBackendData();
    if (loaded) {
      showApp();
      return;
    }
    doLogout();
  }
});
