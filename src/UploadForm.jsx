import { useEffect, useState } from "react";

// Mirrors the API's allowlist. This copy exists for the file picker and for
// fast feedback — it is NOT the enforcement. The API decides what it will sign,
// and the bucket decides what it will store. Anything checked here is a
// courtesy to the user, because the user is not the only caller.
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

// Same reasoning: a hint, so a 40 MB file fails instantly instead of after a
// two-minute upload. The bucket is what actually refuses it.
const MAX_BYTES = 10 * 1024 * 1024;

const BLANK = { title: "", artist: "", year: String(new Date().getFullYear()), rating: "" };

export default function UploadForm({ apiUrl, onCreated }) {
  const [fields, setFields] = useState(BLANK);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  // One of: idle | signing | uploading | saving | done | error
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState(null);

  // A preview URL is a reference into browser memory holding the whole file.
  // The browser cannot know when you are finished with it, so it keeps the
  // blob alive until you revoke it — pick ten files without this and you are
  // holding ten images in memory. Effect cleanup is where that gets released.
  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function pickFile(event) {
    const chosen = event.target.files?.[0] ?? null;
    setError(null);
    if (!chosen) return setFile(null);
    if (!ACCEPTED.includes(chosen.type)) {
      setFile(null);
      return setError(`${chosen.type || "That file type"} is not supported. Use JPEG, PNG or WebP.`);
    }
    if (chosen.size > MAX_BYTES) {
      setFile(null);
      return setError(`That file is ${(chosen.size / 1024 / 1024).toFixed(1)} MB. The limit is 10 MB.`);
    }
    setFile(chosen);
  }

  async function submit(event) {
    // Without this the browser does a full-page form POST and navigates away —
    // the default behaviour of a <form>, which predates any of this.
    event.preventDefault();
    setError(null);

    if (!file) return setError("Choose an image first.");

    try {
      // --- 1. Ask the API for permission --------------------------------
      // It validates, chooses the key, and signs. It does not contact storage
      // and does not write to the database: nothing has happened yet.
      setPhase("signing");
      const signRes = await fetch(`${apiUrl}/api/drawings/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: file.type }),
      });
      if (!signRes.ok) throw new Error(await describe(signRes));
      const { key, uploadUrl } = await signRes.json();

      // --- 2. Send the bytes to storage. The API is not involved. -------
      // A cross-origin PUT with a Content-Type of image/png is not a "simple"
      // request, so the browser sends a preflight OPTIONS to Supabase first.
      // Our own CORS allowlist has no say in this — Supabase must permit it.
      //
      // Note the body: the File object itself. It is streamed from disk, not
      // read into a string. `fetch` cannot report upload progress; a progress
      // bar needs XMLHttpRequest, which still exists precisely for this.
      setPhase("uploading");
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) {
        throw new Error(`Storage rejected the upload (HTTP ${putRes.status}).`);
      }

      // --- 3. Tell the API it landed ------------------------------------
      // File first, row second. If this call fails, the object is an orphan —
      // invisible and cheap. The other order would risk a row pointing at
      // nothing, which the user would see as a broken image.
      setPhase("saving");
      const createRes = await fetch(`${apiUrl}/api/drawings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: fields.title,
          artist: fields.artist,
          // Inputs always produce strings. The API rejects "2026" as a string
          // rather than coercing it, so the conversion has to happen here.
          year: Number(fields.year),
          rating: fields.rating === "" ? null : Number(fields.rating),
          storageKey: key,
        }),
      });
      if (!createRes.ok) throw new Error(await describe(createRes));

      setPhase("done");
      setFields(BLANK);
      setFile(null);
      onCreated();
      setTimeout(() => setPhase("idle"), 2500);
    } catch (err) {
      setPhase("error");
      setError(err.message);
    }
  }

  const busy = phase === "signing" || phase === "uploading" || phase === "saving";

  return (
    <form className="card upload" onSubmit={submit}>
      <h2>Add a drawing</h2>

      <label className="file">
        <input
          type="file"
          accept={ACCEPTED.join(",")}
          onChange={pickFile}
          disabled={busy}
        />
      </label>

      {preview && <img className="preview" src={preview} alt="" />}

      <div className="grid">
        <label>
          Title
          <input
            value={fields.title}
            maxLength={120}
            onChange={(e) => setFields({ ...fields, title: e.target.value })}
            disabled={busy}
            required
          />
        </label>
        <label>
          Artist
          <input
            value={fields.artist}
            maxLength={80}
            onChange={(e) => setFields({ ...fields, artist: e.target.value })}
            disabled={busy}
            required
          />
        </label>
        <label>
          Year
          <input
            type="number"
            min={1000}
            max={2100}
            value={fields.year}
            onChange={(e) => setFields({ ...fields, year: e.target.value })}
            disabled={busy}
            required
          />
        </label>
        <label>
          Rating <span className="muted">(optional)</span>
          <input
            type="number"
            min={0}
            max={5}
            step={0.1}
            value={fields.rating}
            onChange={(e) => setFields({ ...fields, rating: e.target.value })}
            disabled={busy}
            placeholder="—"
          />
        </label>
      </div>

      <button type="submit" disabled={busy || !file}>
        {busy ? "Working…" : "Upload"}
      </button>

      {/* The three steps are named rather than hidden behind one spinner.
          When an upload fails, which step it failed on is the entire
          diagnosis — and it is the same question you would ask in the logs. */}
      {busy && (
        <ol className="steps">
          <li className={stepClass(phase, "signing")}>1. asking the API to sign a URL</li>
          <li className={stepClass(phase, "uploading")}>2. sending bytes straight to storage</li>
          <li className={stepClass(phase, "saving")}>3. recording the drawing</li>
        </ol>
      )}

      {phase === "done" && <p className="good">Uploaded.</p>}
      {error && <p className="bad">{error}</p>}
    </form>
  );
}

const ORDER = ["signing", "uploading", "saving"];

function stepClass(phase, step) {
  const at = ORDER.indexOf(phase);
  const mine = ORDER.indexOf(step);
  if (mine < at) return "step done";
  if (mine === at) return "step active";
  return "step";
}

/**
 * Turn an error response into something readable.
 *
 * The API answers failures with JSON, but an error can also come from somewhere
 * that has never heard of our API — a proxy, a platform, a crashed process —
 * and that will not be JSON. Assuming a body's shape because it usually has
 * that shape is how you end up debugging "Unexpected token <" instead of the
 * 502 that caused it.
 */
async function describe(res) {
  try {
    const body = await res.json();
    if (Array.isArray(body.details)) return body.details.join("; ");
    return body.error ?? `Request failed (HTTP ${res.status}).`;
  } catch {
    return `Request failed (HTTP ${res.status}).`;
  }
}
