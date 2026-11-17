import { describe, expect, it } from "vitest";
import { expireBooking, firstShow, newUser, pool, useTestServer } from "./helpers.js";

useTestServer();

/** Seats that currently have a live (held or confirmed) booking, with how many such bookings. */
async function liveOwners(seatIds: number[]) {
  const { rows } = await pool.query<{ seat_id: number; owners: number }>(
    `SELECT s.id AS seat_id, count(b.id)::int AS owners
       FROM seats s
       LEFT JOIN bookings b ON b.id = s.booking_id
            AND (b.status = 'confirmed' OR (b.status = 'held' AND b.expires_at > now()))
      WHERE s.id = ANY($1::int[])
      GROUP BY s.id`,
    [seatIds],
  );
  return rows;
}

function tally(statuses: number[]) {
  return statuses.reduce<Record<number, number>>((acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }), {});
}

describe("concurrency", () => {
  it("50 users clicking the same seat at once: exactly one gets it", async () => {
    const { showId, seat } = await firstShow();
    const users = await Promise.all(Array.from({ length: 50 }, () => newUser()));

    const results = await Promise.all(
      users.map((u) => u.post(`/api/shows/${showId}/holds`).send({ seatIds: [seat.D6] })),
    );

    expect(tally(results.map((r) => r.status))).toEqual({ 201: 1, 409: 49 });
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM bookings WHERE status = 'held' AND expires_at > now()",
    );
    expect(rows[0].n).toBe(1);
  });

  it("overlapping multi-seat holds in opposite orders never deadlock or double-book", async () => {
    const { showId, seat } = await firstShow();
    const pairs = [
      [seat.A1, seat.A2],
      [seat.A2, seat.A1],
      [seat.A2, seat.A3],
      [seat.A3, seat.A1],
    ];
    const users = await Promise.all(Array.from({ length: 40 }, () => newUser()));

    const results = await Promise.all(
      users.map((u, i) => u.post(`/api/shows/${showId}/holds`).send({ seatIds: pairs[i % pairs.length] })),
    );

    const statuses = results.map((r) => r.status);
    // Only clean outcomes: a hold, or a "taken" conflict. No 500s, no deadlock retries.
    expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);
    const conflictCodes = new Set(results.filter((r) => r.status === 409).map((r) => r.body.error));
    expect([...conflictCodes]).toEqual(["seats_unavailable"]); // not "conflict_retry" (a deadlock)
    expect(statuses.filter((s) => s === 201).length).toBeGreaterThanOrEqual(1);
    for (const row of await liveOwners([seat.A1!, seat.A2!, seat.A3!])) {
      expect(row.owners).toBeLessThanOrEqual(1);
    }
  });

  it("a lapsed hold being confirmed while someone else grabs the seat: never both", async () => {
    const { showId, seat } = await firstShow();
    for (let round = 0; round < 10; round++) {
      const asha = await newUser();
      const ravi = await newUser();
      const label = `B${round + 1}`;
      const hold = await asha.post(`/api/shows/${showId}/holds`).send({ seatIds: [seat[label]] });
      await expireBooking(hold.body.booking.id);

      const [confirm, steal] = await Promise.all([
        asha.post(`/api/bookings/${hold.body.booking.id}/confirm`),
        ravi.post(`/api/shows/${showId}/holds`).send({ seatIds: [seat[label]] }),
      ]);
      expect(confirm.status).toBe(410);
      expect(steal.status).toBe(201);
      expect((await liveOwners([seat[label]!]))[0]!.owners).toBe(1);
    }
  });

  it("double-clicking confirm creates one confirmed booking, and both clicks succeed", async () => {
    const { showId, seat } = await firstShow();
    const u = await newUser();
    const hold = await u.post(`/api/shows/${showId}/holds`).send({ seatIds: [seat.C1, seat.C2] });
    const id = hold.body.booking.id;

    const clicks = await Promise.all(Array.from({ length: 5 }, () => u.post(`/api/bookings/${id}/confirm`)));

    expect(tally(clicks.map((c) => c.status))).toEqual({ 201: 1, 200: 4 });
    const { rows } = await pool.query("SELECT status FROM bookings WHERE id = $1", [id]);
    expect(rows[0].status).toBe("confirmed");
  });
});
