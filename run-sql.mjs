
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';
const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATABASE_URL = 'postgresql://Translationapp_coachunder:d1102b1d82da238377daa3cce00efd272f42e41e@ww2io7.h.filess.io:5433/Translationapp_coachunder';
const SQL_PATH = join(__dirname, 'create-tables.sql');

async function main() {
  const sql = readFileSync(SQL_PATH, 'utf8');
  const pool = new Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();

  try {
    // Split SQL into separate statements (simplified)
    const statements = sql.split(';').map(s => s.trim()).filter(Boolean);

    for (const statement of statements) {
      await client.query(statement);
    }

    console.log('✅ All tables created successfully!');

  } catch (err) {
    console.error('❌ Error:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
