/**
 * Side panel: which video is open, how much of it is indexed, and search.
 *
 * The panel is the only driver of the backend's bounded step endpoints, so
 * indexing progresses exactly as long as this panel is open on the video
 * (IMPLEMENTATION_PLAN.md §2). Everything it starts is resumable, so leaving
 * mid-run costs nothing but the work that was left.
 */
import type { SearchMode, SearchResponse, VideoJobStatus } from '@yca/shared';

import { API_BASE_URL, SEARCH_PAGE_SIZE } from '../config.ts';
import { NO_VIDEO, sameVideo, type ActiveVideo, type ExtensionMessage } from '../messaging.ts';

import { ApiError, fetchHealth, fetchVideoStatus, search } from './api.ts';
import { byId, note, row } from './dom.ts';
import { formatCount } from './format.ts';
import { IndexingRun, type IndexingProgress } from './indexing.ts';
import { resultItem } from './results.ts';

const elements = {
  backendBadge: byId('backend-badge'),
  videoState: byId('video-state'),
  videoId: byId('video-id'),
  videoTitle: byId('video-title'),
  videoDetails: byId('video-details'),
  status: byId('status'),
  statusBody: byId('status-body'),
  refresh: byId<HTMLButtonElement>('refresh'),
  index: byId<HTMLButtonElement>('index'),
  stop: byId<HTMLButtonElement>('stop'),
  indexNote: byId('index-note'),
  search: byId('search'),
  searchForm: byId<HTMLFormElement>('search-form'),
  query: byId<HTMLInputElement>('query'),
  submit: byId<HTMLButtonElement>('submit'),
  coverage: byId('coverage'),
  results: byId('results'),
  resultsTitle: byId('results-title'),
  resultsState: byId('results-state'),
  resultsList: byId('results-list'),
  loadMore: byId<HTMLButtonElement>('load-more'),
};

let current: ActiveVideo = NO_VIDEO;
let status: VideoJobStatus | null = null;
/** Guards against a slow response for a video the user has already left. */
let statusRequestId = 0;

let run: IndexingRun | null = null;

/** The search currently on screen — what "Load more" continues. */
interface SearchState {
  query: string;
  mode: SearchMode;
  /** Results already rendered. */
  loaded: number;
  total: number;
}
let currentSearch: SearchState | null = null;
let searchRequestId = 0;
let inFlight: AbortController | null = null;

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

elements.index.addEventListener('click', () => void startIndexing());
elements.stop.addEventListener('click', () => run?.cancel());

elements.searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void runSearch(elements.query.value, selectedMode(), { append: false });
});

for (const radio of modeRadios()) {
  radio.addEventListener('change', () => {
    renderCoverage();
    // Re-running on a mode switch is the point of the toggle: the same
    // question, asked the other way.
    if (elements.query.value.trim()) {
      void runSearch(elements.query.value, selectedMode(), { append: false });
    }
  });
}

elements.loadMore.addEventListener('click', () => {
  if (currentSearch) {
    void runSearch(currentSearch.query, currentSearch.mode, { append: true });
  }
});

void start();

async function start(): Promise<void> {
  const video = (await chrome.runtime.sendMessage({ type: 'get-active-video' })) as
    | ActiveVideo
    | undefined;
  applyVideo(video ?? NO_VIDEO, { force: true });
  await refreshBackendBadge();
}

// --- active video ---------------------------------------------------------

function applyVideo(video: ActiveVideo, options: { force?: boolean } = {}): void {
  const changed = !sameVideo(current, video);
  current = video;
  renderVideo(video);

  if (changed || options.force) {
    // Results, and any indexing, belong to the video that is leaving.
    run?.cancel();
    run = null;
    clearSearch();
    void loadStatus(video.videoId);
  }
}

