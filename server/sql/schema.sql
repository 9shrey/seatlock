-- Seatlock schema. Money is stored as integer paise, never as floats.
--
-- A seat's state is derived, not stored:
--   available  booking_id is NULL, or its booking is expired/cancelled, or a hold that has run out
--   held       booking_id points at a 'held' booking whose expires_at is in the future
--   booked     booking_id points at a 'confirmed' booking
-- Because an expired hold is simply "not held" by definition, nothing has to run on a timer for
-- seats to come back. The sweeper in index.ts only tidies booking statuses for display.
--
-- Safe to run repeatedly: the server applies it on every start.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shows (
  id        SERIAL PRIMARY KEY,
  title     TEXT NOT NULL,
  venue     TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id           SERIAL PRIMARY KEY,
  user_id      INT NOT NULL REFERENCES users(id),
  show_id      INT NOT NULL REFERENCES shows(id),
  status       TEXT NOT NULL CHECK (status IN ('held', 'confirmed', 'expired', 'cancelled')),
  expires_at   TIMESTAMPTZ NOT NULL,
  seat_count   INT NOT NULL CHECK (seat_count > 0),
  total_paise  INT NOT NULL CHECK (total_paise >= 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS bookings_user_idx ON bookings (user_id);
CREATE INDEX IF NOT EXISTS bookings_held_idx ON bookings (expires_at) WHERE status = 'held';

CREATE TABLE IF NOT EXISTS seats (
  id          SERIAL PRIMARY KEY,
  show_id     INT NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  row_label   TEXT NOT NULL,
  number      INT NOT NULL CHECK (number > 0),
  price_paise INT NOT NULL CHECK (price_paise > 0),
  booking_id  INT REFERENCES bookings(id),
  UNIQUE (show_id, row_label, number)
);
CREATE INDEX IF NOT EXISTS seats_show_idx ON seats (show_id);
CREATE INDEX IF NOT EXISTS seats_booking_idx ON seats (booking_id);
