import bcrypt from "bcryptjs";
import { pool } from "./db.js";
import { resetSchema } from "./migrate.js";

const ROWS = "ABCDEFGH".split("");
const SEATS_PER_ROW = 12;

/** Front rows are cheapest, back rows (better view of the screen) cost more. In paise. */
function priceFor(rowIndex: number) {
  if (rowIndex < 3) return 15000;
  if (rowIndex < 6) return 25000;
  return 35000;
}

export async function seed() {
  const shows = [
    ["Interstellar (re-release)", "PVR Orion, Bengaluru", 2, "19:30"],
    ["Kantara: Chapter 1", "INOX Garuda, Bengaluru", 3, "21:15"],
    ["Stand-up: Late Night Set", "Bangalore Comedy Club", 5, "22:00"],
  ] as const;
  for (const [title, venue, days, time] of shows) {
    // Evening showtimes in Bengaluru, a few days from today.
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO shows (title, venue, starts_at)
       VALUES ($1, $2, ((now() AT TIME ZONE 'Asia/Kolkata')::date + $3::int + $4::time) AT TIME ZONE 'Asia/Kolkata')
       RETURNING id`,
      [title, venue, days, time],
    );
    const showId = rows[0]!.id;
    const values: unknown[] = [];
    const tuples: string[] = [];
    ROWS.forEach((row, ri) => {
      for (let n = 1; n <= SEATS_PER_ROW; n++) {
        const i = values.length;
        tuples.push(`($${i + 1}, $${i + 2}, $${i + 3}, $${i + 4})`);
        values.push(showId, row, n, priceFor(ri));
      }
    });
    await pool.query(
      `INSERT INTO seats (show_id, row_label, number, price_paise) VALUES ${tuples.join(", ")}`,
      values,
    );
  }
}

/** Local demo login, so the app can be tried without signing up. Never used in production. */
export const DEMO_USER = { email: "demo@seatlock.dev", password: "seatlock-demo" };

if (import.meta.url === `file://${process.argv[1]}`) {
  await resetSchema();
  await seed();
  await pool.query("INSERT INTO users (email, password_hash) VALUES ($1, $2)", [
    DEMO_USER.email,
    await bcrypt.hash(DEMO_USER.password, 10),
  ]);
  console.log(`seeded 3 shows x 96 seats; demo login ${DEMO_USER.email}`);
  await pool.end();
}
