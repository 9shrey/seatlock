import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../App";

const messages: Record<string, string> = {
  email_taken: "An account with this email already exists. Sign in instead.",
  wrong_email_or_password: "That email and password don't match.",
  invalid_credentials_format: "Use a valid email and a password of at least 8 characters.",
};

export function LoginPage() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/";
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = mode === "signin" ? await api.login(email, password) : await api.signup(email, password);
      setUser(user);
      navigate(from);
    } catch (err) {
      setError(err instanceof ApiError ? (messages[err.code] ?? "Something went wrong. Try again.") : "Can't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth" onSubmit={submit}>
      <h1>{mode === "signin" ? "Sign in" : "Create an account"}</h1>
      <label>
        Email
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      </label>
      <label>
        Password
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
        />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" disabled={busy}>
        {mode === "signin" ? "Sign in" : "Create account"}
      </button>
      <button type="button" className="link" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
        {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
      </button>
    </form>
  );
}
