import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

export const DATABASE_URL = process.env.DATABASE_URL;

export const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL?.includes("neon.tech")
    ? { rejectUnauthorized: false }
    : undefined,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Set search path on every new connection
pool.on('connect', async (client) => {
  await client.query('SET search_path TO translationapp_coachunder');
});

export const db = drizzle(pool, { schema });

export * from "./schema";
