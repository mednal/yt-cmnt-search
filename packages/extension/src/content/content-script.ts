/**
 * Content script: reports which video this tab is showing.
 *
 * YouTube is a single-page app — navigating from one video to the next never
 * reloads the document, so reading the URL once at injection time is not
 * enough. `yt-navigate-finish` is the event YouTube's own app fires when a
 * navigation has settled; it reaches this isolated world because it is a DOM
 * event on `document`.
 *
 * The service worker can also derive the id from `tab.url` on its own, and
 * does as a fallback. This script is what makes the panel update *promptly*
 * on in-page navigation, and it is where M9's jump-to-comment lands.
 */
import { parseVideoId } from '../video-id.ts';
import type { VideoDetectedMessage } from '../messaging.ts';

/** `undefined` = nothing reported yet, `null` = reported "not a video page". */
let reported: string | null | undefined;

function report(): void {
  const videoId = parseVideoId(location.href);
  if (videoId === reported) {
    return;
  }
  reported = videoId;

  const message: VideoDetectedMessage = { type: 'video-detected', videoId, url: location.href };
  // Rejects when no service worker is listening (extension reloading, or
  // being uninstalled). Nothing here can recover from that, and the worker
  // recomputes from tab.url when it next needs the value.
  void chrome.runtime.sendMessage(message).catch(() => undefined);
}

document.addEventListener('yt-navigate-finish', report);
// Back/forward within the SPA, and a safety net if YouTube renames its event.
window.addEventListener('popstate', report);

report();
