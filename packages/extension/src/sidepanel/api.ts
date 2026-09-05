/**
 * Thin client for the backend, used by the side panel.
 *
 * Only the calls M7 needs: health, and one video's job status. Search lands
 * here at M8, together with the ingest/embed step calls the panel drives.
 */
import type { VideoJobStatus } from '@yca/shared';

import { API_BASE_URL, REQUEST_TIMEOUT_MS } from '../config.ts';

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

async function request<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // A timeout, a refused connection and a DNS failure are the same thing to
    // the user: nothing is answering at API_BASE_URL.
    throw new ApiError(describe(error), 'unreachable');
  }

  if (!response.ok) {
    throw new ApiError(`${response.status} ${response.statusText}`.trim(), 'http', response.status);
  }

  return (await response.json()) as T;
}

function describe(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return `no response within ${REQUEST_TIMEOUT_MS / 1000}s`;
  }
  return error instanceof Error ? error.message : String(error);
}
