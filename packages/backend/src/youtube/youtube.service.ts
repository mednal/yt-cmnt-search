import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  CommentPage,
  FetchedComment,
  YoutubeCommentResource,
  YoutubeCommentThreadItem,
  YoutubeCommentThreadsResponse,
} from './youtube.types';

const COMMENT_THREADS_URL =
  'https://www.googleapis.com/youtube/v3/commentThreads';

/** One page of `commentThreads.list` results. */
const PAGE_SIZE = 100;

/**
 * A mapped, known failure from the YouTube API (quota exceeded, comments
 * disabled, invalid video id, ...). `message` is safe to store as
 * `video_jobs.last_error` — it is either YouTube's own error message or a
 * plain description, never a raw stack trace.
 */
export class YoutubeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'YoutubeApiError';
  }
}

/**
 * Thin wrapper over `commentThreads.list`.
 *
 * Uses the platform `fetch` (Node 20+) rather than the `googleapis` SDK —
 * one REST call does not justify a new dependency.
 */
@Injectable()
export class YoutubeService {
  constructor(private readonly config: ConfigService) {}

  async listCommentThreads(
    videoId: string,
    pageToken: string | null,
  ): Promise<CommentPage> {
    const apiKey = this.config.get<string>('YOUTUBE_API_KEY');
    if (!apiKey) {
      throw new YoutubeApiError('YOUTUBE_API_KEY is not configured', 500);
    }

    const url = new URL(COMMENT_THREADS_URL);
    url.searchParams.set('part', 'snippet,replies');
    url.searchParams.set('videoId', videoId);
    url.searchParams.set('maxResults', String(PAGE_SIZE));
    url.searchParams.set('textFormat', 'plainText');
    url.searchParams.set('key', apiKey);
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }

    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      throw new YoutubeApiError(
        `Could not reach YouTube: ${error instanceof Error ? error.message : String(error)}`,
        502,
      );
    }

    if (!response.ok) {
      throw new YoutubeApiError(
        await describeApiError(response),
        response.status,
      );
    }

    const data = (await response.json()) as YoutubeCommentThreadsResponse;
    return {
      comments: data.items.flatMap(flattenThread),
      nextPageToken: data.nextPageToken ?? null,
    };
  }
}

/** Pulls YouTube's own error message out of the response body, if present. */
async function describeApiError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;

  return body?.error?.message ?? `YouTube API responded ${response.status}`;
}

function flattenThread(item: YoutubeCommentThreadItem): FetchedComment[] {
  const topLevelId = item.snippet.topLevelComment.id;
  const top = toFetchedComment(item.snippet.topLevelComment, null);
  const replies = (item.replies?.comments ?? []).map((reply) =>
    toFetchedComment(reply, topLevelId),
  );
  return [top, ...replies];
}

function toFetchedComment(
  resource: YoutubeCommentResource,
  parentCommentId: string | null,
): FetchedComment {
  return {
    youtubeCommentId: resource.id,
    author: resource.snippet.authorDisplayName,
    authorChannelId: resource.snippet.authorChannelId?.value ?? null,
    text: resource.snippet.textOriginal,
    likeCount: resource.snippet.likeCount,
    publishedAt: resource.snippet.publishedAt,
    updatedAt: resource.snippet.updatedAt,
    parentCommentId,
  };
}
