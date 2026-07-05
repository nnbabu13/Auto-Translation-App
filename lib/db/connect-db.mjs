
import pg from 'pg';
const { Pool } = pg;

const DATABASE_URL = "postgresql://Translationapp_coachunder:d1102b1d82da238377daa3cce00efd272f42e41e@ww2io7.h.filess.io:5433/Translationapp_coachunder";

async function testConnection() {
    console.log("Attempting to connect to database...");
    const pool = new Pool({ connectionString: DATABASE_URL });
    try {
        const client = await pool.connect();
        console.log("✅ Connected successfully!");
        const res = await client.query('SELECT current_database()');
        console.log("Current database:", res.rows[0].current_database);
        client.release();
    } catch (err) {
        console.error("❌ Connection error:", err);
    } finally {
        await pool.end();
    }
}

testConnection();
