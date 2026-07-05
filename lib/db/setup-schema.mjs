
import pg from 'pg';
const { Pool } = pg;

const DATABASE_URL = "postgresql://Translationapp_coachunder:d1102b1d82da238377daa3cce00efd272f42e41e@ww2io7.h.filess.io:5433/Translationapp_coachunder";

async function setupSchema() {
    const pool = new Pool({ connectionString: DATABASE_URL });
    try {
        const client = await pool.connect();
        await client.query('CREATE SCHEMA IF NOT EXISTS public');
        await client.query('SET search_path TO public');
        console.log("✅ Public schema set up");
        client.release();
    } catch (err) {
        console.error("❌ Error:", err);
    } finally {
        await pool.end();
    }
}

setupSchema();
