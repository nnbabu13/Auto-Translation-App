
import { db, translationSessionsTable, translationLogsTable, usersTable, sessionsTable } from './index';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { DATABASE_URL } from './index';

async function checkDb() {
  console.log('🚀 Checking database...');

  // Create a raw pg client to inspect tables
  const pool = new Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();

  try {
    // List tables
    console.log('\n1️⃣ Tables in translationapp_coachunder:');
    const tables = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'translationapp_coachunder'
    `);
    console.log(tables.rows.map(r => r.table_name));

    // Check translation_sessions columns
    console.log('\n2️⃣ translation_sessions columns:');
    const sessionCols = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'translationapp_coachunder' AND table_name = 'translation_sessions'
    `);
    console.log(sessionCols.rows);

  } finally {
    client.release();
    await pool.end();
  }
}

checkDb().catch(console.error);