function renderVideo(video: ActiveVideo): void {
  const onVideo = video.videoId !== null;
  elements.videoDetails.hidden = !onVideo;
  elements.refresh.disabled = !onVideo;
  elements.search.hidden = !onVideo;

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

// --- indexing -------------------------------------------------------------

async function loadStatus(videoId: string | null): Promise<void> {
  const requestId = ++statusRequestId;
  if (videoId === null) {
    elements.status.hidden = true;
    status = null;
    return;
  }

  elements.status.hidden = false;
  elements.statusBody.replaceChildren(note('Loading status…'));

  try {
    const loaded = await fetchVideoStatus(videoId);
    if (requestId === statusRequestId) {
      status = loaded;
      renderStatus(loaded);
    }
  } catch (error) {
    if (requestId === statusRequestId) {
      status = null;
      renderStatusError(error);
    }
  }
}

function renderStatus(job: VideoJobStatus): void {
  const rows: Array<[string, string]> = [
    ['Comments stored', formatCount(job.commentCount)],
    ['Ingest', describeState(job.ingestState)],
    ['Embedded', `${formatCount(job.embeddedCount)} of ${formatCount(job.commentCount)}`],
    ['Embedding', describeState(job.embedState)],
  ];

  elements.statusBody.replaceChildren(
    ...rows.map(([label, value]) => row(label, value)),
    ...(job.lastError ? [note(`Last error: ${job.lastError}`, 'note--error')] : []),
  );

  renderControls();
}

function renderStatusError(error: unknown): void {
  elements.statusBody.replaceChildren(
    note(describeApiError(error, 'Could not load status'), 'note--error'),
  );
  renderControls();
}

/** Everything whose enabled state depends on how far indexing has got. */
function renderControls(): void {
  renderIndexButton();
  renderCoverage();

  const empty = (status?.commentCount ?? 0) === 0;
  elements.query.disabled = empty;
  elements.submit.disabled = empty;
}

function renderIndexButton(): void {
  const running = run !== null;
  elements.stop.hidden = !running;
  elements.index.hidden = running;

  if (status === null) {
    elements.index.disabled = true;
    elements.index.textContent = 'Index this video';
    return;
  }

  const indexed =
    status.ingestState === 'complete' &&
    status.commentCount > 0 &&
    status.embeddedCount === status.commentCount;

  elements.index.disabled = indexed;
  elements.index.textContent = indexed
    ? 'Indexed'
    : status.commentCount > 0
      ? 'Resume indexing'
      : 'Index this video';
}

async function startIndexing(): Promise<void> {
  const videoId = current.videoId;
  if (videoId === null || run !== null) {
    return;
  }

  const started = new IndexingRun(
    videoId,
    onIndexingProgress,
    status?.commentCount ?? 0,
    status?.embeddedCount ?? 0,
  );
  run = started;
  setIndexNote('Starting…');
  renderIndexButton();

  try {
    const outcome = await started.run();
    if (run !== started) {
      return; // The user moved on; this run's result is no longer on screen.
    }
    setIndexNote(outcome === 'complete' ? 'Indexing complete.' : 'Stopped — progress is saved.');
  } catch (error) {
    if (run !== started) {
      return;
    }
    setIndexNote(describeApiError(error, 'Indexing failed'), 'note--error');
  } finally {
    if (run === started) {
      run = null;
      await loadStatus(videoId);
    }
  }
}

function onIndexingProgress(progress: IndexingProgress): void {
  if (progress.phase === 'ingesting') {
    setIndexNote(`Fetching comments — ${formatCount(progress.commentCount)} stored so far…`);
  } else {
    setIndexNote(
      `Embedding — ${formatCount(progress.embeddedCount)} of ${formatCount(progress.commentCount)}…`,
    );
  }

  // Keyword search works on whatever is stored, so the panel opens up as soon
  // as the first page lands rather than at the end of the run.
  if (status !== null) {
    status = {
      ...status,
      commentCount: progress.commentCount,
      embeddedCount: progress.embeddedCount,
    };
    renderControls();
  }
}

function setIndexNote(text: string, modifier?: string): void {
  elements.indexNote.hidden = false;
  elements.indexNote.className = modifier ? `note ${modifier}` : 'note';
  elements.indexNote.textContent = text;
}

// --- search ---------------------------------------------------------------

/** What the selected mode can see, given how far indexing has got. */
function renderCoverage(): void {
  if (status === null) {
    elements.coverage.hidden = true;
    return;
  }

  elements.coverage.hidden = false;
  if (status.commentCount === 0) {
    elements.coverage.textContent = 'Nothing stored yet — index the video to search it.';
    return;
  }

  elements.coverage.textContent =
    selectedMode() === 'semantic'
      ? `Semantic search covers ${formatCount(status.embeddedCount)} of ${formatCount(status.commentCount)} comments so far.`
      : `Keyword search covers the ${formatCount(status.commentCount)} comments stored so far.`;
}

async function runSearch(
  rawQuery: string,
  mode: SearchMode,
  options: { append: boolean },
): Promise<void> {
  const videoId = current.videoId;
  const query = rawQuery.trim();
  if (videoId === null || !query) {
    return;
  }

  const offset = options.append && currentSearch ? currentSearch.loaded : 0;
  const requestId = ++searchRequestId;
  inFlight?.abort();
  const controller = new AbortController();
  inFlight = controller;

  elements.results.hidden = false;
  if (options.append) {
    elements.loadMore.disabled = true;
    elements.loadMore.textContent = 'Loading…';
  } else {
    elements.resultsList.replaceChildren();
    elements.loadMore.hidden = true;
    elements.resultsTitle.textContent = 'Results';
    elements.resultsState.replaceChildren(note('Searching…'));
  }

  try {
    const response = await search({
      videoId,
      query,
      mode,
      offset,
      limit: SEARCH_PAGE_SIZE,
      signal: controller.signal,
    });
    if (requestId === searchRequestId) {
      renderSearchResponse(response, options.append);
    }
  } catch (error) {
    if (requestId !== searchRequestId || controller.signal.aborted) {
      return; // Superseded by a newer search.
    }
    renderSearchError(error, options.append);
  } finally {
    if (inFlight === controller) {
      inFlight = null;
    }
  }
}

function renderSearchResponse(response: SearchResponse, append: boolean): void {
  const loaded = (append ? (currentSearch?.loaded ?? 0) : 0) + response.results.length;
  currentSearch = {
    query: response.query,
    mode: response.mode,
    loaded,
    total: response.total,
  };

  const items = response.results.map((item) => resultItem(item, response.mode));
  if (append) {
    elements.resultsList.append(...items);
  } else {
    elements.resultsList.replaceChildren(...items);
  }

  elements.resultsState.replaceChildren(...(loaded === 0 ? [note(emptyMessage(response))] : []));
  elements.resultsTitle.textContent =
    loaded === 0 ? 'No results' : `Showing ${formatCount(loaded)} of ${formatCount(response.total)}`;

  elements.loadMore.hidden = loaded === 0 || loaded >= response.total;
  elements.loadMore.disabled = false;
  elements.loadMore.textContent = 'Load more';
}

/**
 * Semantic mode ranks only embedded comments, so "nothing found" there often
 * means "nothing embedded yet" — a different problem with a different fix.
 */
function emptyMessage(response: SearchResponse): string {
  if (response.mode === 'semantic' && (status?.embeddedCount ?? 0) === 0) {
    return 'No comments are embedded yet — run indexing, or search by keyword meanwhile.';
  }
  return `No comments match "${response.query}".`;
}

function renderSearchError(error: unknown, append: boolean): void {
  elements.resultsState.replaceChildren(
    note(describeApiError(error, 'Search failed'), 'note--error'),
  );
  if (!append) {
    elements.resultsTitle.textContent = 'Results';
    elements.resultsList.replaceChildren();
  }
  elements.loadMore.disabled = false;
  elements.loadMore.textContent = 'Load more';
}

function clearSearch(): void {
  searchRequestId++;
  inFlight?.abort();
  inFlight = null;
  currentSearch = null;
  elements.results.hidden = true;
  elements.resultsList.replaceChildren();
  elements.resultsState.replaceChildren();
  elements.loadMore.hidden = true;
  elements.indexNote.hidden = true;
}

function selectedMode(): SearchMode {
  return modeRadios().find((radio) => radio.checked)?.value === 'semantic' ? 'semantic' : 'keyword';
}

function modeRadios(): HTMLInputElement[] {
  return [...elements.searchForm.querySelectorAll<HTMLInputElement>('input[name="mode"]')];
}

// --- shared ---------------------------------------------------------------

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

function describeApiError(error: unknown, prefix: string): string {
  if (error instanceof ApiError && error.failure === 'unreachable') {
    return `Backend not reachable at ${API_BASE_URL} (${error.message}). Start it with: npm start -w @yca/backend`;
  }
  return `${prefix}: ${error instanceof Error ? error.message : String(error)}`;
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
