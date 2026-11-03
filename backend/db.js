const { Pool } = require("pg");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const rawConnString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL;

let poolConfig;

if (rawConnString && rawConnString.trim()) {
    const connStr = rawConnString.trim();
    const isLocalhost = connStr.includes("localhost") || connStr.includes("127.0.0.1");
    const requireSsl = process.env.DB_SSL === "false" ? false : (!isLocalhost || process.env.DB_SSL === "true");

    poolConfig = {
        connectionString: connStr,
        ssl: requireSsl ? { rejectUnauthorized: false } : false,
        max: parseInt(process.env.DB_MAX_CONNECTIONS || "10", 10),
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000
    };
} else {
    const isLocalhost = !process.env.DB_HOST || process.env.DB_HOST === "localhost" || process.env.DB_HOST === "127.0.0.1";
    const requireSsl = process.env.DB_SSL === "true" || (!isLocalhost && process.env.DB_SSL !== "false");

    poolConfig = {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        ssl: requireSsl ? { rejectUnauthorized: false } : false,
        max: parseInt(process.env.DB_MAX_CONNECTIONS || "10", 10),
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000
    };
}

const pool = new Pool(poolConfig);

pool.on("error", error => {
    console.error("Unexpected PostgreSQL error:", error);
});

module.exports = pool;
