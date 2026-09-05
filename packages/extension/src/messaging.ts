/**
 * Messages exchanged between the content script, the service worker and the
 * side panel.
 *
 * All three run in separate contexts, so this file is the only place the
 * shapes are defined; every `chrome.runtime` payload in the extension is one
 * of these unions.
 */

/** The video the panel should be showing, as resolved by the service worker. */
export interface ActiveVideo {
  /** Tab the panel is following, or `null` when no tab could be read. */
  tabId: number | null;
  url: string | null;
  title: string | null;
  /** `null` when the active tab is not a YouTube video page. */
  videoId: string | null;
}

/** Content script → service worker: this tab now shows (or left) a video. */
export interface VideoDetectedMessage {
  type: 'video-detected';
  videoId: string | null;
  url: string;
}

/** Side panel → service worker: what should I be showing right now? */
export interface GetActiveVideoMessage {
  type: 'get-active-video';
}

/** Service worker → side panel: the active video changed. */
export interface ActiveVideoChangedMessage {
  type: 'active-video-changed';
  video: ActiveVideo;
}

export type ExtensionMessage =
  | VideoDetectedMessage
  | GetActiveVideoMessage
  | ActiveVideoChangedMessage;

export const NO_VIDEO: ActiveVideo = {
  tabId: null,
  url: null,
  title: null,
  videoId: null,
};

/** `true` when both describe the same video in the same tab. */
export function sameVideo(a: ActiveVideo, b: ActiveVideo): boolean {
  return a.tabId === b.tabId && a.videoId === b.videoId && a.url === b.url;
}
