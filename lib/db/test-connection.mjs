
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./src/schema";

const { Pool } = pg;

const DATABASE_URL = "postgresql://Translationapp_coachunder:d1102b1d82da238377daa3cce00efd272f42e41e@ww2io7.h.filess.io:5433/Translationapp_coachunder";

async function test() {
    console.log("Testing database connection...");
    
    const pool = new Pool({ connectionString: DATABASE_URL });
    pool.on('connect', async (client) => {
        await client.query('SET search_path TO translationapp_coachunder');
    });
    
    const db = drizzle(pool, { schema });
    
    // Try inserting a test user
    console.log("Inserting test user...");
    const newUser = await db.insert(schema.usersTable).values({
        email: "test@example.com",
        firstName: "Test",
        lastName: "User"
    }).returning();
    console.log("Test user inserted:", newUser[0]);
    
    // Try inserting a test session
    console.log("\nInserting test session...");
    const newSession = await db.insert(schema.translationSessionsTable).values({
        userId: newUser[0].id,
        name: "Test Session",
        targetLanguage: "English"
    }).returning();
    console.log("Test session inserted:", newSession[0]);
    
    // Clean up our test data
    console.log("\nCleaning up test data...");
    await db.delete(schema.translationSessionsTable).where(schema.translationSessionsTable.id.eq(newSession[0].id));
    await db.delete(schema.usersTable).where(schema.usersTable.id.eq(newUser[0].id));
    
    console.log("\n✅ Database is connected and working correctly!");
    
    await pool.end();
}

test().catch(console.error);
