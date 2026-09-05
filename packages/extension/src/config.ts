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

/** How long a backend call may take before the panel reports it unreachable. */
export const REQUEST_TIMEOUT_MS = 8000;
