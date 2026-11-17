import bcrypt from "bcryptjs";
import { Router, type Request, type RequestHandler, type Response } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { config } from "./config.js";
import { pool } from "./db.js";
import { HttpError } from "./errors.js";

const COOKIE = "seatlock_session";
const credentials = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(8).max(128),
});

export type User = { id: number; email: string };

function startSession(res: Response, user: User) {
  const token = jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, { expiresIn: "7d" });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.secureCookies,
    maxAge: 7 * 24 * 3600 * 1000,
  });
}

/** Sets req.user when a valid session cookie is present. Never rejects. */
export const loadUser: RequestHandler = (req, _res, next) => {
  const token = req.cookies?.[COOKIE];
  if (token) {
    try {
      const payload = jwt.verify(token, config.jwtSecret) as unknown as { sub: number; email: string };
      req.user = { id: Number(payload.sub), email: payload.email };
    } catch {
      // Bad or expired token: treat as signed out.
    }
  }
  next();
};

export const requireUser: RequestHandler = (req, _res, next) => {
  if (!req.user) throw new HttpError(401, "not_signed_in");
  next();
};

export function currentUser(req: Request): User {
  if (!req.user) throw new HttpError(401, "not_signed_in");
  return req.user;
}

export const authRouter = Router();

authRouter.post("/signup", async (req, res) => {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "invalid_credentials_format", parsed.error.issues);
  const { email, password } = parsed.data;
  const hash = await bcrypt.hash(password, 10);
  const result = await pool.query<User>(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2)
     ON CONFLICT (email) DO NOTHING RETURNING id, email`,
    [email, hash],
  );
  const user = result.rows[0];
  if (!user) throw new HttpError(409, "email_taken");
  startSession(res, user);
  res.status(201).json({ user });
});

authRouter.post("/login", async (req, res) => {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) throw new HttpError(401, "wrong_email_or_password");
  const { email, password } = parsed.data;
  const result = await pool.query<User & { password_hash: string }>(
    "SELECT id, email, password_hash FROM users WHERE email = $1",
    [email],
  );
  const row = result.rows[0];
  if (!row || !(await bcrypt.compare(password, row.password_hash))) {
    throw new HttpError(401, "wrong_email_or_password");
  }
  const user = { id: row.id, email: row.email };
  startSession(res, user);
  res.json({ user });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE);
  res.status(204).end();
});

authRouter.get("/me", (req, res) => {
  res.json({ user: req.user ?? null });
});
