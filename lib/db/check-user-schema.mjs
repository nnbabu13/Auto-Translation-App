
import pg from 'pg';
const { Pool } = pg;

const DATABASE_URL = "postgresql://Translationapp_coachunder:d1102b1d82da238377daa3cce00efd272f42e41e@ww2io7.h.filess.io:5433/Translationapp_coachunder";

async function check() {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();
    try {
        // Check current user
        const userRes = await client.query('SELECT current_user, session_user');
        console.log("Current user:", userRes.rows);
        
        // Check schemas
        const schemaRes = await client.query("SELECT schema_name FROM information_schema.schemata");
        console.log("\nAvailable schemas:");
        schemaRes.rows.forEach(row => console.log(`  - ${row.schema_name}`));
        
        // Check schema permissions
        const permsRes = await client.query(`
            SELECT 
                schemaname, 
                tableowner, 
                string_agg(privilege_type, ', ') AS privileges
            FROM pg_tables
            GROUP BY schemaname, tableowner
        `);
        console.log("\nSchema privileges:");
        permsRes.rows.forEach(row => console.log(`  ${row.schemaname}: ${row.tableowner} has ${row.privileges}`));
        
    } catch (err) {
        console.error("Error:", err);
    } finally {
        client.release();
        await pool.end();
    }
}

check();
