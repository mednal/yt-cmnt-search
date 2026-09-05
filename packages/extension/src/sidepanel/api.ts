/**
 * Thin client for the backend, used by the side panel.
 *
 * Every backend call the panel makes lives here: health, one video's job
 * status, search, and the two bounded step endpoints the panel drives to
 * completion (IMPLEMENTATION_PLAN.md §2).
 */
import type {
  EmbedStepResponse,
  IngestStepResponse,
  SearchMode,
  SearchResponse,
  VideoJobStatus,
} from '@yca/shared';

import { API_BASE_URL, REQUEST_TIMEOUT_MS, SEARCH_PAGE_SIZE, STEP_TIMEOUT_MS } from '../config.ts';

/** Why a call failed, in the terms the panel renders. */
export type ApiFailure = 'unreachable' | 'http';

export class ApiError extends Error {
  readonly failure: ApiFailure;
  readonly status: number | undefined;

  constructor(message: string, failure: ApiFailure, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.failure = failure;
    this.status = status;
  }
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  uptime: number;
  database: { status: string; error?: string | null };
}

export function fetchHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/health');
}

export function fetchVideoStatus(videoId: string): Promise<VideoJobStatus> {
  return request<VideoJobStatus>(`/videos/${encodeURIComponent(videoId)}/status`);
}

export interface SearchParams {
  videoId: string;
  query: string;
  mode: SearchMode;
  offset?: number;
  limit?: number;
  /** Lets the panel drop a search the user has already replaced. */
  signal?: AbortSignal;
}

export function search(params: SearchParams): Promise<SearchResponse> {
  const query = new URLSearchParams({
    q: params.query,
    mode: params.mode,
    limit: String(params.limit ?? SEARCH_PAGE_SIZE),
    offset: String(params.offset ?? 0),
  });

  return request<SearchResponse>(
    `/videos/${encodeURIComponent(params.videoId)}/search?${query.toString()}`,
    { signal: params.signal },
  );
}

/** One page of comments. Call again while `done` is `false`. */
export function runIngestStep(videoId: string): Promise<IngestStepResponse> {
  return step<IngestStepResponse>(videoId, 'ingest');
}

/** One batch of embeddings. Call again while `done` is `false`. */
export function runEmbedStep(videoId: string): Promise<EmbedStepResponse> {
  return step<EmbedStepResponse>(videoId, 'embed');
}

function step<T>(videoId: string, name: 'ingest' | 'embed'): Promise<T> {
  return request<T>(`/videos/${encodeURIComponent(videoId)}/${name}`, {
    method: 'POST',
    timeoutMs: STEP_TIMEOUT_MS,
  });
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  timeoutMs?: number;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    });
  } catch (error) {
    // The caller's own abort is not a backend failure — it propagates as
    // itself so a superseded search is discarded rather than rendered as an
    // error.
    if (options.signal?.aborted) {
      throw error;
    }
    // A timeout, a refused connection and a DNS failure are the same thing to
    // the user: nothing is answering at API_BASE_URL.
    throw new ApiError(describe(error), 'unreachable');
  }

  if (!response.ok) {
    throw new ApiError(await describeHttp(response), 'http', response.status);
  }

  return (await response.json()) as T;
}

function describe(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return 'the request timed out';
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Nest puts the useful part of a failure in the body ("Query parameter ...",
 * a YouTube quota message), so a bare "400 Bad Request" would hide exactly
 * what the user needs to act on.
 */
async function describeHttp(response: Response): Promise<string> {
  const fallback = `${response.status} ${response.statusText}`.trim();
  try {
    const body = (await response.json()) as { message?: unknown };
    const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    return typeof message === 'string' && message ? message : fallback;
  } catch {
    return fallback;
  }
}
