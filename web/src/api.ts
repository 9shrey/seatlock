export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details?: { seatIds?: number[] },
  ) {
    super(code);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? "request_failed", data.details);
  return data as T;
}

export type User = { id: number; email: string };
export type ShowSummary = {
  id: number;
  title: string;
  venue: string;
  startsAt: string;
  totalSeats: number;
  availableSeats: number;
  fromPaise: number;
};
export type SeatState = "available" | "held" | "booked" | "mine";
export type Seat = { id: number; row: string; number: number; pricePaise: number; state: SeatState };
export type Hold = { id: number; expiresAt: string; totalPaise: number };
export type Booking = {
  id: number;
  showId: number;
  showTitle: string;
  venue: string;
  startsAt: string;
  status: "held" | "confirmed";
  expiresAt: string;
  totalPaise: number;
  seats: { id: number; row: string; number: number }[];
};

export const api = {
  me: () => call<{ user: User | null }>("GET", "/auth/me"),
  signup: (email: string, password: string) => call<{ user: User }>("POST", "/auth/signup", { email, password }),
  login: (email: string, password: string) => call<{ user: User }>("POST", "/auth/login", { email, password }),
  logout: () => call<void>("POST", "/auth/logout"),
  shows: () => call<{ shows: ShowSummary[] }>("GET", "/shows"),
  show: (id: number) =>
    call<{ show: ShowSummary; seats: Seat[]; myHold: Hold | null; serverTime: string }>("GET", `/shows/${id}`),
  hold: (showId: number, seatIds: number[]) =>
    call<{ booking: Booking }>("POST", `/shows/${showId}/holds`, { seatIds }),
  confirm: (bookingId: number) => call<{ booking: Booking }>("POST", `/bookings/${bookingId}/confirm`),
  release: (bookingId: number) => call<void>("DELETE", `/bookings/${bookingId}`),
  bookings: () => call<{ bookings: Booking[] }>("GET", "/bookings"),
};

export const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export const showTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
