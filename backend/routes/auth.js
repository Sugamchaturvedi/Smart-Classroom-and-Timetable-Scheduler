const express = require("express");
const router = express.Router();
const authenticate = require("../middleware/auth");
const { loginRateLimiter } = require("../middleware/rateLimiter");

const {
    login,
    register,
    getMe,
    updateProfile,
    changePassword,
    logout
} = require("../controllers/authController");

router.post("/login", loginRateLimiter, login);
router.post("/register", register);
router.post("/logout", authenticate, logout);

router.get("/me", authenticate, getMe);
router.put("/profile", authenticate, updateProfile);
router.put("/change-password", authenticate, changePassword);

module.exports = router;