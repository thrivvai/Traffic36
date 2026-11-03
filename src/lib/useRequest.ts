import { useEffect, useState } from "react";

export type RequestState<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; error: Error };

/** Runs `load` whenever `key` changes, cancelling the previous request so a slow answer can't overwrite a newer one. */
export function useRequest<T>(key: string | null, load: (signal: AbortSignal) => Promise<T>, debounceMs = 0) {
  const [state, setState] = useState<RequestState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    setState((s) => (s.status === "ready" ? s : { status: "loading" }));
    const timer = setTimeout(() => {
      load(controller.signal).then(
        (data) => setState({ status: "ready", data }),
        (error: Error) => {
          if (error.name !== "AbortError") setState({ status: "error", error });
        },
      );
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `load` is recreated each render; `key` is what identifies the request.
  }, [key, attempt, debounceMs]);

  return { state, retry: () => setAttempt((n) => n + 1) };
}
