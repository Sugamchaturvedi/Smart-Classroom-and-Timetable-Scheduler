const express = require("express");
const authenticate = require("../middleware/auth");
const { getSections } = require("../controllers/sectionController");

const router = express.Router();

router.get("/", authenticate, getSections);

module.exports = router;
