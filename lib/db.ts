import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "@/db/schema";

type Database = ReturnType<typeof createDatabase>;

let database: Database | undefined;

function createDatabase(connectionString: string) {
  const sql = neon(connectionString);
  return drizzle(sql, { schema });
}

export function getDb(): Database {
  if (database) {
    return database;
  }

  const connectionString = process.env.DATABASE_CONNECTION_STRING?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_CONNECTION_STRING is not configured.");
  }

  database = createDatabase(connectionString);
  return database;
}
