const express = require("express");
const cors = require("cors");
require("dotenv").config();

const pool = require("./db");

const app = express();

app.use(
    cors({
        origin: true,
        credentials: true
    })
);

app.use(express.json({ limit: "5mb" }));

app.get("/", (req, res) => {

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

app.use((req, res) => {

    res.status(404).json({
        success: false,
        message: "API endpoint not found"
    });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {

    console.log(
        `Smart Scheduler API running on http://localhost:${PORT}`
    );
});