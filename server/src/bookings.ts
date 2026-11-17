import { Router } from "express";
import type pg from "pg";
import { z } from "zod";
import { currentUser, requireUser } from "./auth.js";
import { config } from "./config.js";
import { pool, SEAT_IS_FREE, withTx } from "./db.js";
import { HttpError } from "./errors.js";

/*
 * Concurrency rules (the whole point of this project):
 *
 * 1. Any transaction that changes which booking owns a seat first locks those seat rows with
 *    SELECT ... FOR UPDATE, always ORDER BY id. Two requests for overlapping seats therefore queue
 *    on the same row locks, and because every transaction takes its locks in the same order, two
 *    requests for {A, B} and {B, A} cannot deadlock.
 * 2. Availability is checked in a NEW statement after the locks are held. Under READ COMMITTED each
 *    statement sees everything committed before it started, so the loser of a race sees the winner's
 *    booking and gets 409 instead of overwriting it.
 * 3. Seat locks are always taken before booking locks, in hold, confirm and cancel alike.
 */

type Db = pg.Pool | pg.PoolClient;

type BookingRow = {
  id: number;
  user_id: number;
  show_id: number;
  status: "held" | "confirmed" | "expired" | "cancelled";
  expires_at: Date;
  total_paise: number;
  seat_count: number;
  live: boolean; // expires_at > now(), judged by the database clock
};

export async function bookingView(db: Db, id: number) {
  const { rows } = await db.query(
    `SELECT b.id, b.show_id, b.expires_at, b.total_paise, b.created_at, b.confirmed_at,
            CASE WHEN b.status = 'held' AND b.expires_at <= now() THEN 'expired' ELSE b.status END AS status,
            sh.title AS show_title, sh.venue, sh.starts_at,
            COALESCE(json_agg(json_build_object('id', s.id, 'row', s.row_label, 'number', s.number)
                     ORDER BY s.row_label, s.number) FILTER (WHERE s.id IS NOT NULL), '[]') AS seats
       FROM bookings b
       JOIN shows sh ON sh.id = b.show_id
       LEFT JOIN seats s ON s.booking_id = b.id
      WHERE b.id = $1
      GROUP BY b.id, sh.id`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    showId: r.show_id,
    showTitle: r.show_title,
    venue: r.venue,
    startsAt: r.starts_at,
    status: r.status as string,
    expiresAt: r.expires_at,
    confirmedAt: r.confirmed_at,
    totalPaise: r.total_paise,
    seats: r.seats as { id: number; row: string; number: number }[],
  };
}

/** Lock the given seats in id order. Returns the ids actually locked. */
async function lockSeats(client: pg.PoolClient, where: string, params: unknown[]) {
  const { rows } = await client.query<{ id: number }>(
    `SELECT id FROM seats WHERE ${where} ORDER BY id FOR UPDATE`,
    params,
  );
  return rows.map((r) => r.id);
}

const holdBody = z.object({
  seatIds: z
    .array(z.number().int().positive())
    .min(1)
    .max(config.maxSeatsPerBooking)
    .refine((ids) => new Set(ids).size === ids.length, "duplicate seat ids"),
});

export const holdsRouter = Router({ mergeParams: true });

// POST /api/shows/:showId/holds  { seatIds: number[] }
holdsRouter.post("/", requireUser, async (req, res) => {
  const user = currentUser(req);
  const showId = Number((req.params as Record<string, string>).showId);
  if (!Number.isInteger(showId) || showId <= 0) throw new HttpError(404, "show_not_found");
  const parsed = holdBody.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "invalid_seat_selection", parsed.error.issues);
  const seatIds = parsed.data.seatIds;

  const bookingId = await withTx(async (c) => {
    const show = await c.query("SELECT starts_at <= now() AS started FROM shows WHERE id = $1", [showId]);
    if (!show.rowCount) throw new HttpError(404, "show_not_found");
    if (show.rows[0].started) throw new HttpError(409, "show_already_started");

    // Rule 1: lock first.
    const locked = await lockSeats(c, "show_id = $1 AND id = ANY($2::int[])", [showId, seatIds]);
    if (locked.length !== seatIds.length) throw new HttpError(404, "seat_not_found");

    // A user has at most one live hold per show: picking again replaces the old selection.
    await c.query(
      `UPDATE bookings SET status = 'cancelled'
        WHERE user_id = $1 AND show_id = $2 AND status = 'held'`,
      [user.id, showId],
    );

    // Rule 2: check availability in a fresh statement, after the locks are ours.
    const taken = await c.query<{ id: number }>(
      `SELECT s.id FROM seats s LEFT JOIN bookings b ON b.id = s.booking_id
        WHERE s.id = ANY($1::int[]) AND NOT ${SEAT_IS_FREE}
        ORDER BY s.id`,
      [seatIds],
    );
    if (taken.rowCount) {
      throw new HttpError(409, "seats_unavailable", { seatIds: taken.rows.map((r) => r.id) });
    }

    const booking = await c.query<{ id: number }>(
      `INSERT INTO bookings (user_id, show_id, status, expires_at, seat_count, total_paise)
       SELECT $1, $2, 'held', now() + make_interval(secs => $3), count(*), sum(price_paise)
         FROM seats WHERE id = ANY($4::int[])
       RETURNING id`,
      [user.id, showId, config.holdSeconds, seatIds],
    );
    const id = booking.rows[0]!.id;
    await c.query("UPDATE seats SET booking_id = $1 WHERE id = ANY($2::int[])", [id, seatIds]);
    return id;
  });

  res.status(201).json({ booking: await bookingView(pool, bookingId) });
});

