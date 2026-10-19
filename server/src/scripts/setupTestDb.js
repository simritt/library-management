/**
 * Rebuilds the isolated TEST database (library_test_db) from database/schema.sql
 * and the standard seed data. It refuses to run against the development database.
 *
 *   npm run test:setup
 */
process.env.NODE_ENV = 'test';
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

async function setupTestDb() {
  const testDb = process.env.TEST_DB_NAME || 'library_test_db';
  if (testDb === (process.env.DB_NAME || 'library_db')) {
    throw new Error('TEST_DB_NAME must differ from DB_NAME; refusing to reset the development database.');
  }

  const admin = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || ''
  });
  try {
    await admin.query(`CREATE DATABASE IF NOT EXISTS \`${testDb}\``);
    await admin.query(`USE \`${testDb}\``);

    const raw = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'database', 'schema.sql'), 'utf8');
    const statements = raw
      .split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')
      .split(';').map((s) => s.trim())
      .filter((s) => s && !/^(CREATE DATABASE|USE)\b/i.test(s));

    await admin.query('SET FOREIGN_KEY_CHECKS = 0');
    const [tables] = await admin.query('SHOW TABLES');
    for (const row of tables) await admin.query(`DROP TABLE IF EXISTS \`${Object.values(row)[0]}\``);
    await admin.query('SET FOREIGN_KEY_CHECKS = 1');
    for (const statement of statements) await admin.query(statement);
  } finally {
    await admin.end();
  }

  const { seedDatabase } = require('./seed');
  await seedDatabase();
  const { pool } = require('../config/db');
  await pool.end();
  console.log(`Test database "${testDb}" rebuilt and seeded.`);
}

if (require.main === module) {
  setupTestDb().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
}

module.exports = { setupTestDb };
