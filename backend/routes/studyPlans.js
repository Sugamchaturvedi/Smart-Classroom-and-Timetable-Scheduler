const express = require("express");
const { authenticate, requireAdmin } = require("../middleware/auth");
const {
    getStudyPlans,
    getStudyPlanById,
    createStudyPlan,
    updateStudyPlan,
    deleteStudyPlan
} = require("../controllers/studyPlanController");

const router = express.Router();

router.get("/", authenticate, getStudyPlans);
router.get("/:id", authenticate, getStudyPlanById);
router.post("/", authenticate, requireAdmin, createStudyPlan);
router.put("/:id", authenticate, requireAdmin, updateStudyPlan);
router.delete("/:id", authenticate, requireAdmin, deleteStudyPlan);

module.exports = router;
