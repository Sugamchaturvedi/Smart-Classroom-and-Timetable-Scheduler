const express = require("express");

const authenticate = require("../middleware/auth");

const {
    dashboard,
    teacherWorkload,
    roomUsage,
    classesPerDay
} = require("../controllers/analyticsController");

const router = express.Router();

router.get(
    "/dashboard",
    authenticate,
    dashboard
);

router.get(
    "/teacher-workload",
    authenticate,
    teacherWorkload
);

router.get(
    "/room-usage",
    authenticate,
    roomUsage
);

router.get(
    "/classes-per-day",
    authenticate,
    classesPerDay
);

module.exports = router;