/** A comment awaiting a vector, as selected by one embed step. */
export interface PendingCommentRow {
  /** `comments.id` — a bigint, which `pg` hands back as a string. */
  id: string;
  text: string;
}

/** Progress for one video, recounted from `comments` after every batch. */
export interface EmbedProgressRow {
  /** Counts come back from `pg` as strings (bigint). */
  embedded: string;
  remaining: string;
}
