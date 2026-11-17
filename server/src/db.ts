import pg from "pg";
import { config } from "./config.js";

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });

/** Run `fn` inside one transaction on one connection; roll back if it throws. */
export async function withTx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** SQL fragment: true when the seat aliased `s` can be taken (booking alias `b`, LEFT JOINed). */
export const SEAT_IS_FREE = `(
  s.booking_id IS NULL
  OR b.status IN ('expired', 'cancelled')
  OR (b.status = 'held' AND b.expires_at <= now())
)`;
