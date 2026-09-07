/**
 * The login / signup box.
 *
 * Two things here are deliberate and worth reading for:
 *
 * 1. SIGNUP IS TWO REQUESTS, AND THE UI SAYS SO. Our API returns 201 with no
 *    session (server/src/routes/auth.js), so creating an account and being
 *    logged in are separate events. Most apps hide that by issuing a session at
 *    signup; here the two steps are named, for the same reason UploadForm names
 *    its three — when it fails, which step failed is the whole diagnosis.
 *
 * 2. THE FAILURE MESSAGES COME FROM THE SERVER, UNEDITED. It is tempting to
 *    "improve" a 401 into "wrong password". Don't: the server answers one
 *    message for both an unknown address and a bad password ON PURPOSE, and a
 *    client that guesses which one it was reintroduces the account-enumeration
 *    leak the server spent effort closing. The client is not in a position to
 *    know, and it should not pretend to be.
 */

import { useState } from "react";
import { useAuth } from "./auth.jsx";

export default function AuthPanel() {
  const { user, expiresAt, status, isLoggedIn, signup, login, logout } = useAuth();

  const [mode, setMode] = useState("login"); // login | signup
  const [fields, setFields] = useState({ email: "", password: "" });
  // idle | creating | signing-in | busy | error
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState(null);

  const set = (patch) => setFields((prev) => ({ ...prev, ...patch }));

  async function submit(event) {
    event.preventDefault();
    setError(null);

    try {
      if (mode === "signup") {
        setPhase("creating");
        await signup(fields.email, fields.password);
        // Straight into a login with the same credentials. This is the ONE
        // place the client is allowed to hold a password for longer than a
        // single request, and it is still only until this function returns.
        setPhase("signing-in");
        await login(fields.email, fields.password);
      } else {
        setPhase("signing-in");
        await login(fields.email, fields.password);
      }

      // Drop the password from React state the moment it is spent. It buys
      // little against a determined attacker — a rendered <input> holds it too
      // — but leaving credentials sitting in component state for the lifetime
      // of the page is a habit worth not having.
      setFields({ email: "", password: "" });
      setPhase("idle");
    } catch (err) {
      setPhase("error");
      setError(err.message);
    }
  }

  async function signOut() {
    setPhase("busy");
    await logout();
    setPhase("idle");
  }

  // Until GET /api/auth/me answers, we genuinely do not know. Rendering the
  // sign-in form during that gap would flash a login box at someone who is
  // already signed in — the classic symptom of treating "unknown" as "no".
  if (status === "checking") {
    return (
      <section className="card auth">
        <h2>Checking your session…</h2>
        <p className="muted">
          The session cookie is <code>HttpOnly</code>, so this page cannot read it. Asking
          the server is the only way to find out whether we are signed in.
        </p>
      </section>
    );
  }

  if (isLoggedIn) {
    return (
      <section className="card auth">
        <h2>Signed in</h2>
        <p>
          <strong>{user.email}</strong>
        </p>
        <p className="muted">
          Session expires {new Date(expiresAt).toLocaleString()}.{" "}
          <strong>Refresh the page — you stay signed in.</strong> The token is in an
          HttpOnly cookie now, so it survives the reload, and no JavaScript on this page
          can read it. Try <code>document.cookie</code> in the console: it is empty.
        </p>
        <button type="button" onClick={signOut} disabled={phase === "busy"}>
          {phase === "busy" ? "Signing out…" : "Sign out"}
        </button>
      </section>
    );
  }

  const busy = phase === "creating" || phase === "signing-in" || phase === "busy";

  return (
    <form className="card auth" onSubmit={submit}>
      <h2>{mode === "signup" ? "Create an account" : "Sign in"}</h2>

      <div className="grid">
        <label>
          Email
          {/* type="email" gets the right mobile keyboard and a free browser
              check. It is a convenience, not validation — the API revalidates,
              because the browser is not the only caller. */}
          <input
            type="email"
            value={fields.email}
            maxLength={254}
            autoComplete="username"
            onChange={(e) => set({ email: e.target.value })}
            disabled={busy}
            required
          />
        </label>
        <label>
          Password
          {/* autoComplete tells the password manager which of the two this is.
              Getting it wrong is why so many sites fight with 1Password. */}
          <input
            type="password"
            value={fields.password}
            minLength={10}
            maxLength={200}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            onChange={(e) => set({ password: e.target.value })}
            disabled={busy}
            required
          />
        </label>
      </div>

      <button type="submit" disabled={busy}>
        {busy ? "Working…" : mode === "signup" ? "Create account" : "Sign in"}
      </button>

      {mode === "signup" && busy && (
        <ol className="steps">
          <li className={phase === "creating" ? "step active" : "step done"}>
            1. creating the account
          </li>
          <li className={phase === "signing-in" ? "step active" : "step"}>
            2. exchanging the password for a session
          </li>
        </ol>
      )}

      <button
        type="button"
        className="link"
        disabled={busy}
        onClick={() => {
          setMode(mode === "signup" ? "login" : "signup");
          setError(null);
        }}
      >
        {mode === "signup" ? "I already have an account" : "Create an account instead"}
      </button>

      {error && <p className="bad">{error}</p>}
    </form>
  );
}
