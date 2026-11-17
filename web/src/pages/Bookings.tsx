import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, rupees, showTime, type Booking } from "../api";

export function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const justBooked = (useLocation().state as { justBooked?: number } | null)?.justBooked;

  useEffect(() => {
    api.bookings().then((r) => setBookings(r.bookings));
  }, []);

  if (!bookings) return null;
  if (!bookings.length)
    return (
      <p className="empty">
        No bookings yet. <Link to="/">Pick a show</Link>
      </p>
    );

  return (
    <section className="bookings">
      <h1>My bookings</h1>
      {bookings.map((b) => (
        <article key={b.id} className={`ticket ${b.id === justBooked ? "fresh" : ""}`}>
          <div className="ticket-main">
            {b.id === justBooked && <p className="booked-note">Booked</p>}
            <h2>{b.showTitle}</h2>
            <p className="muted">{b.venue}</p>
            <p>{showTime(b.startsAt)}</p>
          </div>
          <div className="ticket-stub">
            <p className="stub-seats">{b.seats.map((s) => `${s.row}${s.number}`).join(" ")}</p>
            <p>{rupees(b.totalPaise)}</p>
            <p className="muted">
              {b.status === "confirmed" ? `Booking #${b.id}` : <Link to={`/shows/${b.showId}`}>Held, finish booking</Link>}
            </p>
          </div>
        </article>
      ))}
    </section>
  );
}
