import { createApp } from "./app.js";
import { sweepExpiredHolds } from "./bookings.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { applySchema } from "./migrate.js";

await applySchema();
const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`seatlock api listening on :${config.port}`);
});

const sweeper = setInterval(() => {
  sweepExpiredHolds().catch((err) => console.error("sweep failed", err));
}, 30_000);

function shutdown() {
  clearInterval(sweeper);
  server.close(() => pool.end().then(() => process.exit(0)));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
