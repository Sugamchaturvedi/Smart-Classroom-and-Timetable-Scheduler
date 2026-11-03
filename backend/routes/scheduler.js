const express = require("express");

const { authenticate, requireAdmin } = require("../middleware/auth");

const {
    generateTimetable
} = require("../controllers/schedulerController");

const router = express.Router();

router.post(
    "/generate",
    authenticate,
    requireAdmin,
    generateTimetable
);

module.exports = router;