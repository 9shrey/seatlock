import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError, rupees, showTime, type Hold, type Seat, type ShowSummary } from "../api";
import { useAuth } from "../App";

const MAX_SEATS = 8;
const POLL_MS = 3000;

function formatClock(s: number) {
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return (
    <>
      {mm}
      <span className="colon">:</span>
      {ss}
    </>
  );
}

function useCountdown(expiresAt: string | null, clockOffset: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [expiresAt]);
  if (!expiresAt) return null;
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - (now + clockOffset)) / 1000));
}

export function ShowPage() {
  const id = Number(useParams().id);
  const { user } = useAuth();
  const navigate = useNavigate();
  const [show, setShow] = useState<ShowSummary | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [hold, setHold] = useState<Hold | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const clockOffset = useRef(0);

  const load = useCallback(async () => {
    try {
      const r = await api.show(id);
      clockOffset.current = new Date(r.serverTime).getTime() - Date.now();
      setShow(r.show);
      setSeats(r.seats);
      setHold(r.myHold);
      // Drop any picked seat that someone else just took.
      setPicked((p) => p.filter((sid) => r.seats.find((s) => s.id === sid)?.state === "available"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setNotFound(true);
    }
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const secondsLeft = useCountdown(hold?.expiresAt ?? null, clockOffset.current);
  useEffect(() => {
    if (secondsLeft === 0) {
      setMessage("Your hold ran out and the seats were released. Pick again.");
      load();
    }
  }, [secondsLeft, load]);

  const rows = useMemo(() => {
    const byRow = new Map<string, Seat[]>();
    for (const s of seats) byRow.set(s.row, [...(byRow.get(s.row) ?? []), s]);
    return [...byRow.entries()];
  }, [seats]);

  const pickedSeats = seats.filter((s) => picked.includes(s.id));
  const heldSeats = seats.filter((s) => s.state === "mine");
  const pickedTotal = pickedSeats.reduce((sum, s) => sum + s.pricePaise, 0);

  function toggle(seat: Seat) {
    setMessage(null);
    if (picked.includes(seat.id)) return setPicked(picked.filter((x) => x !== seat.id));
    if (picked.length >= MAX_SEATS) return setMessage(`You can pick up to ${MAX_SEATS} seats at a time.`);
    setPicked([...picked, seat.id]);
  }

  async function holdSeats() {
    if (!user) return navigate("/login", { state: { from: `/shows/${id}` } });
    setBusy(true);
    setMessage(null);
    try {
      await api.hold(id, picked);
      setPicked([]);
    } catch (err) {
      if (err instanceof ApiError && err.code === "seats_unavailable") {
        const gone = seats.filter((s) => err.details?.seatIds?.includes(s.id)).map((s) => `${s.row}${s.number}`);
        setMessage(`Someone just took ${gone.join(", ")}. The rest of your picks were not held.`);
      } else {
        setMessage("Couldn't hold those seats. Try again.");
      }
    } finally {
      setBusy(false);
      load();
    }
  }

  async function confirm() {
    if (!hold) return;
    setBusy(true);
    try {
      await api.confirm(hold.id);
      navigate("/bookings", { state: { justBooked: hold.id } });
    } catch (err) {
      setMessage(
        err instanceof ApiError && err.status === 410
          ? "Your hold ran out before you confirmed. Pick again."
          : "Couldn't confirm. Try again.",
      );
      load();
    } finally {
      setBusy(false);
    }
  }

  async function release() {
    if (!hold) return;
    await api.release(hold.id);
    load();
  }

  if (notFound) return <p className="empty">This show doesn't exist. <Link to="/">See all shows</Link></p>;
  if (!show) return null;

  return (
    <section className="show">
      <header className="show-head">
        <Link to="/" className="muted">All shows</Link>
        <h1>{show.title}</h1>
        <p className="muted">{show.venue}, {showTime(show.startsAt)}</p>
      </header>

      <div className="show-body">
        <div className="hall" aria-label="Seat map">
          <div className="screen" aria-hidden="true" />
          <p className="screen-label">Screen this way</p>
          <div className="rows">
            {rows.map(([row, rowSeats]) => (
              <div className="row" key={row}>
                <span className="row-label">{row}</span>
                {rowSeats.map((s) => {
                  const isPicked = picked.includes(s.id);
                  const state = isPicked ? "picked" : s.state;
                  return (
                    <button
                      key={s.id}
                      className={`seat ${state}`}
                      disabled={s.state !== "available" || !!hold}
                      onClick={() => toggle(s)}
                      aria-pressed={isPicked}
                      aria-label={`Seat ${s.row}${s.number}, ${rupees(s.pricePaise)}, ${state}`}
                      title={`${s.row}${s.number}  ${rupees(s.pricePaise)}`}
                    >
                      {s.number}
                    </button>
                  );
                })}
                <span className="row-label">{row}</span>
              </div>
            ))}
          </div>
          <ul className="legend">
            <li><span className="seat available" /> Free</li>
            <li><span className="seat picked" /> Your pick</li>
            <li><span className="seat held" /> Someone's holding it</li>
            <li><span className="seat booked" /> Sold</li>
          </ul>
        </div>

        <aside className="panel" aria-live="polite">
          {hold ? (
            <>
              <h2>Your seats are held</h2>
              <p className="timer" data-low={secondsLeft !== null && secondsLeft < 60}>
                {formatClock(secondsLeft ?? 0)}
              </p>
              <p className="muted">Nobody else can take them until the timer runs out.</p>
              <p className="seat-list">{heldSeats.map((s) => `${s.row}${s.number}`).join(", ")}</p>
              <p className="total">{rupees(hold.totalPaise)}</p>
              <button className="primary" onClick={confirm} disabled={busy}>
                Pay {rupees(hold.totalPaise)} and book
              </button>
              <button className="link" onClick={release}>Release these seats</button>
              <p className="fine">Demo: no real payment is taken.</p>
            </>
          ) : picked.length ? (
            <>
              <h2>{picked.length} {picked.length === 1 ? "seat" : "seats"} picked</h2>
              <p className="seat-list">{pickedSeats.map((s) => `${s.row}${s.number}`).join(", ")}</p>
              <p className="total">{rupees(pickedTotal)}</p>
              <button className="primary" onClick={holdSeats} disabled={busy}>
                {user ? "Hold for 5 minutes" : "Sign in to hold seats"}
              </button>
            </>
          ) : (
            <>
              <h2>Pick your seats</h2>
              <p className="muted">Front rows {rupees(15000)}, middle {rupees(25000)}, back {rupees(35000)}.</p>
            </>
          )}
          {message && <p className="error" role="alert">{message}</p>}
        </aside>
      </div>
    </section>
  );
}
