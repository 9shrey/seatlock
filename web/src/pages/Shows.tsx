import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, rupees, type ShowSummary } from "../api";

export function ShowsPage() {
  const [shows, setShows] = useState<ShowSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api.shows().then((r) => setShows(r.shows), () => setFailed(true));
  }, []);

  if (failed) return <p className="empty">Can't reach the server. Is the API running?</p>;
  if (!shows) return null;
  if (!shows.length) return <p className="empty">No upcoming shows. Run npm run seed in server/ to add some.</p>;

  return (
    <section className="shows">
      <h1>Upcoming shows</h1>
      <ul>
        {shows.map((s) => {
          const d = new Date(s.startsAt);
          return (
            <li key={s.id}>
              <Link to={`/shows/${s.id}`} className="show-row">
                <time dateTime={s.startsAt} className="date">
                  <span className="day">{d.getDate()}</span>
                  <span>{d.toLocaleString("en-IN", { month: "short" })}</span>
                </time>
                <span className="what">
                  <strong>{s.title}</strong>
                  <span className="muted">
                    {s.venue}, {d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
                  </span>
                </span>
                <span className="price">
                  from {rupees(s.fromPaise)}
                  <span className={s.availableSeats < 20 ? "few" : "muted"}>
                    {s.availableSeats ? `${s.availableSeats} seats left` : "Sold out"}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
