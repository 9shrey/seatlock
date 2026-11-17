import { describe, expect, it } from "vitest";
import { anon, expireBooking, firstShow, newUser, pool, useTestServer } from "./helpers.js";

useTestServer();

async function seatStates(agent: { get: (u: string) => any }, showId: number) {
  const res = await agent.get(`/api/shows/${showId}`);
  return Object.fromEntries(
    (res.body.seats as { row: string; number: number; state: string }[]).map((s) => [
      `${s.row}${s.number}`,
      s.state,
    ]),
  );
}

describe("shows", () => {
  it("lists upcoming shows with availability and starting price", async () => {
    const res = await anon().get("/api/shows");
    expect(res.status).toBe(200);
    expect(res.body.shows).toHaveLength(3);
    expect(res.body.shows[0]).toMatchObject({ totalSeats: 96, availableSeats: 96, fromPaise: 15000 });
  });

  it("returns 404 for an unknown show", async () => {
    expect((await anon().get("/api/shows/9999")).status).toBe(404);
    expect((await anon().get("/api/shows/abc")).status).toBe(404);
  });
});

describe("holding seats", () => {
  it("requires sign-in", async () => {
    const { showId, seat } = await firstShow();
    const res = await anon().post(`/api/shows/${showId}/holds`).send({ seatIds: [seat.A1] });
    expect(res.status).toBe(401);
  });

  it("holds seats, totals the price, and shows them as mine to me and held to others", async () => {
    const { showId, seat } = await firstShow();
    const asha = await newUser();
    const ravi = await newUser();

    const res = await asha.post(`/api/shows/${showId}/holds`).send({ seatIds: [seat.A1, seat.H12] });
    expect(res.status).toBe(201);
    expect(res.body.booking).toMatchObject({ status: "held", totalPaise: 15000 + 35000 });
    expect(res.body.booking.seats).toHaveLength(2);

    expect(await seatStates(asha, showId)).toMatchObject({ A1: "mine", H12: "mine", A2: "available" });
    expect(await seatStates(ravi, showId)).toMatchObject({ A1: "held", H12: "held" });
    expect(await seatStates(anon(), showId)).toMatchObject({ A1: "held" });
  });

  it("refuses a seat someone else holds, and names it", async () => {
    const { showId, seat } = await firstShow();
    const asha = await newUser();
    const ravi = await newUser();
    await asha.post(`/api/shows/${showId}/holds`).send({ seatIds: [seat.C5] }).expect(201);

    const res = await ravi.post(`/api/shows/${showId}/holds`).send({ seatIds: [seat.C4, seat.C5] });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "seats_unavailable", details: { seatIds: [seat.C5] } });
    // All or nothing: C4 was not taken either.
    expect((await seatStates(ravi, showId)).C4).toBe("available");
  });

  it("validates the selection", async () => {
    const { showId, seat } = await firstShow();
    const u = await newUser();
    const post = (seatIds: unknown) => u.post(`/api/shows/${showId}/holds`).send({ seatIds });
    expect((await post([])).status).toBe(400);
    expect((await post([seat.A1, seat.A1])).status).toBe(400);
    expect((await post(Object.values(seat).slice(0, 9))).status).toBe(400);
    expect((await post(["1"])).status).toBe(400);
  });

  it("rejects a seat that belongs to a different show", async () => {
    const { showId } = await firstShow();
    const other = await pool.query("SELECT id FROM seats WHERE show_id <> $1 LIMIT 1", [showId]);
    const u = await newUser();
    const res = await u.post(`/api/shows/${showId}/holds`).send({ seatIds: [other.rows[0].id] });
    expect(res.status).toBe(404);
  });

  it("replaces your previous hold when you pick again", async () => {
    const { showId, seat } = await firstShow();
    const u = await newUser();
    await u.post(`/api/shows/${showId}/holds`).send({ seatIds: [seat.A1, seat.A2] }).expect(201);
    await u.post(`/api/shows/${showId}/holds`).send({ seatIds: [seat.A2, seat.A3] }).expect(201);
    expect(await seatStates(u, showId)).toMatchObject({ A1: "available", A2: "mine", A3: "mine" });
  });

  it("frees seats once a hold runs out, with no background job needed", async () => {
    const { showId, seat } = await firstShow();
    const asha = await newUser();
    const ravi = await newUser();
    const hold = await asha.post(`/api/shows/${showId}/holds`).send({ seatIds: [seat.D1] });
    await expireBooking(hold.body.booking.id);

    expect((await seatStates(ravi, showId)).D1).toBe("available");
    await ravi.post(`/api/shows/${showId}/holds`).send({ seatIds: [seat.D1] }).expect(201);
  });

  it("refuses holds once the show has started", async () => {
    const { showId, seat } = await firstShow();
    await pool.query("UPDATE shows SET starts_at = now() - interval '1 minute' WHERE id = $1", [showId]);
    const u = await newUser();
    const res = await u.post(`/api/shows/${showId}/holds`).send({ seatIds: [seat.A1] });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("show_already_started");
  });
});

