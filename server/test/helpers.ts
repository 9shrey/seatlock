import type { Server } from "node:http";
import request from "supertest";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db.js";
import { resetSchema } from "../src/migrate.js";
import { seed } from "../src/seed.js";

let server: Server;

/** Fresh schema + seed data before every test; one HTTP server per file. */
export function useTestServer() {
  beforeAll(() => {
    server = createApp().listen(0);
  });
  beforeEach(async () => {
    await resetSchema();
    await seed();
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
    await pool.end();
  });
}

let userCounter = 0;

/** A signed-in client with its own cookie jar. */
export async function newUser() {
  const agent = request.agent(server);
  const email = `user${++userCounter}@test.dev`;
  const res = await agent.post("/api/auth/signup").send({ email, password: "password123" });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return Object.assign(agent, { email });
}

export function anon() {
  return request(server);
}

/** First show's seats, keyed "A1", "A2", ... */
export async function firstShow() {
  const { rows } = await pool.query<{ id: number }>("SELECT id FROM shows ORDER BY id LIMIT 1");
  const showId = rows[0]!.id;
  const seats = await pool.query<{ id: number; label: string }>(
    "SELECT id, row_label || number AS label FROM seats WHERE show_id = $1",
    [showId],
  );
  const seat = Object.fromEntries(seats.rows.map((s) => [s.label, s.id])) as Record<string, number>;
  return { showId, seat };
}

/** Move a booking's expiry into the past, as if the hold timer ran out. */
export async function expireBooking(id: number) {
  await pool.query("UPDATE bookings SET expires_at = now() - interval '1 second' WHERE id = $1", [id]);
}

export { pool };
