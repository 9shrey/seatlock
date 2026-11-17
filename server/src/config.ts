export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://seatlock:seatlock@localhost:55440/seatlock",
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-secret-change-me",
  holdSeconds: Number(process.env.HOLD_SECONDS ?? 300),
  maxSeatsPerBooking: 8,
  secureCookies: process.env.NODE_ENV === "production",
};

if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET must be set in production");
}