describe("confirming and cancelling", () => {
  it("confirms a hold, and confirming again returns the same booking", async () => {
    const { showId, seat } = await firstShow();
    const u = await newUser();
    const hold = await u.post(`/api/shows/${showId}/holds`).send({ seatIds: [seat.E7] });
    const id = hold.body.booking.id;

    const first = await u.post(`/api/bookings/${id}/confirm`);
    expect(first.status).toBe(201);
    expect(first.body.booking.status).toBe("confirmed");

    const again = await u.post(`/api/bookings/${id}/confirm`);
    expect(again.status).toBe(200);
    expect(again.body.booking.id).toBe(id);

    const other = await newUser();
    expect((await seatStates(other, showId)).E7).toBe("booked");
    const mine = await u.get("/api/bookings");
    expect(mine.body.bookings.map((b: { id: number }) => b.id)).toEqual([id]);
  });

  it("refuses to confirm an expired hold", async () => {
    const { showId, seat } = await firstShow();
    const u = await newUser();
    const hold = await u.post(`/api/shows/${showId}/holds`).send({ seatIds: [seat.E8] });
    await expireBooking(hold.body.booking.id);
    const res = await u.post(`/api/bookings/${hold.body.booking.id}/confirm`);
    expect(res.status).toBe(410);
  });

  it("refuses to confirm if someone took a seat after the hold lapsed", async () => {
    const { showId, seat } = await firstShow();
    const asha = await newUser();
    const ravi = await newUser();
    const hold = await asha.post(`/api/shows/${showId}/holds`).send({ seatIds: [seat.F1, seat.F2] });
    await expireBooking(hold.body.booking.id);
    await ravi.post(`/api/shows/${showId}/holds`).send({ seatIds: [seat.F2] }).expect(201);
    // Even if Asha's hold were somehow extended, one of her seats is gone.
    await pool.query("UPDATE bookings SET expires_at = now() + interval '5 minutes' WHERE id = $1", [
      hold.body.booking.id,
    ]);
    expect((await asha.post(`/api/bookings/${hold.body.booking.id}/confirm`)).status).toBe(410);
  });

  it("does not let you see or confirm someone else's booking", async () => {
    const { showId, seat } = await firstShow();
    const asha = await newUser();
    const ravi = await newUser();
    const hold = await asha.post(`/api/shows/${showId}/holds`).send({ seatIds: [seat.G3] });
    expect((await ravi.post(`/api/bookings/${hold.body.booking.id}/confirm`)).status).toBe(404);
    expect((await ravi.delete(`/api/bookings/${hold.body.booking.id}`)).status).toBe(404);
  });

  it("releases a hold on cancel, but will not cancel a confirmed booking", async () => {
    const { showId, seat } = await firstShow();
    const u = await newUser();
    const hold = await u.post(`/api/shows/${showId}/holds`).send({ seatIds: [seat.B2] });
    await u.delete(`/api/bookings/${hold.body.booking.id}`).expect(204);
    expect((await seatStates(u, showId)).B2).toBe("available");

    const hold2 = await u.post(`/api/shows/${showId}/holds`).send({ seatIds: [seat.B3] });
    await u.post(`/api/bookings/${hold2.body.booking.id}/confirm`).expect(201);
    expect((await u.delete(`/api/bookings/${hold2.body.booking.id}`)).status).toBe(409);
  });
});
