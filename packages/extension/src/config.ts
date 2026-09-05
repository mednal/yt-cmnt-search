/**
 * Build-time configuration.
 *
 * `__API_BASE_URL__` is substituted by `scripts/build.mjs` (from
 * `YCA_API_BASE_URL`, default `http://localhost:3000`). It is a build-time
 * constant rather than a runtime setting because the same value has to appear
 * in the manifest's `host_permissions`, and a panel pointed at an origin the
 * manifest does not grant fails with an opaque network error.
 */
declare const __API_BASE_URL__: string;

/** Backend origin, without a trailing slash. */
export const API_BASE_URL: string = __API_BASE_URL__;

/** How long a read call may take before the panel reports it unreachable. */
export const REQUEST_TIMEOUT_MS = 8000;

/**
 * How long one ingest or embed step may take.
 *
 * Far longer than a read: an embed step runs a 96-comment batch through the
 * local model, measured at ~7s per call on the M5 reference video, and a
 * cold start also pays for loading the model itself.
 */
export const STEP_TIMEOUT_MS = 180_000;

/** Results requested per search page. Matches the backend's default limit. */
export const SEARCH_PAGE_SIZE = 20;
