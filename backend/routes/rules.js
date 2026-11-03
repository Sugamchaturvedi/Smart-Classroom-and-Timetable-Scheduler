const express = require("express");
const router = express.Router();
const authenticate = require("../middleware/auth");
const { requireAdmin, requireTeacherOwnership } = require("../middleware/auth");
const rulesController = require("../controllers/rulesController");

// Public / Authenticated read rules
router.get("/", authenticate, rulesController.getRules);
router.get("/rules", authenticate, rulesController.getRules);
router.get("/key/:key", authenticate, rulesController.getRuleByKey);

// Admin configuration
router.put("/key/:key", authenticate, requireAdmin, rulesController.updateRule);
router.post("/reset-defaults", authenticate, requireAdmin, rulesController.resetRulesToDefaults);

// Teacher preferences
router.get("/teacher-preferences/:teacherId", authenticate, requireTeacherOwnership("teacherId"), rulesController.getTeacherPreferences);
router.post("/teacher-preferences", authenticate, rulesController.saveTeacherPreferences);
router.get("/all-teacher-preferences", authenticate, requireAdmin, rulesController.getAllTeacherPreferences);
router.put("/teacher-preferences/:id/status", authenticate, requireAdmin, rulesController.updatePreferenceStatus);

// Workload metrics
router.get("/workload-stats/:teacherId", authenticate, requireTeacherOwnership("teacherId"), rulesController.getTeacherWorkloadStats);

module.exports = router;
