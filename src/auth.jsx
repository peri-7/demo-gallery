/**
 * Stage 4b, step 2: the token lives in an HttpOnly cookie, and this file cannot
 * see it.
 *
 * That last clause is the entire point, and it is worth sitting with. In step 1
 * there was a `tokenRef` here holding 43 characters. Search this file now and
 * there is no token anywhere — not in a variable, not in state, not in storage.
 * The credential exists in the browser's cookie jar, which JavaScript has no
 * access to. An XSS payload on this page can no longer steal the session,
 * because there is nothing on this page to steal.
 *
 * WHAT IT COST
 * ------------
 * The browser now attaches the cookie automatically, by DESTINATION rather than
 * by who asked. So does any other site that causes a request to our API. That
 * is CSRF, and the server had to grow src/csrf.js to answer it — a defence a
 * same-site deployment would have got free from SameSite=Lax.
 *
 * WHAT DID NOT CHANGE
 * -------------------
 * The sessions table, the sha256 lookup, expiry in the WHERE clause, revocation
 * by DELETE. All of Stage 4a is untouched. We moved the transport, not the
 * mechanism — and the two were only separable because 4a kept HTTP out of
 * sessions.js.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const AuthContext = createContext(null);

export function AuthProvider({ apiUrl, children }) {
  const [user, setUser] = useState(null);
  const [expiresAt, setExpiresAt] = useState(null);

  // "checking" until the bootstrap request below answers. Without this the page
  // renders signed-out for a moment and then flips, which reads as a bug and,
  // worse, briefly shows a "Sign in" form to someone who is already signed in.
  const [status, setStatus] = useState("checking"); // checking | ready

  /**
   * fetch(), with the session cookie attached.
   *
   * `credentials: "include"` is the whole change from step 1, and it is not
   * optional: fetch defaults to "same-origin", which means it sends NO cookies
   * on a cross-origin request. Our API is a different origin, so without this
   * line the browser holds a perfectly good session cookie and declines to send
   * it — every request 401s and nothing in the console explains why.
   *
   * Asking for credentials also tightens what the server must return. With
   * `credentials: "include"`, a response carrying `Access-Control-Allow-Origin: *`
   * is REJECTED by the browser — a wildcard and credentials are forbidden
   * together, because "any site may read this" and "this is personalised to a
   * logged-in user" cannot both be true. Our cors.js echoes the exact origin and
   * sends `Access-Control-Allow-Credentials: true`, which it has done since
   * Stage 0 with nothing to use it. This is the request that finally needs it.
   *
   * Still a PATH, not a URL — for the same reason as step 1, and now with a
   * sharper edge. `credentials: "include"` on a request to somewhere else would
   * send that host whatever cookies it has for that host. Keeping this function
   * incapable of addressing anyone but our own API keeps the blast radius at
   * zero by construction.
   */
  const authFetch = useCallback(
    async (path, options = {}) => {
      if (!path.startsWith("/")) {
        throw new Error(`authFetch takes a path beginning with "/", got: ${path}`);
      }

      const res = await fetch(`${apiUrl}${path}`, { ...options, credentials: "include" });

      // The server is the only authority on whether we are signed in. A 401
      // means our belief is stale — expired, or revoked from another device —
      // and continuing to render a signed-in UI just produces a second failure
      // the user cannot explain.
      if (res.status === 401) {
        setUser(null);
        setExpiresAt(null);
      }

      return res;
    },
    [apiUrl]
  );

  /**
   * Ask the server who we are, once, on page load.
   *
   * THIS IS THE FEATURE STEP 1 COULD NOT HAVE. Back then a reload started with
   * an empty variable, so there was nothing to ask about and refreshing signed
   * you out. Now the cookie survives the reload — but this JavaScript cannot
   * read it, so the ONLY way for the page to discover whether it has a valid
   * session is to make a request and see what the server says.
   *
   * Which is the client-side face of a Stage 4a idea: "logged in" is never
   * remembered, it is re-derived. The server does that per request. The page
   * does it per load.
   */
  useEffect(() => {
    const controller = new AbortController();

    fetch(`${apiUrl}/api/auth/me`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return; // 401 is the ordinary "not signed in" answer, not an error
        const body = await res.json();
        setUser(body.user);
        setExpiresAt(body.session.expiresAt);
      })
      .catch(() => {
        // A network failure here is not worth surfacing: the honest result is
        // "we could not confirm a session", which renders identically to "no
        // session". The next real request will report its own failure properly.
      })
      .finally(() => {
        if (!controller.signal.aborted) setStatus("ready");
      });

    // StrictMode mounts effects twice in development, so you will see two
    // /api/auth/me requests locally and one of them cancelled. That is the point
    // of StrictMode — it exposes effects that do not clean up after themselves.
    return () => controller.abort();
  }, [apiUrl]);

  const signup = useCallback(
    async (email, password) => {
      const res = await authFetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) throw new Error(await readError(res));
      return true;
    },
    [authFetch]
  );

  const login = useCallback(
    async (email, password) => {
      const res = await authFetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) throw new Error(await readError(res));

      const body = await res.json();
      // No token in this body any more, and nothing here to store. The session
      // arrived in a Set-Cookie header that this code never sees and could not
      // read if it tried. We take only what the UI displays.
      setUser(body.user);
      setExpiresAt(body.expiresAt);
      return body.user;
    },
    [authFetch]
  );

  const logout = useCallback(async () => {
    try {
      // Must go through authFetch: without the cookie the server has no idea
      // WHICH session to delete. Logout is an authenticated operation even
      // though it is not a privileged one.
      await authFetch("/api/auth/logout", { method: "POST" });
    } finally {
      // finally, so a failed request still signs you out of this tab. But note
      // the asymmetry, and it is a real one: clearing this state is cosmetic.
      // If the request never reached the server, the ROW still exists and the
      // session is still live for anyone holding the cookie. Only the server
      // can actually end a session.
      setUser(null);
      setExpiresAt(null);
    }
  }, [authFetch]);

  const value = useMemo(
    () => ({
      user,
      expiresAt,
      status,
      isLoggedIn: user !== null,
      authFetch,
      signup,
      login,
      logout,
    }),
    [user, expiresAt, status, authFetch, signup, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (ctx === null) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

// An error can come from somewhere that has never heard of our API — a proxy, a
// platform, a crashed process — and that will not be JSON.
async function readError(res) {
  try {
    const body = await res.json();
    if (Array.isArray(body.details)) return body.details.join("; ");
    return body.error ?? `Request failed (HTTP ${res.status}).`;
  } catch {
    return `Request failed (HTTP ${res.status}).`;
  }
}
