# YouTube Comment AI — Implementation Plan

Status: **M0, M1, M2 complete — M3 next**
Last updated: 2026-08-31

---

## 1. Locked decisions

These are decided. They are not re-opened during implementation.

| # | Area | Decision |
|---|------|----------|
| 1 | Embeddings | OpenAI `text-embedding-3-small` (1536 dims) |
| 2 | Provider abstraction | `EmbeddingProvider` interface; OpenAI is one implementation, swappable later |
| 3 | Database | PostgreSQL + `pgvector`, accessed with the plain `pg` driver and raw SQL — no ORM |
| 4 | Backend | NestJS (Node.js, TypeScript) |
| 5 | Extension | Chrome Manifest V3 + Side Panel API |
| 6 | Extension UI | Vanilla TypeScript + CSS — no React, no framework |
| 7 | Repo layout | npm workspaces monorepo |
| 8 | Out of scope | No auth, payments, subscriptions, Redis, queues, message brokers, or extra infrastructure |
| 9 | AI scope | No summaries, no clustering, no sentiment, no agents — not until keyword + semantic search both work end to end |
| 10 | Ingestion model | Ingestion and embedding are **two separate, independently resumable operations**. Never fetch-and-embed in one request. |

### Supporting choices

- **Migrations:** numbered plain-SQL files run by a small migration runner. Schema drift stays visible in git.
- **Comment source:** YouTube Data API v3 `commentThreads.list`. Official, keyed, quota-bounded. No scraping.
- **Embedding batching:** up to 96 comments per OpenAI request, written to the DB after each batch so a failure never loses completed work.
- **Extension build:** `esbuild` only. One dependency, no bundler config.

---

## 2. Resumable ingestion + embedding (decision 10)

No queue, no Redis. Resumability comes from **durable state in Postgres** plus **bounded, re-entrant work steps**. Each call does a slice of work, persists progress, and returns whether more remains. The caller (side panel, or curl) drives it to completion by calling again.

`video_jobs` table, one row per video:

| column | purpose |
|---|---|
| `video_id` | primary key |
| `ingest_state` | pending / running / complete / error |
| `ingest_page_token` | YouTube `nextPageToken` — where to resume fetching |
| `comment_count` | comments stored so far |
| `embed_state` | pending / running / complete / error |
| `embedded_count` | comments with a vector |
| `last_error` | last failure message, cleared on success |
| `updated_at` | staleness / stuck-job recovery |

**Ingest step** — `POST /videos/:videoId/ingest`
Fetches N pages (default 1) starting at `ingest_page_token`, upserts comments by `youtube_comment_id`, saves the new token, returns `{ state, commentCount, done }`. A crash mid-run loses at most one page; the next call resumes from the stored token. Idempotent by unique constraint.

**Embed step** — `POST /videos/:videoId/embed`
Selects up to one batch of comments for the video `WHERE embedding IS NULL`, embeds them, writes the vectors, returns `{ state, embeddedCount, remaining, done }`. The `embedding IS NULL` predicate *is* the work queue — no cursor to corrupt, and no paying OpenAI twice for work already done.

**Status** — `GET /videos/:videoId/status` returns the whole row so the panel can poll and decide what to call next.

A `running` row older than a staleness threshold is reclaimable, so a crashed process never wedges a video permanently.

Consequence: search works on partial data. Keyword search is usable after the first ingest page; semantic search covers whatever is embedded so far, and the panel says so.

---

## 3. Target architecture

```
youtube-comment-search/            (npm workspaces root)
├─ packages/
│  ├─ backend/      NestJS API
│  ├─ extension/    Chrome MV3 side panel
│  └─ shared/       TypeScript types shared by both (API request/response contracts)
├─ docker-compose.yml              Postgres + pgvector
└─ IMPLEMENTATION_PLAN.md
```

**Data flow**

```
YouTube tab
  -> content script reads video ID
  -> side panel calls backend
  -> ingest steps (resumable)  ┐
  -> embed steps  (resumable)  ┴-> Postgres
  -> search (keyword | semantic) -> ranked results
  -> side panel renders results
  -> click result -> content script scrolls to + highlights that comment
```

