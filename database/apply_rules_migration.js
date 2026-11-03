const fs = require("fs");
const path = require("path");
const pool = require("../backend/db");

async function run() {
  console.log("Applying timetable rules migration...");
  const sql = fs.readFileSync(path.join(__dirname, "migration_timetable_rules.sql"), "utf8");
  await pool.query(sql);
  console.log("Timetable rules migration applied successfully.");

  const rules = await pool.query("SELECT rule_key, name, is_enabled, is_mandatory, config FROM timetable_rules ORDER BY id");
  console.log(`Loaded ${rules.rows.length} rules:`);
  rules.rows.forEach(r => {
    console.log(` - [${r.rule_key}] (${r.is_mandatory ? 'MANDATORY' : 'PREFERENCE'} | ${r.is_enabled ? 'ENABLED' : 'DISABLED'}): ${r.name}`);
  });

  const prefs = await pool.query("SELECT * FROM teacher_preferences");
  console.log(`Loaded ${prefs.rows.length} teacher preferences.`);

  process.exit(0);
}

run().catch(err => {
  console.error("Rules migration error:", err);
  process.exit(1);
});
