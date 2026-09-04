import { useState } from "react";
import "./App.css";
import UploadForm from "./UploadForm.jsx";
import { useDebounced, useDrawings } from "./useDrawings.js";

// Read at build time, not at run time. Vite replaces this expression with a
// string literal when it builds the bundle — see .env.example.
const API_URL = import.meta.env.VITE_API_URL;

// The sort options the API accepts. Duplicated from the server on purpose:
// these are two separate systems that happen to agree, not one system. If they
// drift, the API returns a 400 and says which values it allows — which is
// exactly why it validates rather than trusting us.
const SORT_OPTIONS = [
  { value: "year", label: "Year" },
  { value: "rating", label: "Rating" },
  { value: "created_at", label: "Date added" },
];

const BLANK_QUERY = { sort: "year", order: "desc", artist: "", minRating: "", hasImage: "" };

export default function App() {
  // What the controls currently show. Updates on every keystroke.
  const [controls, setControls] = useState(BLANK_QUERY);

  // What we actually ask the API for. Identical to `controls` except that the
  // free-text field lags 300ms behind, so typing produces one request rather
  // than one per character. Selecting a sort is NOT debounced — that is a
  // single deliberate action and should feel instant.
  const debouncedArtist = useDebounced(controls.artist, 300);
  const query = { ...controls, artist: debouncedArtist };

  const { status, drawings, nextCursor, error, loadMore, reload } = useDrawings(API_URL, query);

  // Changing any control resets the list to page 1 — the hook does this for
  // free, because a changed query is a changed effect dependency. There is no
  // "reset the cursor" line anywhere, and there shouldn't be: the cursor is
  // derived from the response, so a new query simply never sees the old one.
  const set = (patch) => setControls((prev) => ({ ...prev, ...patch }));

  const busy = status === "loading";

  return (
    <main>
      <h1>Drawing Gallery</h1>
      <p className="muted">Stage 3 — sorting, filtering, keyset pagination</p>

      <UploadForm apiUrl={API_URL} onCreated={reload} />

      <section className="card controls">
        <h2>Browse</h2>

        <div className="grid">
          <label>
            Sort by
            <select value={controls.sort} onChange={(e) => set({ sort: e.target.value })}>
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Direction
            <select value={controls.order} onChange={(e) => set({ order: e.target.value })}>
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </label>

          <label>
            Artist contains
            <input
              value={controls.artist}
              maxLength={80}
              placeholder="e.g. Durer"
              onChange={(e) => set({ artist: e.target.value })}
            />
          </label>

          <label>
            Minimum rating
            <select value={controls.minRating} onChange={(e) => set({ minRating: e.target.value })}>
              <option value="">Any</option>
              <option value="3">3.0+</option>
              <option value="4">4.0+</option>
              <option value="4.5">4.5+</option>
            </select>
          </label>

          <label>
            Image
            <select value={controls.hasImage} onChange={(e) => set({ hasImage: e.target.value })}>
              <option value="">Any</option>
              <option value="true">With image</option>
              <option value="false">Without image</option>
            </select>
          </label>
        </div>

        {/* The debounce made visible. While the box holds something the API has
            not been asked about yet, say so — an interface that looks settled
            but isn't is worse than one that admits it's waiting. */}
        {controls.artist !== debouncedArtist && (
          <p className="muted">Waiting for you to stop typing…</p>
        )}

        <button type="button" className="link" onClick={() => setControls(BLANK_QUERY)}>
          Reset
        </button>
      </section>

      {status === "error" && (
        <p className="bad">
          Failed: {error}
          <br />
          <span className="muted">Open the Network tab for the real reason.</span>
        </p>
      )}

      {busy && (
        <p className="muted">
          Loading… <br />
          If this takes 30 seconds, the API is asleep and waking up.
        </p>
      )}

      {!busy && status !== "error" && (
        <>
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
              {drawings.map((d) => (
                // key must be a stable id, never the array index. With
                // pagination the list GROWS: an index-keyed row would be
                // reused for a different drawing whenever the order changed,
                // and React would keep the wrong DOM node — including the
                // wrong loaded image.
                <tr key={d.id}>
                  <td>
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

          {drawings.length === 0 && <p className="muted">No drawings match those filters.</p>}

          <div className="pager">
            {/* Note what is NOT here: page numbers. A cursor can only say "the
                rows after this one", so there is no way to jump to page 7 —
                that is the honest cost of keyset pagination, and the reason
                infinite-scroll interfaces are so common on large datasets. */}
            {nextCursor !== null ? (
              <button
                type="button"
                onClick={() => loadMore(nextCursor)}
                disabled={status === "loadingMore"}
              >
                {status === "loadingMore" ? "Loading…" : "Load more"}
              </button>
            ) : (
              drawings.length > 0 && <span className="muted">End of list.</span>
            )}
            <span className="muted count">{drawings.length} shown</span>
          </div>
        </>
      )}

      <p className="muted footer">
        api: <code>{API_URL}</code>
      </p>
    </main>
  );
}
