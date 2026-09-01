/**
 * Raw shapes from the YouTube Data API v3 `commentThreads.list` endpoint.
 *
 * Only the fields this project reads are declared — the real response has
 * more.
 */

export interface YoutubeCommentSnippet {
  authorDisplayName: string;
  authorChannelId?: { value: string };
  textOriginal: string;
  likeCount: number;
  publishedAt: string;
  updatedAt: string;
}

export interface YoutubeCommentResource {
  id: string;
  snippet: YoutubeCommentSnippet;
}

export interface YoutubeCommentThreadItem {
  id: string;
  snippet: {
    topLevelComment: YoutubeCommentResource;
    totalReplyCount: number;
  };
  /**
   * Inline replies YouTube returns with the thread (a handful at most). Full
   * pagination of deep reply threads would need a separate `comments.list`
   * call per thread — out of scope for M3; see IMPLEMENTATION_PLAN.md M3.
   */
  replies?: { comments: YoutubeCommentResource[] };
}

export interface YoutubeCommentThreadsResponse {
  items: YoutubeCommentThreadItem[];
  nextPageToken?: string;
}

/** One comment flattened into the shape the ingest step writes to Postgres. */
export interface FetchedComment {
  youtubeCommentId: string;
  author: string;
  authorChannelId: string | null;
  text: string;
  likeCount: number;
  publishedAt: string;
  updatedAt: string;
  /** `null` for a top-level comment; the thread's top-level comment id for a reply. */
  parentCommentId: string | null;
}

/** Result of one page fetch, already flattened. */
export interface CommentPage {
  comments: FetchedComment[];
  nextPageToken: string | null;
}
