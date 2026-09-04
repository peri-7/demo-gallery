import { useCallback, useEffect, useRef, useState } from "react";

// How many rows a page holds. The API caps this at 100 and would 400 anything
// larger — the limit lives there, not here, because the browser is not the only
// caller. This constant is just what OUR client asks for.
export const PAGE_SIZE = 12;

/**
 * Build the request URL.
 *
 * URLSearchParams rather than string concatenation, because the values are not
 * ours: an artist search for "R&B" or "50% off" contains characters that mean
 * something in a query string. Concatenating produces a URL that is silently
 * cut short at the "&" — the server sees a different search than the one typed,
 * and nothing anywhere reports a problem.
 *
 * Empty filters are OMITTED rather than sent empty. `?artist=` is not "no
 * filter", it is "filter by the empty string", and our API correctly rejects it
 * with a 400. Absent and empty are different things at every layer.
 */
export function drawingsUrl(apiUrl, query, cursor) {
  const params = new URLSearchParams();
  params.set("sort", query.sort);
  params.set("order", query.order);
  params.set("limit", String(PAGE_SIZE));

  if (query.artist.trim() !== "") params.set("artist", query.artist.trim());
  if (query.minRating !== "") params.set("minRating", query.minRating);
  if (query.hasImage !== "") params.set("hasImage", query.hasImage);
  if (cursor) params.set("cursor", cursor);

  return `${apiUrl}/api/drawings?${params}`;
}

/**
 * Delay a value until it stops changing.
 *
 * Without this, every keystroke in the search box is a request: "d", "du",
 * "dur" — three round trips, two of them for a search the user was never
 * interested in. The timer restarts on each change and only the final value
 * survives, so typing produces one request instead of one per character.
 *
 * The cleanup function is what makes it work. React runs it before the next
 * effect, cancelling the previous timer; without it every keystroke would
 * schedule its own surviving timeout and you would be back to one request per
 * character, just delayed.
 */
export function useDebounced(value, delayMs) {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}

/**
 * Fetch a page of drawings, and keep fetching more on request.
 *
 * The interesting problem here is not fetching, it is that requests overlap.
 * The user changes the sort while a page is still in flight; the old response
 * arrives second and overwrites the new one. That is not a rare race — on a
 * sleeping free-tier server the first request can take thirty seconds, so it is
 * the normal case.
 *
 * The fix is one AbortController per query, stored in a ref so that BOTH the
 * first-page effect and loadMore share it. When the query changes, React runs
 * the effect's cleanup, the controller aborts, and every in-flight request tied
 * to the old query rejects with an AbortError instead of calling setState.
 * Results for a question nobody is asking any more can never reach the screen.
 */
export function useDrawings(apiUrl, query) {
  const [state, setState] = useState({
    status: "loading", // loading | ok | loadingMore | error
    drawings: [],
    nextCursor: null,
    error: null,
  });

  // A counter the caller can bump to force a refetch — used after an upload,
  // where nothing about the query changed but the data did.
  const [reloadCount, setReloadCount] = useState(0);
  const reload = useCallback(() => setReloadCount((n) => n + 1), []);

  // Refs hold values that survive re-renders without causing one. The
  // controller is not display state — changing it should never repaint
  // anything — so a ref is the right home for it, not useState.
  const abortRef = useRef(null);

  // Deps are the individual FIELDS, not the query object. A new object literal
  // with identical contents is a different value to React, so depending on the
  // object itself would refetch on every single render.
  const { sort, order, artist, minRating, hasImage } = query;

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;

    setState((prev) => ({ ...prev, status: "loading", error: null }));

    fetch(drawingsUrl(apiUrl, query, null), { signal: controller.signal })
      .then(async (res) => {
        const body = await readBody(res);
        if (!res.ok) throw new Error(describe(res, body));
        setState({
          status: "ok",
          drawings: body.drawings,
          nextCursor: body.nextCursor,
          error: null,
        });
      })
      .catch((err) => {
        // An abort is a cancellation we caused, not a failure to report.
        if (err.name === "AbortError") return;
        setState({ status: "error", drawings: [], nextCursor: null, error: err.message });
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, sort, order, artist, minRating, hasImage, reloadCount]);

  const loadMore = useCallback(
    (cursor) => {
      if (cursor === null) return;
      setState((prev) => ({ ...prev, status: "loadingMore" }));

      // Deliberately the SAME controller as the first-page effect. Changing the
      // sort mid-page-load aborts this too, so a page of the old ordering can
      // never be appended to a list of the new one.
      const signal = abortRef.current?.signal;

      fetch(drawingsUrl(apiUrl, query, cursor), { signal })
        .then(async (res) => {
          const body = await readBody(res);
          if (!res.ok) throw new Error(describe(res, body));
          // Functional update: append to whatever the list IS now, not to
          // whatever it was when this request started. `[...state.drawings]`
          // captured above would silently drop any page that landed in between.
          setState((prev) => ({
            status: "ok",
            drawings: [...prev.drawings, ...body.drawings],
            nextCursor: body.nextCursor,
            error: null,
          }));
        })
        .catch((err) => {
          if (err.name === "AbortError") return;
          setState((prev) => ({ ...prev, status: "error", error: err.message }));
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apiUrl, sort, order, artist, minRating, hasImage]
  );

  return { ...state, loadMore, reload };
}

// An error can come from somewhere that has never heard of our API — a proxy, a
// platform, a crashed process — and that will not be JSON. Assuming a body's
// shape because it usually has that shape is how you end up debugging
// "Unexpected token <" instead of the 502 that caused it.
async function readBody(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function describe(res, body) {
  if (Array.isArray(body?.details)) return body.details.join("; ");
  return body?.error ?? `Request failed (HTTP ${res.status}).`;
}
