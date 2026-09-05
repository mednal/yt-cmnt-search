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

/**
 * Formats a vector as a pgvector literal: `[0.1,0.2,...]`.
 *
 * Sent as text and cast with `::vector` in SQL, because the `pg` driver has
 * no native encoder for the extension's type.
 */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
