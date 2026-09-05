/**
 * Formats a vector as a pgvector literal: `[0.1,0.2,...]`.
 *
 * Sent as text and cast with `::vector` in SQL, because the `pg` driver has
 * no native encoder for the extension's type. Used by both the write side
 * (storing comment embeddings) and the read side (semantic search), so it
 * lives with the database layer rather than with either of them.
 */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
