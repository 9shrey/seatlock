import { Router } from "express";
import { pool, SEAT_IS_FREE } from "./db.js";
import { HttpError } from "./errors.js";

export const showsRouter = Router();

showsRouter.get("/", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT sh.id, sh.title, sh.venue, sh.starts_at AS "startsAt",
            count(s.id)::int AS "totalSeats",
            (count(s.id) FILTER (WHERE ${SEAT_IS_FREE}))::int AS "availableSeats",
            min(s.price_paise)::int AS "fromPaise"
       FROM shows sh
       LEFT JOIN seats s ON s.show_id = sh.id
       LEFT JOIN bookings b ON b.id = s.booking_id
      WHERE sh.starts_at > now()
      GROUP BY sh.id
      ORDER BY sh.starts_at`,
  );
  res.json({ shows: rows });
});

showsRouter.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, "show_not_found");
  const show = await pool.query(
    `SELECT id, title, venue, starts_at AS "startsAt" FROM shows WHERE id = $1`,
    [id],
  );
  if (!show.rowCount) throw new HttpError(404, "show_not_found");

  const userId = req.user?.id ?? null;
  // 'mine' = held by the signed-in user. Everyone else only learns that a seat is taken.
  const seats = await pool.query(
    `SELECT s.id, s.row_label AS row, s.number, s.price_paise AS "pricePaise",
            CASE WHEN ${SEAT_IS_FREE} THEN 'available'
                 WHEN b.status = 'confirmed' THEN 'booked'
                 WHEN b.user_id = $2::int THEN 'mine'
                 ELSE 'held' END AS state
       FROM seats s
       LEFT JOIN bookings b ON b.id = s.booking_id
      WHERE s.show_id = $1
      ORDER BY s.row_label, s.number`,
    [id, userId],
  );

  let myHold = null;
  if (userId) {
    const hold = await pool.query(
      `SELECT id, expires_at AS "expiresAt", total_paise AS "totalPaise"
         FROM bookings
        WHERE user_id = $1 AND show_id = $2 AND status = 'held' AND expires_at > now()`,
      [userId, id],
    );
    myHold = hold.rows[0] ?? null;
  }

  res.json({ show: show.rows[0], seats: seats.rows, myHold, serverTime: new Date() });
});
