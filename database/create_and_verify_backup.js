const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '../backend/.env') });
const pool = require('../backend/db');

function formatTimestamp(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}${mm}${dd}_${hh}${min}${ss}`;
}

function calculateSha256(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

async function runBackupAndValidation() {
  console.log('================================================================');
  console.log('STAGE 1: POSTGRESQL COMPLETE BACKUP & VALIDATION');
  console.log('================================================================\n');

  const ts = formatTimestamp();
  const backupDirName = `pg_backup_${ts}`;
  const backupDirPath = path.join(__dirname, 'backups', backupDirName);

  if (!fs.existsSync(backupDirPath)) {
    fs.mkdirSync(backupDirPath, { recursive: true });
  }

  console.log(`Created backup directory: ${backupDirPath}`);

  // 1. Query live tables and record source counts
  console.log('\n--- 1. Querying PostgreSQL Source Tables & Live Row Counts ---');
  const tablesRes = await pool.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `);

  const tables = tablesRes.rows.map(r => r.table_name);
  const sourceTableCounts = {};
  let totalRecords = 0;

  for (const tableName of tables) {
    const countRes = await pool.query(`SELECT COUNT(*) AS cnt FROM "${tableName}"`);
    const count = parseInt(countRes.rows[0].cnt, 10);
    sourceTableCounts[tableName] = count;
    totalRecords += count;
    console.log(`  - ${tableName.padEnd(28)}: ${count.toLocaleString()} rows`);
  }

  console.log(`Total Source Tables : ${tables.length}`);
  console.log(`Total Live Records  : ${totalRecords.toLocaleString()}`);

  // Save table counts JSON
  const countsJsonPath = path.join(backupDirPath, 'source_table_counts.json');
  fs.writeFileSync(countsJsonPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    totalTables: tables.length,
    totalRecords,
    tables: sourceTableCounts
  }, null, 2), 'utf8');

  // 2. Perform Complete PostgreSQL Backup using pg_dump
  console.log('\n--- 2. Creating Complete PostgreSQL Backups ---');
  const dbHost = process.env.DB_HOST || 'localhost';
  const dbPort = process.env.DB_PORT || '5432';
  const dbName = process.env.DB_NAME || 'university_timetable';
  const dbUser = process.env.DB_USER || 'postgres';
  const dbPass = process.env.DB_PASSWORD || '';

  const env = { ...process.env, PGPASSWORD: dbPass };

  // A. Custom Binary Format (.dump)
  const dumpFilePath = path.join(backupDirPath, `${dbName}.dump`);
  console.log(`Dumping compressed custom archive to: ${path.basename(dumpFilePath)}...`);
  execSync(`pg_dump -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} -F c -b -v -f "${dumpFilePath}"`, {
    env,
    stdio: 'pipe'
  });
  const dumpStats = fs.statSync(dumpFilePath);
  console.log(`  -> Archive created: ${(dumpStats.size / (1024 * 1024)).toFixed(2)} MB (${dumpStats.size.toLocaleString()} bytes)`);

  // B. Plain-text SQL Format (.sql)
  const sqlFilePath = path.join(backupDirPath, `${dbName}.sql`);
  console.log(`Dumping plain-text SQL schema & data to: ${path.basename(sqlFilePath)}...`);
  execSync(`pg_dump -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} -F p -v -f "${sqlFilePath}"`, {
    env,
    stdio: 'pipe'
  });
  const sqlStats = fs.statSync(sqlFilePath);
  console.log(`  -> SQL script created: ${(sqlStats.size / (1024 * 1024)).toFixed(2)} MB (${sqlStats.size.toLocaleString()} bytes)`);

  // 3. Verify Backup Archive Integrity with pg_restore -l
  console.log('\n--- 3. Verifying Backup Archive Integrity ---');
  const restoreListOutput = execSync(`pg_restore -l "${dumpFilePath}"`, {
    env,
    encoding: 'utf8'
  });

  const restoreLines = restoreListOutput.split('\n').filter(l => l.trim() && !l.startsWith(';'));
  console.log(`  -> pg_restore successfully parsed ${restoreLines.length} archive TOC entries.`);

  // Verify that all 27 tables are listed in the archive TOC
  const missingTablesInArchive = tables.filter(t => !restoreListOutput.includes(`TABLE DATA public ${t} `) && !restoreListOutput.includes(`TABLE public ${t} `));
  if (missingTablesInArchive.length > 0) {
    console.warn('  [WARNING] Tables missing from archive TOC:', missingTablesInArchive);
  } else {
    console.log(`  -> Verified: All ${tables.length} tables are present in the backup archive TOC.`);
  }

  // 4. Calculate Checksums & Write Manifest
  console.log('\n--- 4. Computing File Checksums & Manifest ---');
  const dumpSha256 = calculateSha256(dumpFilePath);
  const sqlSha256 = calculateSha256(sqlFilePath);
  const countsSha256 = calculateSha256(countsJsonPath);

  console.log(`  - ${path.basename(dumpFilePath)} SHA-256: ${dumpSha256}`);
  console.log(`  - ${path.basename(sqlFilePath)} SHA-256: ${sqlSha256}`);

  const manifest = {
    backupName: backupDirName,
    createdAt: new Date().toISOString(),
    databaseName: dbName,
    databaseHost: dbHost,
    databasePort: dbPort,
    databaseUser: dbUser,
    totalTables: tables.length,
    totalRecords,
    archiveVerification: {
      status: 'VERIFIED',
      pgRestoreTocEntries: restoreLines.length,
      allTablesPresent: missingTablesInArchive.length === 0
    },
    files: [
      {
        filename: path.basename(dumpFilePath),
        format: 'PostgreSQL custom binary archive (pg_dump -F c)',
        sizeBytes: dumpStats.size,
        sha256: dumpSha256
      },
      {
        filename: path.basename(sqlFilePath),
        format: 'Plain-text SQL script (DDL + COPY data)',
        sizeBytes: sqlStats.size,
        sha256: sqlSha256
      },
      {
        filename: path.basename(countsJsonPath),
        format: 'JSON record count baseline',
        sizeBytes: fs.statSync(countsJsonPath).size,
        sha256: countsSha256
      }
    ]
  };

  const manifestPath = path.join(backupDirPath, 'backup_manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`  -> Manifest written to: ${path.basename(manifestPath)}`);

  console.log('\n================================================================');
  console.log('STAGE 1 BACKUP & VALIDATION COMPLETED SUCCESSFULLY!');
  console.log(`Location: ${backupDirPath}`);
  console.log('================================================================');

  await pool.end();
}

runBackupAndValidation().catch(err => {
  console.error('Fatal backup error:', err.message);
  process.exit(1);
});
