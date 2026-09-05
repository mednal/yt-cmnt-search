-- Narrow comments.embedding from 1536 to 384 dimensions.
--
-- Embeddings now come from a local ONNX model (Xenova/gte-small, 384 dims)
-- instead of OpenAI's text-embedding-3-small (1536), so the project has no
-- per-comment cost and needs no API key.
--
-- Vector width is part of the column type, so the model choice and the schema
-- have to move together: switching providers again means another migration.
--
-- No USING clause on purpose. Every embedding was still NULL when this was
-- written, so there is nothing to convert; on a database that does hold
-- 1536-dimension vectors this fails loudly instead of quietly discarding
-- them, which is the right outcome — the operator should decide.

ALTER TABLE comments
    ALTER COLUMN embedding TYPE vector(384);
