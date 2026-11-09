import { attachDatabasePool } from "@vercel/functions";
import { Pool, type QueryResult, type QueryResultRow } from "pg";

const globalForDb = globalThis as typeof globalThis & { posPool?: Pool };

function getPool(): Pool {
  if (globalForDb.posPool) return globalForDb.posPool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
  }
  const maxConnections = Number(process.env.DB_POOL_MAX_SIZE ?? "3");
  if (!Number.isInteger(maxConnections) || maxConnections < 1 || maxConnections > 10) {
    throw new Error("DB_POOL_MAX_SIZE must be an integer from 1 to 10.");
  }

  const pool = new Pool({
    connectionString,
    max: maxConnections,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
    ssl: { rejectUnauthorized: true },
  });
  attachDatabasePool(pool);
  globalForDb.posPool = pool;
  return globalForDb.posPool;
}

function query<R extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[],
): Promise<QueryResult<R>> {
  return getPool().query<R>(text, values);
}

export const db = {
  query,
  connect: () => getPool().connect(),
};
