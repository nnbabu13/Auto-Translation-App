
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

const DATABASE_URL = "postgresql://Translationapp_coachunder:d1102b1d82da238377daa3cce00efd272f42e41e@ww2io7.h.filess.io:5433/Translationapp_coachunder";

async function main() {
    console.log("Connecting to database...");

    const pool = new pg.Pool({
        connectionString: DATABASE_URL,
    });

    const db = drizzle(pool);

    console.log("Database connected successfully!");

    // Test query
    const result = await pool.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
    `);
    console.log("\nCurrent tables:");
    console.log(result.rows);

    await pool.end();
}

main().catch(console.error);
