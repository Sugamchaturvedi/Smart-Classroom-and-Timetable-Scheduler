const express = require("express");

const authenticate = require("../middleware/auth");

const {
    getTimetable,
    createTimetable,
    updateTimetable,
    deleteTimetable
} = require("../controllers/timetableController");

const router = express.Router();

router.get(
    "/",
    authenticate,
    getTimetable
);

router.post(
    "/",
    authenticate,
    createTimetable
);

router.put(
    "/:id",
    authenticate,
    updateTimetable
);

router.delete(
    "/:id",
    authenticate,
    deleteTimetable
);

module.exports = router;