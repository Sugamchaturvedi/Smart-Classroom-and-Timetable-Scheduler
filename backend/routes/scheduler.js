const express = require("express");

const authenticate = require("../middleware/auth");

const {
    generateTimetable
} = require("../controllers/schedulerController");

const router = express.Router();

router.post(
    "/generate",
    authenticate,
    generateTimetable
);

module.exports = router;