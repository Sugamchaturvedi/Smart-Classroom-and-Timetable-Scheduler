const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const pool = require("../backend/db");

async function run() {
  console.log("Applying database migration...");
  const sql = fs.readFileSync(path.join(__dirname, "migration_teacher_accounts_and_profiles.sql"), "utf8");
  await pool.query(sql);
  console.log("Base SQL migration applied successfully.");

  // Check if teacher user account exists
  const existingTeacher = await pool.query(
    "SELECT id FROM users WHERE LOWER(email) = 'teacher@brightfield.edu'"
  );

  let teacherUserId;
  if (existingTeacher.rows.length === 0) {
    const hash = await bcrypt.hash("teacher123", 10);
    const insertRes = await pool.query(
      `INSERT INTO users (full_name, email, password_hash, role, is_active, phone, last_login)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING id`,
      ["Faculty 1", "teacher@brightfield.edu", hash, "TEACHER", true, "+1 (555) 012-3456"]
    );
    teacherUserId = insertRes.rows[0].id;
    console.log(`Created teacher user account id: ${teacherUserId}`);
  } else {
    teacherUserId = existingTeacher.rows[0].id;
    // ensure password is teacher123
    const hash = await bcrypt.hash("teacher123", 10);
    await pool.query(
      "UPDATE users SET password_hash = $1, role = 'TEACHER', is_active = true WHERE id = $2",
      [hash, teacherUserId]
    );
    console.log(`Teacher user account exists, updated with id: ${teacherUserId}`);
  }

  // Link Teacher 1 (FAC-0001) to this user account
  await pool.query(
    `UPDATE teachers 
     SET user_id = $1, email = 'teacher@brightfield.edu' 
     WHERE id = 1`,
    [teacherUserId]
  );
  console.log("Teacher 1 linked to teacher@brightfield.edu.");

  // Verify accounts in DB
  const users = await pool.query("SELECT id, full_name, email, role, is_active, last_login FROM users");
  console.log("Current users in DB:", users.rows);

  process.exit(0);
}

run().catch(err => {
  console.error("Migration error:", err);
  process.exit(1);
});
