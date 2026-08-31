-- Comments and per-video job state.
--
-- Ingestion and embedding are two independently resumable operations, so
-- video_jobs tracks each with its own state column and progress counter.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS comments (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    youtube_comment_id TEXT        NOT NULL UNIQUE,
    video_id           TEXT        NOT NULL,
    author             TEXT        NOT NULL,
    author_channel_id  TEXT,
    text               TEXT        NOT NULL,
    like_count         INTEGER     NOT NULL DEFAULT 0,
    published_at       TIMESTAMPTZ,
    updated_at         TIMESTAMPTZ,
    parent_comment_id  TEXT,
    -- NULL until the embedding step has processed the row. That predicate is
    -- the embedding work queue; see the partial index below.
    embedding          vector(1536)
);

CREATE INDEX IF NOT EXISTS comments_video_id_idx
    ON comments (video_id);

-- Supports resolving a reply back to the thread it belongs to (M9 jump-to).
CREATE INDEX IF NOT EXISTS comments_parent_comment_id_idx
    ON comments (parent_comment_id)
    WHERE parent_comment_id IS NOT NULL;

-- Keyword search (M4). The expression must match the query's to_tsvector call
-- exactly, including the 'english' configuration, for the index to be used.
CREATE INDEX IF NOT EXISTS comments_text_fts_idx
    ON comments USING GIN (to_tsvector('english', text));

-- Drives one embedding batch per call: "next N rows for this video with no
-- vector yet". Stays small because rows leave the index once embedded.
CREATE INDEX IF NOT EXISTS comments_pending_embedding_idx
    ON comments (video_id, id)
    WHERE embedding IS NULL;

CREATE TABLE IF NOT EXISTS video_jobs (
    video_id          TEXT PRIMARY KEY,

    ingest_state      TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (ingest_state IN ('pending', 'running', 'complete', 'error')),
    -- YouTube nextPageToken: where the next ingest step resumes fetching.
    ingest_page_token TEXT,
    comment_count     INTEGER     NOT NULL DEFAULT 0,

    embed_state       TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (embed_state IN ('pending', 'running', 'complete', 'error')),
    embedded_count    INTEGER     NOT NULL DEFAULT 0,

    last_error        TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Staleness clock: a 'running' row older than the threshold is reclaimable,
    -- so a crashed process never wedges a video permanently.
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