export const bookingsRouter = Router();
bookingsRouter.use(requireUser);

bookingsRouter.get("/", async (req, res) => {
  const user = currentUser(req);
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM bookings
      WHERE user_id = $1 AND status IN ('held', 'confirmed')
      ORDER BY created_at DESC LIMIT 50`,
    [user.id],
  );
  const bookings = await Promise.all(rows.map((r) => bookingView(pool, r.id)));
  res.json({ bookings: bookings.filter((b) => b && b.status !== "expired") });
});

async function ownBooking(c: pg.PoolClient, id: number, userId: number) {
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, "booking_not_found");
  const { rowCount } = await c.query("SELECT 1 FROM bookings WHERE id = $1 AND user_id = $2", [
    id,
    userId,
  ]);
  if (!rowCount) throw new HttpError(404, "booking_not_found");
}

/**
 * Confirm a hold (this is where a real app would capture payment). Idempotent: confirming an
 * already-confirmed booking returns it again with 200, so a double-clicked button or a retried
 * request never errors or double-charges.
 */
bookingsRouter.post("/:id/confirm", async (req, res) => {
  const user = currentUser(req);
  const id = Number(req.params.id);
  const outcome = await withTx(async (c) => {
    await ownBooking(c, id, user.id);
    // Rule 3: seats first, then the booking row.
    const seatIds = await lockSeats(c, "booking_id = $1", [id]);
    const { rows } = await c.query<BookingRow>(
      "SELECT *, expires_at > now() AS live FROM bookings WHERE id = $1 FOR UPDATE",
      [id],
    );
    const b = rows[0]!;
    if (b.status === "confirmed") return "already";
    // If another user took a seat after this hold ran out, seatIds is now short.
    const stillValid =
      b.status === "held" && b.live && seatIds.length === b.seat_count;
    if (!stillValid) throw new HttpError(410, "hold_expired");
    await c.query(
      "UPDATE bookings SET status = 'confirmed', confirmed_at = now() WHERE id = $1",
      [id],
    );
    return "confirmed";
  });
  res.status(outcome === "confirmed" ? 201 : 200).json({ booking: await bookingView(pool, id) });
});

/** Release a hold early. Idempotent; confirmed bookings cannot be released here. */
bookingsRouter.delete("/:id", async (req, res) => {
  const user = currentUser(req);
  const id = Number(req.params.id);
  await withTx(async (c) => {
    await ownBooking(c, id, user.id);
    await lockSeats(c, "booking_id = $1", [id]);
    const { rows } = await c.query<BookingRow>("SELECT * FROM bookings WHERE id = $1 FOR UPDATE", [id]);
    if (rows[0]!.status === "confirmed") throw new HttpError(409, "booking_already_confirmed");
    await c.query(
      "UPDATE bookings SET status = 'cancelled' WHERE id = $1 AND status = 'held'",
      [id],
    );
  });
  res.status(204).end();
});

/** Marks lapsed holds as expired. Only cosmetic: availability never depends on it. */
export async function sweepExpiredHolds() {
  const { rowCount } = await pool.query(
    "UPDATE bookings SET status = 'expired' WHERE status = 'held' AND expires_at <= now()",
  );
  return rowCount ?? 0;
}
