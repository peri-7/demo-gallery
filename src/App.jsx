import { useEffect, useState } from "react";
import "./App.css";

// Read at build time, not at run time. Vite replaces this expression with a
// string literal when it builds the bundle — see .env.example.
const API_URL = import.meta.env.VITE_API_URL;

export default function App() {
  const [state, setState] = useState({ status: "loading" });

  useEffect(() => {
    fetch(`${API_URL}/api/hello`)
      .then((res) => {
        if (!res.ok) throw new Error(`API returned ${res.status}`);
        return res.json();
      })
      .then((data) => setState({ status: "ok", data }))
      .catch((err) => setState({ status: "error", error: err.message }));
  }, []);

  return (
    <main>
      <h1>Drawing Gallery</h1>
      <p className="muted">Stage 0 — walking skeleton</p>

      <section className="card">
        <h2>API connection</h2>
        <p className="muted">
          <code>{API_URL}</code>
        </p>

        {state.status === "loading" && <p>Contacting the API…</p>}

        {state.status === "error" && (
          <p className="bad">
            Failed: {state.error}
            <br />
            <span className="muted">Open the Network tab for the real reason.</span>
          </p>
        )}

        {state.status === "ok" && (
          <p className="good">
            {state.data.message}
            <br />
            <span className="muted">server time: {state.data.at}</span>
          </p>
        )}
      </section>
    </main>
  );
}
