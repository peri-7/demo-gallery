import { useCallback, useEffect, useState } from "react";
import "./App.css";
import UploadForm from "./UploadForm.jsx";

// Read at build time, not at run time. Vite replaces this expression with a
// string literal when it builds the bundle — see .env.example.
const API_URL = import.meta.env.VITE_API_URL;

export default function App() {
  const [state, setState] = useState({ status: "loading" });

  // Lifted out of the effect so the upload form can trigger a reload after a
  // successful create. useCallback keeps its identity stable across renders,
  // which matters because it appears in a dependency array below — without it
  // the effect would re-run on every single render.
  const load = useCallback(async (signal) => {
    try {
      const res = await fetch(`${API_URL}/api/drawings`, { signal });
      // fetch only rejects on NETWORK failure. A 404 or a 500 is a perfectly
      // successful HTTP exchange as far as fetch is concerned, so res.ok has
      // to be checked by hand. Forgetting this is the most common fetch bug:
      // the error page's HTML gets handed to res.json() and you debug a
      // baffling "Unexpected token <" instead of the 500 that caused it.
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      const data = await res.json();
      setState({ status: "ok", drawings: data.drawings });
    } catch (err) {
      // An abort is a cancellation we caused, not a failure to report.
      if (err.name === "AbortError") return;
      setState({ status: "error", error: err.message });
    }
  }, []);

  useEffect(() => {
    // AbortController cancels the request if the component unmounts before the
    // response arrives. React's StrictMode mounts effects twice in development
    // precisely to expose effects that don't clean up after themselves.
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <main>
      <h1>Drawing Gallery</h1>
      <p className="muted">Stage 2 — uploads go straight to storage</p>

      <UploadForm apiUrl={API_URL} onCreated={() => load()} />

      {state.status === "loading" && (
        <p className="muted">
          Loading… <br />
          If this takes 30 seconds, the API is asleep and waking up.
        </p>
      )}

      {state.status === "error" && (
        <p className="bad">
          Failed: {state.error}
          <br />
          <span className="muted">Open the Network tab for the real reason.</span>
        </p>
      )}

      {state.status === "ok" && (
        <table>
          <thead>
            <tr>
              <th className="thumb-col"></th>
              <th>Title</th>
              <th>Artist</th>
              <th className="num">Year</th>
              <th className="num">Rating</th>
            </tr>
          </thead>
          <tbody>
            {state.drawings.map((d) => (
              // key must be a stable id, never the array index — an index
              // changes meaning when the list is re-sorted, which is exactly
              // what Stage 3 will add.
              <tr key={d.id}>
                <td>
                  {/* imageUrl is null for the seeded rows, which genuinely have
                      no file. "No image yet" is a real state, not an error, so
                      it gets a placeholder rather than a broken <img>.
                      loading="lazy" means offscreen rows request no bytes at
                      all — and those requests go to Supabase, never to the
                      API. */}
                  {d.imageUrl ? (
                    <img className="thumb" src={d.imageUrl} alt={d.title} loading="lazy" />
                  ) : (
                    <span className="thumb thumb-empty" aria-hidden="true" />
                  )}
                </td>
                <td>{d.title}</td>
                <td>{d.artist}</td>
                <td className="num">{d.year}</td>
                {/* rating is nullable in the schema, so it is nullable here.
                    A missing rating is not a zero. */}
                <td className="num">
                  {d.rating === null ? <span className="muted">—</span> : d.rating.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="muted footer">
        api: <code>{API_URL}</code>
      </p>
    </main>
  );
}