`comments` table: `id`, `youtube_comment_id` (unique), `video_id`, `author`, `author_channel_id`, `text`, `like_count`, `published_at`, `updated_at`, `parent_comment_id`, `embedding vector(1536) NULL`.

---

## 4. Milestones

Each milestone: inspect → explain plan → implement only that milestone → build/test → fix → report → **stop and wait**.

### M0 — Monorepo foundation
npm workspaces root, three empty workspace packages, shared `tsconfig.base.json`, `.gitignore`, `.env.example`, root scripts (`build`, `test`, `lint`, `typecheck`). No application logic.
**Done when:** `npm install` and `npm run build` succeed at the root.

### M1 — Backend skeleton
NestJS app, `ConfigModule` reading env, `GET /health`. Jest wired up with one passing test.
**Done when:** the backend serves `/health`; `npm test` passes.

### M2 — Database + schema
`docker-compose.yml` (postgres + pgvector), SQL migration runner, migration 001: `CREATE EXTENSION vector`, `comments`, `video_jobs`, indexes (unique `youtube_comment_id`, btree `video_id`, GIN full-text on `text`, partial index for `embedding IS NULL`). `DatabaseModule` exposing a pooled `pg` client.
**Done when:** compose up + migrate creates the schema; `/health` reports DB status.

### M3 — Resumable ingestion
`YoutubeModule` wrapping `commentThreads.list` with pagination + replies. `IngestService` doing one bounded, resumable step per call against `video_jobs`. `POST /videos/:videoId/ingest`, `GET /videos/:videoId/status`.
**Done when:** repeated ingest calls walk a real video to `complete`; killing the process mid-ingest and calling again resumes without duplicates.

### M4 — Keyword search
`GET /videos/:videoId/search?q=&mode=keyword`. Postgres full-text (`tsquery`) with `ts_rank`, paginated. Response shape defined in `shared`.
**Done when:** searching `"windows"` returns ranked comments containing it, with tests.

### M5 — Resumable embedding pipeline
`EmbeddingProvider` interface (`embed(texts: string[]): Promise<number[][]>`, `dimensions`, `model`). `OpenAIEmbeddingProvider` against `text-embedding-3-small`, batched, retried on 429/5xx. `EmbedService` doing one bounded batch per call, driven by `embedding IS NULL`. `POST /videos/:videoId/embed`.
**Done when:** repeated embed calls drive `embedded_count` to `comment_count`; interrupting mid-run re-embeds nothing already done; the provider is injected by interface token, not concrete class.

### M6 — Semantic search
Embed the query, `ORDER BY embedding <=> $1` (cosine), return similarity. `mode=semantic` on the same endpoint, skipping rows not yet embedded. IVFFlat index once row counts justify it.
**Done when:** `"people complaining about installation"` surfaces `"Anyone else getting an error while installing this?"` on a real video.

### M7 — Extension shell
MV3 `manifest.json`, service worker opening the side panel on action click, content script detecting the video ID (including SPA navigation via `yt-navigate-finish`), panel showing the detected video and its job status. esbuild build script.
**Done when:** loading unpacked on a watch page opens a panel showing the correct video ID, updating across navigations.

### M8 — Search UI
Search box, keyword/semantic toggle, results list (author, text, likes, date, score), loading/empty/error states. The panel drives ingest and embed steps by polling `/status` and calling the step endpoints until done, showing progress — including "semantic search covers X of Y comments so far".
**Done when:** both modes return and render results inside the panel.

### M9 — Jump to comment
Click a result → message the content script → expand the comments section, find the comment by ID (loading more if needed), scroll into view, highlight briefly. Graceful fallback when the comment cannot be reached.
**Done when:** clicking a result scrolls the page to that comment and highlights it.

### M10 — Hardening & docs
Input validation, error mapping, YouTube/OpenAI quota handling, stale-job reclaim, config checks on boot, README, end-to-end pass on 2–3 real videos.
**Done when:** a clean clone can be set up from the README alone.

---

## 5. Explicitly deferred

AI summaries · topic clustering · sentiment · cross-video search · auth/accounts · hosting/deployment · Firefox/Edge ports · reply threading UI · caching layer.
