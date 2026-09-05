/**
 * Side panel (M7 shell).
 *
 * Shows which video the active tab is on and what the backend has done with
 * it so far. The search box, and the loop that drives ingest and embed steps
 * to completion, are M8 — this milestone only proves the panel tracks the
 * video across navigations and can reach the backend.
 */
import type { VideoJobStatus } from '@yca/shared';

import { API_BASE_URL } from '../config.ts';
import { NO_VIDEO, sameVideo, type ActiveVideo, type ExtensionMessage } from '../messaging.ts';

import { ApiError, fetchHealth, fetchVideoStatus } from './api.ts';

const elements = {
  backendBadge: byId('backend-badge'),
  videoState: byId('video-state'),
  videoId: byId('video-id'),
  videoTitle: byId('video-title'),
  videoDetails: byId('video-details'),
  status: byId('status'),
  statusBody: byId('status-body'),
  refresh: byId('refresh') as HTMLButtonElement,
};

let current: ActiveVideo = NO_VIDEO;
/** Guards against a slow response for a video the user has already left. */
let statusRequestId = 0;

chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === 'active-video-changed') {
    applyVideo(message.video);
  }
  return false;
});

elements.refresh.addEventListener('click', () => {
  void refreshBackendBadge();
  void loadStatus(current.videoId);
});

void start();

async function start(): Promise<void> {
  const video = (await chrome.runtime.sendMessage({ type: 'get-active-video' })) as
    | ActiveVideo
    | undefined;
  applyVideo(video ?? NO_VIDEO, { force: true });
  await refreshBackendBadge();
}

function applyVideo(video: ActiveVideo, options: { force?: boolean } = {}): void {
  const changed = !sameVideo(current, video);
  current = video;
  renderVideo(video);

  if (changed || options.force) {
    void loadStatus(video.videoId);
  }
}

function renderVideo(video: ActiveVideo): void {
  const onVideo = video.videoId !== null;
  elements.videoDetails.hidden = !onVideo;
  elements.refresh.disabled = !onVideo;

  if (onVideo) {
    elements.videoState.textContent = 'Video detected';
    elements.videoId.textContent = video.videoId;
    elements.videoTitle.textContent = cleanTitle(video.title);
    return;
  }

  elements.videoState.textContent = 'Open a YouTube video to search its comments.';
  elements.videoId.textContent = '';
  elements.videoTitle.textContent = '';
}

async function loadStatus(videoId: string | null): Promise<void> {
  const requestId = ++statusRequestId;
  if (videoId === null) {
    elements.status.hidden = true;
    return;
  }

  elements.status.hidden = false;
  elements.statusBody.replaceChildren(note('Loading status…'));

  try {
    const status = await fetchVideoStatus(videoId);
    if (requestId === statusRequestId) {
      renderStatus(status);
    }
  } catch (error) {
    if (requestId === statusRequestId) {
      renderStatusError(error);
    }
  }
}

function renderStatus(status: VideoJobStatus): void {
  const rows: Array<[string, string]> = [
    ['Comments stored', String(status.commentCount)],
    ['Ingest', describeState(status.ingestState)],
    ['Embedded', `${status.embeddedCount} of ${status.commentCount}`],
    ['Embedding', describeState(status.embedState)],
  ];

  elements.statusBody.replaceChildren(
    ...rows.map(([label, value]) => row(label, value)),
    ...(status.lastError ? [note(`Last error: ${status.lastError}`, 'note--error')] : []),
    ...(status.commentCount === 0
      ? [note('No comments fetched for this video yet — ingestion is driven from the panel in M8.')]
      : []),
  );
}

function renderStatusError(error: unknown): void {
  const message =
    error instanceof ApiError && error.failure === 'unreachable'
      ? `Backend not reachable at ${API_BASE_URL} (${error.message}). Start it with: npm start -w @yca/backend`
      : `Could not load status: ${error instanceof Error ? error.message : String(error)}`;

  elements.statusBody.replaceChildren(note(message, 'note--error'));
}

async function refreshBackendBadge(): Promise<void> {
  setBadge('checking…', 'badge--pending');
  try {
    const health = await fetchHealth();
    const ok = health.status === 'ok';
    setBadge(ok ? 'backend ok' : 'backend degraded', ok ? 'badge--ok' : 'badge--warn');
  } catch {
    setBadge('backend offline', 'badge--error');
  }
}

function setBadge(text: string, modifier: string): void {
  elements.backendBadge.textContent = text;
  elements.backendBadge.className = `badge ${modifier}`;
}

function describeState(state: VideoJobStatus['ingestState']): string {
  return {
    pending: 'not started',
    running: 'in progress',
    complete: 'complete',
    error: 'failed',
  }[state];
}

/** Chrome reports the tab title as "Video name - YouTube". */
function cleanTitle(title: string | null): string {
  return (title ?? '').replace(/\s*-\s*YouTube$/, '');
}

function row(label: string, value: string): HTMLElement {
  const element = document.createElement('div');
  element.className = 'row';

  const key = document.createElement('span');
  key.className = 'row__label';
  key.textContent = label;

  const val = document.createElement('span');
  val.className = 'row__value';
  val.textContent = value;

  element.append(key, val);
  return element;
}

function note(text: string, modifier?: string): HTMLElement {
  const element = document.createElement('p');
  element.className = modifier ? `note ${modifier}` : 'note';
  element.textContent = text;
  return element;
}

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`sidepanel.html is missing #${id}`);
  }
  return element;
}
