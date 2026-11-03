const express = require("express");
const authenticate = require("../middleware/auth");

const {
    getTimetable,
    createTimetable,
    updateTimetable,
    deleteTimetable,
    clearTimetable,
    getTimeSlots,
    checkAvailability,
    getMakeupClasses,
    createMakeupClass,
    updateMakeupClass,
    cancelMakeupClass
} = require("../controllers/timetableController");

const router = express.Router();

// Specific routes before generic routes
router.get("/slots", authenticate, getTimeSlots);
router.get("/availability", authenticate, checkAvailability);

router.get("/makeup", authenticate, getMakeupClasses);
router.post("/makeup", authenticate, createMakeupClass);
router.put("/makeup/:id", authenticate, updateMakeupClass);
router.post("/makeup/:id/cancel", authenticate, cancelMakeupClass);
router.delete("/makeup/:id", authenticate, cancelMakeupClass);

// Bulk deletion routes (before :id)
router.delete("/clear", authenticate, clearTimetable);
router.delete("/all", authenticate, clearTimetable);
router.delete("/", authenticate, clearTimetable);

// Standard timetable CRUD
router.get("/", authenticate, getTimetable);
router.post("/", authenticate, createTimetable);
router.put("/:id", authenticate, updateTimetable);
router.delete("/:id", authenticate, deleteTimetable);

module.exports = router;