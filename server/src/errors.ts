import type { ErrorRequestHandler } from "express";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details?: unknown,
  ) {
    super(code);
  }
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.code, details: err.details });
    return;
  }
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: "invalid_json" });
    return;
  }
  // Postgres deadlock / serialization failure. Lock ordering should prevent these; if one slips
  // through, the client gets a retryable conflict instead of a 500.
  if (err?.code === "40P01" || err?.code === "40001") {
    res.status(409).json({ error: "conflict_retry" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "internal_error" });
};
