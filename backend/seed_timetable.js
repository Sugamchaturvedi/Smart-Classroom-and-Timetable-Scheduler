const pool = require('./db');

async function seedTimetable() {
  const countRes = await pool.query('SELECT COUNT(*) FROM timetable');
  if (parseInt(countRes.rows[0].count) > 0) {
    console.log('Timetable already has entries:', countRes.rows[0].count);
    return;
  }
  
  const [classes, teachers, subjects, rooms, slots] = await Promise.all([
    pool.query('SELECT c.id AS class_id, s.id AS section_id FROM classes c JOIN sections s ON s.class_id = c.id ORDER BY c.id, s.id LIMIT 6'),
    pool.query('SELECT id FROM teachers ORDER BY id LIMIT 10'),
    pool.query('SELECT id FROM subjects ORDER BY id LIMIT 10'),
    pool.query('SELECT id FROM rooms ORDER BY id LIMIT 10'),
    pool.query('SELECT id, slot_code FROM time_slots ORDER BY id')
  ]);

  const schedule = [
    { day: 'Monday', slotIdx: 1, classIdx: 0, subIdx: 0, teachIdx: 0, roomIdx: 0 },
    { day: 'Monday', slotIdx: 2, classIdx: 0, subIdx: 1, teachIdx: 1, roomIdx: 1 },
    { day: 'Monday', slotIdx: 3, classIdx: 0, subIdx: 2, teachIdx: 2, roomIdx: 2 },
    { day: 'Monday', slotIdx: 4, classIdx: 1, subIdx: 3, teachIdx: 3, roomIdx: 3 },
    { day: 'Monday', slotIdx: 5, classIdx: 1, subIdx: 4, teachIdx: 4, roomIdx: 4 },

    { day: 'Tuesday', slotIdx: 1, classIdx: 0, subIdx: 2, teachIdx: 2, roomIdx: 1 },
    { day: 'Tuesday', slotIdx: 2, classIdx: 0, subIdx: 0, teachIdx: 0, roomIdx: 0 },
    { day: 'Tuesday', slotIdx: 4, classIdx: 0, subIdx: 5, teachIdx: 5, roomIdx: 5 },
    { day: 'Tuesday', slotIdx: 5, classIdx: 1, subIdx: 1, teachIdx: 1, roomIdx: 2 },

    { day: 'Wednesday', slotIdx: 1, classIdx: 0, subIdx: 1, teachIdx: 1, roomIdx: 1 },
    { day: 'Wednesday', slotIdx: 3, classIdx: 0, subIdx: 3, teachIdx: 3, roomIdx: 3 },
    { day: 'Wednesday', slotIdx: 4, classIdx: 1, subIdx: 0, teachIdx: 0, roomIdx: 0 },
    { day: 'Wednesday', slotIdx: 6, classIdx: 1, subIdx: 2, teachIdx: 2, roomIdx: 4 },

    { day: 'Thursday', slotIdx: 1, classIdx: 0, subIdx: 4, teachIdx: 4, roomIdx: 2 },
    { day: 'Thursday', slotIdx: 2, classIdx: 0, subIdx: 2, teachIdx: 2, roomIdx: 1 },
    { day: 'Thursday', slotIdx: 5, classIdx: 1, subIdx: 5, teachIdx: 5, roomIdx: 5 },

    { day: 'Friday', slotIdx: 1, classIdx: 0, subIdx: 0, teachIdx: 0, roomIdx: 0 },
    { day: 'Friday', slotIdx: 2, classIdx: 0, subIdx: 3, teachIdx: 3, roomIdx: 3 },
    { day: 'Friday', slotIdx: 3, classIdx: 1, subIdx: 1, teachIdx: 1, roomIdx: 1 },
    { day: 'Friday', slotIdx: 6, classIdx: 1, subIdx: 4, teachIdx: 4, roomIdx: 4 }
  ];

  for (const s of schedule) {
    const cls = classes.rows[s.classIdx];
    const teach = teachers.rows[s.teachIdx];
    const sub = subjects.rows[s.subIdx];
    const room = rooms.rows[s.roomIdx];
    const slot = slots.rows[s.slotIdx];

    await pool.query(
      `INSERT INTO timetable 
       (academic_year_id, class_id, section_id, subject_id, teacher_id, room_id, time_slot_id, day_of_week, status, entry_type)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, 'scheduled', 'regular')`,
      [cls.class_id, cls.section_id, sub.id, teach.id, room.id, slot.id, s.day]
    );
  }
  console.log(`Seeded ${schedule.length} timetable entries into PostgreSQL!`);
}

seedTimetable()
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1); });
