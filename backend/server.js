const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const pool = require("./db");
const { maintenanceMiddleware, validateMaintenanceConfig } = require("./middleware/maintenance");

const app = express();

app.use(
    cors({
        origin: true,
        credentials: true
    })
);

app.use(express.json({ limit: "5mb" }));

// Fail-closed maintenance-mode write-protection gate
app.use(maintenanceMiddleware);

app.use(express.static(path.join(__dirname, "../frontend")));
app.use("/frontend", express.static(path.join(__dirname, "../frontend")));

app.get("/api", (req, res) => {
    res.json({
        success: true,
        message: "Smart Classroom & Timetable Scheduler API",
        version: "1.0.0"
    });
});

app.get("/api/health", async (req, res) => {

    try {

        const result = await pool.query(
            "SELECT NOW() AS time"
        );

        res.json({
            success: true,
            database: "connected",
            timestamp: result.rows[0].time
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            database: "disconnected",
            error: error.message
        });
    }
});

app.use(
    "/api/auth",
    require("./routes/auth")
);

app.use(
    "/api/admin/teacher-accounts",
    require("./routes/adminTeacherAccounts")
);

app.use(
    "/api/teachers/me",
    require("./routes/teachersMe")
);

app.use(
    "/api/programs",
    require("./routes/programs")
);

app.use(
    "/api/teachers",
    require("./routes/teachers")
);

app.use(
    "/api/classes",
    require("./routes/classes")
);

app.use(
    "/api/subjects",
    require("./routes/subjects")
);

app.use(
    "/api/rooms",
    require("./routes/rooms")
);

app.use(
    "/api/timetable",
    require("./routes/timetable")
);

app.use(
    "/api/sections",
    require("./routes/sections")
);

app.use(
    "/api/scheduler",
    require("./routes/scheduler")
);

app.use(
    "/api/analytics",
    require("./routes/analytics")
);

app.use(
    "/api/study-plans",
    require("./routes/studyPlans")
);

app.use(
    "/api/rules",
    require("./routes/rules")
);


app.use((req, res) => {

    res.status(404).json({
        success: false,
        message: "API endpoint not found"
    });
});

app.use((err, req, res, next) => {
    console.error("Unhandled API error:", err);
    if (res.headersSent) {
        return next(err);
    }
    res.status(err.status || 500).json({
        success: false,
        message: err.message && req.app.get("env") === "development" ? err.message : "Internal server error"
    });
});

const PORT = process.env.PORT || 5000;

if (require.main === module) {
    const configError = validateMaintenanceConfig(process.env.MAINTENANCE_MODE);
    if (configError) {
        console.error(`[FATAL CONFIGURATION ERROR] ${configError} Server startup aborted.`);
        process.exit(1);
    }

    app.listen(PORT, () => {
        console.log(
            `Smart Scheduler API running on http://localhost:${PORT}`
        );
    });
}

module.exports = app;