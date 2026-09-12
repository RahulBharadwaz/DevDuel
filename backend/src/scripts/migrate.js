const fs = require('fs');
const path = require('path');
const db = require('../config/db');

async function runMigration() {
  console.log('[MIGRATION] Starting database migration...');
  
  if (db.isUsingMock()) {
    console.log('[MIGRATION] Running with in-memory mock database. Tables and indexes initialized in-memory.');
    return;
  }

  try {
    const schemaPath = path.join(__dirname, '../config/schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');

    console.log('[MIGRATION] Executing schema.sql against PostgreSQL...');
    await db.query(sql);
    console.log('[MIGRATION] Database schema migration completed successfully!');
  } catch (err) {
    console.error('[MIGRATION ERROR] Failed to run schema migration:', err);
    process.exit(1);
  } finally {
    if (db.pool) {
      await db.pool.end();
    }
  }
}

if (require.main === module) {
  runMigration();
}

module.exports = { runMigration };
