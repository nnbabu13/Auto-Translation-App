
const { Pool } = require('pg');

const DATABASE_URL = 'postgresql://Translationapp_coachunder:d1102b1d82da238377daa3cce00efd272f42e41e@ww2io7.h.filess.io:5433/Translationapp_coachunder';

const pool = new Pool({
  connectionString: DATABASE_URL,
});

async function checkDb() {
  const client = await pool.connect();

  try {
    console.log('✅ Connected to database');

    // 1. List all schemas
    console.log('\n1️⃣ Checking schemas...');
    const schemasRes = await client.query("SELECT schema_name FROM information_schema.schemata");
    console.log('Schemas:', schemasRes.rows.map(r => r.schema_name));

    // 2. List tables in translationapp_coachunder
    console.log('\n2️⃣ Checking tables in translationapp_coachunder schema...');
    const tablesRes = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'translationapp_coachunder'
    `);
    console.log('Tables:', tablesRes.rows.map(r => r.table_name));

    // 3. Check translation_sessions table structure
    if (tablesRes.rows.some(r => r.table_name === 'translation_sessions')) {
      console.log('\n3️⃣ Checking translation_sessions structure...');
      const columnsRes = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'translationapp_coachunder' AND table_name = 'translation_sessions'
      `);
      console.log('Columns:', columnsRes.rows);
    } else {
      console.log('\n❌ translation_sessions table not found!');
    }

  } finally {
    client.release();
    await pool.end();
  }
}

checkDb().catch(console.error);
