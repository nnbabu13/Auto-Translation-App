
import pg from 'pg';
const { Pool } = pg;

const DATABASE_URL = "postgresql://Translationapp_coachunder:d1102b1d82da238377daa3cce00efd272f42e41e@ww2io7.h.filess.io:5433/Translationapp_coachunder";

async function createTables() {
    console.log("Connecting to database...");
    const pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();
    
    try {
        await client.query('SET search_path TO public');
        await client.query('BEGIN');
        console.log("Creating tables...");
        
        // Replit Auth tables
        await client.query(`
            CREATE TABLE IF NOT EXISTS "public"."sessions" (
                "sid" varchar NOT NULL COLLATE "default",
                "sess" json NOT NULL,
                "expire" timestamp(6) NOT NULL
            ) WITH (OIDS=FALSE);
            ALTER TABLE "public"."sessions" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
            CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "public"."sessions" ("expire");
        `);
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS "public"."users" (
                "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
                "email" varchar UNIQUE,
                "first_name" varchar,
                "last_name" varchar,
                "profile_image_url" varchar,
                "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
                "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
            );
        `);
        
        // Translation tables
        await client.query(`
            CREATE TABLE IF NOT EXISTS "public"."translation_sessions" (
                "id" serial PRIMARY KEY NOT NULL,
                "user_id" varchar NOT NULL,
                "name" text NOT NULL,
                "target_language" text NOT NULL,
                "created_at" timestamp DEFAULT now() NOT NULL
            );
        `);
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS "public"."translation_logs" (
                "id" serial PRIMARY KEY NOT NULL,
                "session_id" integer NOT NULL,
                "original_text" text NOT NULL,
                "translated_text" text NOT NULL,
                "source_language" text NOT NULL,
                "target_language" text NOT NULL,
                "timestamp" timestamp DEFAULT now() NOT NULL
            );
        `);
        
        await client.query(`
            DO $$ BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.table_constraints 
                    WHERE constraint_name = 'translation_sessions_user_id_fk'
                ) THEN
                    ALTER TABLE "public"."translation_sessions"
                    ADD CONSTRAINT "translation_sessions_user_id_fk"
                    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;
                END IF;
            END $$;
        `);
        
        await client.query(`
            DO $$ BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.table_constraints 
                    WHERE constraint_name = 'translation_logs_session_id_fk'
                ) THEN
                    ALTER TABLE "public"."translation_logs"
                    ADD CONSTRAINT "translation_logs_session_id_fk"
                    FOREIGN KEY ("session_id") REFERENCES "public"."translation_sessions"("id") ON DELETE CASCADE;
                END IF;
            END $$;
        `);
        
        await client.query('COMMIT');
        console.log("✅ All tables created successfully!");
        
        const tablesResult = await client.query(`
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);
        console.log("\nCurrent tables in database:");
        tablesResult.rows.forEach(row => console.log(`  - ${row.table_name}`));
        
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ Error creating tables:", err);
    } finally {
        client.release();
        await pool.end();
    }
}

createTables();
