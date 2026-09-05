/**
 * Service worker: owns "which video is the panel looking at".
 *
 * MV3 kills this worker between events, so nothing is kept in module scope
 * that matters after it exits — the tab → video map lives in
 * `chrome.storage.session`, and every answer is recomputed from the active
 * tab on demand.
 */
import { NO_VIDEO, type ActiveVideo, type ExtensionMessage } from '../messaging.ts';
import { parseVideoId } from '../video-id.ts';

/** `chrome.storage.session` key: `{ [tabId]: videoId }`, cleared on restart. */
const TAB_VIDEOS_KEY = 'tabVideos';

type TabVideos = Record<string, string>;

// Clicking the toolbar icon opens the side panel. Chrome requires this to be
// registered from the worker; doing it at top level re-applies it on every
// wake, which is idempotent.
void chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => undefined);

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  if (message.type === 'video-detected') {
    const tabId = sender.tab?.id;
    if (tabId !== undefined) {
      void rememberVideo(tabId, message.videoId).then(() => broadcastActiveVideo());
    }
    return false;
  }

  if (message.type === 'get-active-video') {
    // Returning true keeps the message channel open for the async reply.
    void resolveActiveVideo().then(sendResponse);
    return true;
  }

  return false;
});

// The panel follows the active tab, so any of these can change what it shows.
chrome.tabs.onActivated.addListener(() => void broadcastActiveVideo());
chrome.windows.onFocusChanged.addListener(() => void broadcastActiveVideo());
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url !== undefined || changeInfo.title !== undefined) {
    void broadcastActiveVideo();
  }
});
chrome.tabs.onRemoved.addListener((tabId) => void forgetTab(tabId));

/**
 * The video shown by the active tab of the last focused window.
 *
 * Prefers what the content script reported, because on a SPA navigation the
 * content script fires before `tab.url` is guaranteed to be updated; falls
 * back to parsing the tab URL, which covers a cold worker, a tab loaded
 * before the extension was installed, and pages where injection failed.
 */
async function resolveActiveVideo(): Promise<ActiveVideo> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) {
    return NO_VIDEO;
  }

  const videos = await readTabVideos();
  const reported = videos[String(tab.id)];

  return {
    tabId: tab.id,
    url: tab.url ?? null,
    title: tab.title ?? null,
    videoId: reported ?? parseVideoId(tab.url),
  };
}

async function broadcastActiveVideo(): Promise<void> {
  const video = await resolveActiveVideo();
  // Rejects when the panel is closed — that is the normal case, not an error.
  await chrome.runtime
    .sendMessage({ type: 'active-video-changed', video })
    .catch(() => undefined);
}

async function rememberVideo(tabId: number, videoId: string | null): Promise<void> {
  const videos = await readTabVideos();
  if (videoId === null) {
    delete videos[String(tabId)];
  } else {
    videos[String(tabId)] = videoId;
  }
  await chrome.storage.session.set({ [TAB_VIDEOS_KEY]: videos });
}

async function forgetTab(tabId: number): Promise<void> {
  const videos = await readTabVideos();
  if (videos[String(tabId)] === undefined) {
    return;
  }
  delete videos[String(tabId)];
  await chrome.storage.session.set({ [TAB_VIDEOS_KEY]: videos });
}

async function readTabVideos(): Promise<TabVideos> {
  const stored = await chrome.storage.session.get(TAB_VIDEOS_KEY);
  return (stored[TAB_VIDEOS_KEY] as TabVideos | undefined) ?? {};
}
