const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../backend/.env") });

const sourcePool = require("../backend/db");

const targetConnectionString = process.argv[2] || process.env.SUPABASE_DATABASE_URL || process.env.TARGET_DATABASE_URL;

if (!targetConnectionString) {
  console.error("Usage: node database/migrate_to_supabase.js <SUPABASE_CONNECTION_STRING>");
  console.error("Or set SUPABASE_DATABASE_URL environment variable.");
  process.exit(1);
}

const targetPool = new Pool({
  connectionString: targetConnectionString,
  ssl: { rejectUnauthorized: false },
  max: 10,
  connectionTimeoutMillis: 15000
});

const TABLES_IN_ORDER = [
  "programs",
  "departments",
  "users",
  "teachers",
  "students",
  "academic_years",
  "semesters",
  "classes",
  "sections",
  "subjects",
  "teacher_subjects",
  "class_subjects",
  "buildings",
  "rooms",
  "time_slots",
  "teacher_availability",
  "room_availability",
  "timetable",
  "announcements",
  "notifications",
  "audit_logs",
  "teacher_absences",
  "substitute_assignments",
  "timetable_change_requests",
  "study_plans",
  "timetable_rules",
  "teacher_preferences"
];

async function migrate() {
  console.log("==================================================================");
  console.log("SMART CLASSROOM SCHEDULER - SUPABASE MIGRATION");
  console.log("==================================================================");

  try {
    // 1. Verify connections
    console.log("\n[1/4] Verifying database connectivity...");
    const srcTest = await sourcePool.query("SELECT NOW() as t");
    console.log(" -> Source database connected (local):", srcTest.rows[0].t);

    const tgtTest = await targetPool.query("SELECT NOW() as t");
    console.log(" -> Target database connected (Supabase):", tgtTest.rows[0].t);

    // 2. Apply schema DDL
    console.log("\n[2/4] Applying production schema DDL to Supabase...");
    const schemaSql = fs.readFileSync(path.join(__dirname, "supabase_production_schema.sql"), "utf8");
    await targetPool.query(schemaSql);
    console.log(" -> Schema DDL applied successfully.");

    // 3. Migrate tables
    console.log("\n[3/4] Migrating table data in dependency order...");
    for (const table of TABLES_IN_ORDER) {
      const srcRowsRes = await sourcePool.query(`SELECT * FROM "${table}"`);
      const srcRows = srcRowsRes.rows;

      if (srcRows.length === 0) {
        console.log(` - Table "${table}": 0 rows (skipping data copy)`);
        continue;
      }

      const countRes = await targetPool.query(`SELECT count(*) FROM "${table}"`);
      const currentTargetCount = parseInt(countRes.rows[0].count, 10);

      if (currentTargetCount > 0) {
        console.log(` - Table "${table}": already has ${currentTargetCount} rows in target, skipping overwrite.`);
        continue;
      }

      console.log(` - Migrating table "${table}" (${srcRows.length} rows)...`);
      const columns = Object.keys(srcRows[0]);
      const colList = columns.map(c => `"${c}"`).join(", ");

      const BATCH_SIZE = 500;
      for (let i = 0; i < srcRows.length; i += BATCH_SIZE) {
        const batch = srcRows.slice(i, i + BATCH_SIZE);
        const valuePlaceholders = [];
        const values = [];
        let pIndex = 1;

        for (const row of batch) {
          const rowPlaceholders = [];
          for (const col of columns) {
            rowPlaceholders.push(`$${pIndex++}`);
            values.push(row[col]);
          }
          valuePlaceholders.push(`(${rowPlaceholders.join(", ")})`);
        }

        const insertSql = `INSERT INTO "${table}" (${colList}) VALUES ${valuePlaceholders.join(", ")} ON CONFLICT DO NOTHING`;
        await targetPool.query(insertSql, values);
      }

      // Reset sequence if table has serial 'id'
      try {
        await targetPool.query(`
          SELECT setval(
            pg_get_serial_sequence('"${table}"', 'id'),
            COALESCE((SELECT MAX(id) FROM "${table}"), 1),
            true
          )
        `);
      } catch (_) {
        // Table might not have 'id' sequence (e.g. composite PK)
      }
      console.log(`   ✓ Completed "${table}"`);
    }

    // 4. Verification
    console.log("\n[4/4] Verifying table record counts on Supabase...");
    let verifiedCount = 0;
    for (const table of TABLES_IN_ORDER) {
      const targetCountRes = await targetPool.query(`SELECT count(*) FROM "${table}"`);
      const count = parseInt(targetCountRes.rows[0].count, 10);
      console.log(` - ${table.padEnd(28)} : ${count} rows`);
      verifiedCount += count;
    }

    console.log("\n==================================================================");
    console.log(`✓ MIGRATION COMPLETE: ${verifiedCount} total records verified on Supabase.`);
    console.log("==================================================================");
    process.exit(0);
  } catch (err) {
    console.error("\n❌ MIGRATION FAILED:", err);
    process.exit(1);
  }
}

migrate();
