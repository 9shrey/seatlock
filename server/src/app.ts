import cookieParser from "cookie-parser";
import express from "express";
import path from "node:path";
import { authRouter, loadUser } from "./auth.js";
import { bookingsRouter, holdsRouter } from "./bookings.js";
import { errorHandler, HttpError } from "./errors.js";
import { showsRouter } from "./shows.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "10kb" }));
  app.use(cookieParser());
  app.use(loadUser);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/api/auth", authRouter);
  app.use("/api/shows", showsRouter);
  app.use("/api/shows/:showId/holds", holdsRouter);
  app.use("/api/bookings", bookingsRouter);

  app.use("/api", () => {
    throw new HttpError(404, "not_found");
  });
  // In production one container serves both the API and the built React app.
  const staticDir = process.env.STATIC_DIR;
  if (staticDir) {
    app.use(express.static(staticDir, { maxAge: "1h", index: false }));
    app.get("/{*path}", (_req, res) => res.sendFile(path.resolve(staticDir, "index.html")));
  }

  app.use(errorHandler);
  return app;
}
