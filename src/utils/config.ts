// Runtime configuration.

export const APP_NAME = "StringsAttached";

/**
 * Origin of the FastAPI backend. Defaults to same-origin so the Vite dev
 * server can proxy /api. Set VITE_API_ORIGIN to point at the backend directly
 * (e.g. http://localhost:8000) when running the two servers on different
 * origins.
 */
export const API_ORIGIN: string = (import.meta.env.VITE_API_ORIGIN as
  | string
  | undefined)?.replace(/\/$/, "") || "";

export function apiUrl(path: string): string {
  return `${API_ORIGIN}${path}`;
}

/** WebSocket URL for a backend path (same-origin or configured origin). */
export function wsUrl(path: string): string {
  if (API_ORIGIN) {
    return API_ORIGIN.replace(/^http/, "ws") + path;
  }
  const proto =
    typeof location !== "undefined" && location.protocol === "https:"
      ? "wss:"
      : "ws:";
  return `${proto}//${location.host}${path}`;
}
