import { createContext, useContext, useEffect, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { api, type User } from "./api";
import { BookingsPage } from "./pages/Bookings";
import { LoginPage } from "./pages/Login";
import { ShowPage } from "./pages/Show";
import { ShowsPage } from "./pages/Shows";

type Auth = { user: User | null; setUser: (u: User | null) => void };
const AuthContext = createContext<Auth>({ user: null, setUser: () => {} });
export const useAuth = () => useContext(AuthContext);

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .me()
      .then((r) => setUser(r.user))
      .finally(() => setReady(true));
  }, []);

  async function signOut() {
    await api.logout();
    setUser(null);
    navigate("/");
  }

  if (!ready) return null;

  return (
    <AuthContext.Provider value={{ user, setUser }}>
      <header className="topbar">
        <Link to="/" className="brand">
          Seatlock
        </Link>
        <nav>
          <NavLink to="/" end>
            Shows
          </NavLink>
          {user && <NavLink to="/bookings">My bookings</NavLink>}
        </nav>
        <div className="account">
          {user ? (
            <>
              <span className="muted">{user.email}</span>
              <button className="link" onClick={signOut}>
                Sign out
              </button>
            </>
          ) : (
            <Link to="/login">Sign in</Link>
          )}
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<ShowsPage />} />
          <Route path="/shows/:id" element={<ShowPage />} />
          <Route path="/bookings" element={user ? <BookingsPage /> : <Navigate to="/login" />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<p className="empty">This page doesn't exist.</p>} />
        </Routes>
      </main>
    </AuthContext.Provider>
  );
}
