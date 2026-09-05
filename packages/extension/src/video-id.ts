/**
 * YouTube video-id parsing.
 *
 * Kept as a pure function with no `chrome.*` access so both sides that need
 * it can use it — the content script (from `location.href`) and the service
 * worker (from `tab.url`, its fallback when the content script has not
 * reported yet) — and so it is testable without a browser.
 */

/** YouTube ids are 11 characters of the URL-safe base64 alphabet. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Path forms that carry the id as the segment after the marker. */
const PATH_PREFIXES = ['/shorts/', '/live/', '/embed/', '/v/'];

/**
 * The video id in `rawUrl`, or `null` if it holds none — a channel page, the
 * YouTube home page, a non-YouTube site, or a malformed URL.
 *
 * Anything that is not a valid id is `null` rather than a best guess: the
 * caller uses this to decide whether there is a video to search at all, and
 * a wrong id would query the backend for a video that does not exist.
 */
export function parseVideoId(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (!isYouTubeHost(url.hostname)) {
    return null;
  }

  // youtu.be/<id> — the id is the whole path.
  if (url.hostname.endsWith('youtu.be')) {
    return validate(url.pathname.slice(1));
  }

  // /watch?v=<id>, and /shorts/<id> style paths.
  const fromQuery = validate(url.searchParams.get('v'));
  if (fromQuery) {
    return fromQuery;
  }

  const prefix = PATH_PREFIXES.find((candidate) => url.pathname.startsWith(candidate));
  return prefix ? validate(url.pathname.slice(prefix.length).split('/')[0]) : null;
}

/** `true` for youtube.com, its subdomains, and the youtu.be short domain. */
export function isYouTubeHost(hostname: string): boolean {
  return (
    hostname === 'youtube.com' ||
    hostname.endsWith('.youtube.com') ||
    hostname === 'youtu.be' ||
    hostname.endsWith('.youtu.be')
  );
}

function validate(candidate: string | null | undefined): string | null {
  return candidate && VIDEO_ID.test(candidate) ? candidate : null;
}
