import { getDatabase } from "@netlify/database";

/**
 * The one shape the data layer needs. Netlify's pool (deployed) and a plain `pg` pool (tests)
 * both satisfy it, so every query function is testable against a real Postgres.
 */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface TxDb extends Db {
  /** Runs `fn` inside BEGIN/COMMIT on one connection; rolls back if it throws. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

type PoolLike = {
  query: Db["query"];
  connect(): Promise<{ query: Db["query"]; release(): void }>;
};

export function wrapPool(pool: PoolLike): TxDb {
  return {
    query: (text, params) => pool.query(text, params),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({ query: (text, params) => client.query(text, params) });
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

let cached: TxDb | null = null;

/** The deployed database. Netlify picks the right branch: production, or a deploy preview's copy. */
export function db(): TxDb {
  cached ??= wrapPool(getDatabase().pool as unknown as PoolLike);
  return cached;
}
