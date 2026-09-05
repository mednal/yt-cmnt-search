# YouTube Comment AI — Implementation Plan

Status: **M0–M8 complete — M9 next**
Last updated: 2026-09-05

---

## 1. Locked decisions

These are decided. They are not re-opened during implementation.

| # | Area | Decision |
|---|------|----------|
| 1 | Embeddings | Local ONNX `Xenova/gte-small` (384 dims) run in-process by Transformers.js — no API key, no quota, no per-comment cost. *(Revised at M5: was OpenAI `text-embedding-3-small`.)* |
| 2 | Provider abstraction | `EmbeddingProvider` interface; the local model is the bound implementation, `OpenAIEmbeddingProvider` is kept as the paid upgrade path |
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
- **Embedding batching:** 96 comments per batch, written to the DB after each one so a failure never loses completed work. Batches are selected in text-length order, because the model pads every text in a batch to the longest in it — mixing one 5000-character comment in with 95 short ones measured ~150x slower than grouping by length.
- **Embedding runs where the data is:** in the backend, never in the extension. An MV3 service worker is killed between events and would recompute per user what the server already stores.
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

`comments` table: `id`, `youtube_comment_id` (unique), `video_id`, `author`, `author_channel_id`, `text`, `like_count`, `published_at`, `updated_at`, `parent_comment_id`, `embedding vector(384) NULL`.

Vector width is part of the column type, so the model and the schema move together: changing embedding provider always needs a migration (002 narrowed 1536 → 384). `EmbeddingModule` refuses to boot when the bound provider's `dimensions` disagree with the schema.

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

### M5 — Resumable embedding pipeline ✅
`EmbeddingProvider` interface (`embed(texts: string[]): Promise<number[][]>`, `dimensions`, `model`). `LocalEmbeddingProvider` running `Xenova/gte-small` in-process, lazily loaded, batched; `OpenAIEmbeddingProvider` (batched, retried on 429/5xx) kept behind the same token. `EmbedService` doing one bounded batch per call, driven by `embedding IS NULL`. `POST /videos/:videoId/embed`. Migration 002 narrows the vector column to 384.
**Done when:** repeated embed calls drive `embedded_count` to `comment_count`; interrupting mid-run re-embeds nothing already done; the provider is injected by interface token, not concrete class.
**Verified:** 2709 comments on `rfscVS0vtbw` embedded in 24 calls / 168s; a repeat call returns `done` in 0.14s without re-embedding anything.

### M6 — Semantic search ✅
Embed the query, `ORDER BY embedding <=> $1` (cosine), return similarity. `mode=semantic` on the same endpoint, skipping rows not yet embedded. IVFFlat index once row counts justify it.
**Done when:** `"people complaining about installation"` surfaces `"Anyone else getting an error while installing this?"` on a real video.
**Verified:** on `rfscVS0vtbw` (2709 embedded comments), `mode=semantic` returns ranked results in ~15ms of database time (~1.2s end to end, dominated by embedding the query). Meaning-based phrasings that share no words with the comments work: `"error installing"` returns *"When I wanted to install pycharm, it gives an error(451)"*, `"users struggling to install"` returns *"Hello, I'm struggling to install python and pycharm on Lenovo"*.
**Known limit:** the exact wording in the criterion, `"people complaining about installation"`, does **not** surface installation complaints — it describes the commenters rather than the comment, and `gte-small` maps it near the corpus centroid, so the top hits are generic chatter. Measured against a 419-comment sample this is the phrasing, not the query path or the model's size: `bge-small-en-v1.5` (with its retrieval prefix) and `bge-base-en-v1.5` (768 dims, 3x the model) both miss it too, and return the same generic chatter. Phrasings that describe the *comment* — including CLAUDE.md's other example, `"people having problems installing the software"` — rank the right comments first. Options if this matters: swap to a retrieval-tuned model (`bge-small-en-v1.5` is also 384-dim, so no migration, but every comment needs re-embedding), or fuse keyword and semantic ranks. Neither is in M6.

**Decisions taken here**

- **Bounded candidate pool, not a similarity threshold.** Cosine distance is defined for every embedded comment, so semantic mode has no natural match set to count. It ranks the nearest `SEMANTIC_CANDIDATE_POOL` (200) comments and pages inside that; `total` is that pool. A fixed similarity cut-off was rejected: the value separating related from unrelated moves with the model and with the video.
- **No ANN index yet.** Measured on the 2709-comment video, the exact scan is 14ms — Postgres filters by `video_id` with the btree index and top-N sorts the rest. An IVFFlat/HNSW index is approximate and, combined with a per-video filter, would trade recall for nothing at this size. The query is written as `ORDER BY embedding <=> $2 LIMIT pool` in a single subquery, which is the shape such an index needs, so adding one later is a migration and no code change. Revisit past ~100k rows per video, or when search spans videos.
- **Query preparation matches the write side.** The query is trimmed and capped at `MAX_EMBEDDING_INPUT_CHARS` exactly as comments were, so both sides of the comparison went through the same pipeline. A provider failure maps to 502, as in the embed pipeline: an upstream dependency failed, not a bad request.
- **`toVectorLiteral` moved to the database layer.** Both the write side (embedding pipeline) and the read side (semantic search) need pgvector's text literal encoding, and it belongs to neither.

### M7 — Extension shell ✅
MV3 `manifest.json`, service worker opening the side panel on action click, content script detecting the video ID (including SPA navigation via `yt-navigate-finish`), panel showing the detected video and its job status. esbuild build script.
**Done when:** loading unpacked on a watch page opens a panel showing the correct video ID, updating across navigations.
**Verified:** `npm run build` produces a loadable `packages/extension/dist` (three IIFE bundles + manifest/html/css, ~11kb total, 39ms); `npm test` covers the id parser (9 cases: watch/shorts/live/embed/youtu.be, subdomains, look-alike hosts, malformed ids); the backend answers the panel's two calls from a `chrome-extension://` origin (`Access-Control-Allow-Origin: *` on `/health`, `/videos/:id/status` returning the stored 2709-comment job). Loading unpacked in Chrome is a manual step — see below.

**Structure**

```
packages/extension/
├─ public/       manifest.json · sidepanel.html · sidepanel.css   (copied verbatim)
├─ scripts/build.mjs                                              (esbuild + static copy)
└─ src/
   ├─ video-id.ts (+ .test.ts)   pure URL → video id
   ├─ messaging.ts               every chrome.runtime payload, in one place
   ├─ config.ts                  build-time API base URL
   ├─ background/service-worker.ts
   ├─ content/content-script.ts
   └─ sidepanel/{sidepanel,api}.ts
```

**Decisions taken here**

- **The service worker owns "which video", not the panel.** The panel is one context among several and is closed most of the time; the worker resolves the active tab, and the panel only renders what it is told. Tab → video id lives in `chrome.storage.session`, because MV3 kills the worker between events and module scope does not survive it.
- **Content script *and* URL parsing, deliberately.** `tab.url` alone would technically answer the question, but the content script reports on `yt-navigate-finish` — the event YouTube's own SPA fires — so the panel updates promptly on in-page navigation; the worker's `parseVideoId(tab.url)` is the fallback for a cold worker, a tab open since before install, or a page where injection failed. The content script is also where M9's jump-to-comment lands.
- **The backend origin is a build-time constant.** It has to agree in two places — the panel's `fetch` and the manifest's `host_permissions` — and a mismatch surfaces as an opaque network error. `scripts/build.mjs` defines `__API_BASE_URL__` and substitutes `__API_ORIGIN__` in the manifest from one value: `YCA_API_BASE_URL` (default `http://localhost:3000`). The checked-in `public/manifest.json` is a template; `dist/manifest.json` is what Chrome loads.
- **`app.enableCors()` on the backend.** MV3 host permissions normally exempt extension-page fetches from CORS, but relying on that makes an unexplainable failure mode for one line of dev-server config.
- **`tsc` typechecks, esbuild builds.** The extension emits nothing through `tsc` (`noEmit`), which lets imports carry the `.ts` extension Node's test runner needs, so `parseVideoId` is unit-tested by `node --test` with no test framework in the extension. This raises the repo's Node floor to 22.6 (native TS stripping) — root `engines` updated.
- **No icons.** Chrome's default action icon is used; drawing a real one is polish, not milestone work.

**Manual check (needs Chrome 114+ and the backend running):** `npm run build`, then `chrome://extensions` → Developer mode → *Load unpacked* → `packages/extension/dist`. Open a watch page, click the toolbar icon: the panel shows the title, the id, and the ingest/embed counts, and follows navigation to another video without a reload. `npm run dev -w @yca/extension` rebuilds the bundles on change (static files are copied once at startup).

**Known limits:** the panel follows the active tab of the last focused window, so two YouTube tabs share one panel view — normal for a side panel, revisit only if it bites. Watch mode does not re-copy `public/`.

### M8 — Search UI ✅
Search box, keyword/semantic toggle, results list (author, text, likes, date, score), loading/empty/error states. The panel drives ingest and embed steps by polling `/status` and calling the step endpoints until done, showing progress — including "semantic search covers X of Y comments so far".
**Done when:** both modes return and render results inside the panel.
**Verified:** against the running backend on `rfscVS0vtbw`. Keyword `"windows"` renders "Showing 10 of 10" with author, reply tag, age, likes and `ts_rank`; switching to Semantic re-runs `"people having problems installing the software"` and returns "Showing 20 of 200" led by installation complaints at 85% match; *Load more* appends the next page ("Showing 40 of 200"); a nonsense keyword query renders the empty state; *Resume indexing* drives ingest steps live (2,833 → 4,497 comments, the note and the coverage line updating per step) and *Stop* leaves "Stopped — progress is saved." with the status reloaded from the backend. No console errors. `npm test` (78 backend + 15 extension) and `npm run build` pass; `sidepanel.js` is 19.5kb.

**Structure added** — `src/sidepanel/`: `indexing.ts` (the step driver), `results.ts` (one result element), `format.ts` (+ `.test.ts`, pure), `dom.ts` (shared builders). `api.ts` grew search and the two step calls.

**Decisions taken here**

- **Indexing is a button, not an autostart.** Opening the panel on an un-indexed video does not start fetching: ingestion spends YouTube quota against the user's key, and a panel that follows the active tab would otherwise start a run every time the user opened a video to look at it. The button reads "Index this video", "Resume indexing" or a disabled "Indexed" depending on the stored job.
- **The panel is the loop, and the loop is interruptible.** `IndexingRun` calls `/ingest` until `done`, then `/embed` until `done`, checking a cancel flag between steps — the step in flight always lands, so nothing is wasted and nothing is half-written. Switching video, or pressing Stop, abandons the run; the durable state in `video_jobs` is what makes that safe.
- **Ingest fully, then embed.** Interleaving would delay nothing that matters: keyword search is live from the first page, and `embedding IS NULL` picks up late arrivals in a later batch regardless of order.
- **Progress is rendered from step responses, not from polling `/status`.** Each step already returns the counts, so a separate poll would add load and lag behind what the panel just learned. `/status` is re-read once, when a run ends.
- **A separate, much longer timeout for step calls.** `REQUEST_TIMEOUT_MS` (8s) is right for a read and wrong for an embed batch measured at ~7s on the reference video, plus a cold model load; `STEP_TIMEOUT_MS` is 180s. The two calls otherwise share one `request()`.
- **Semantic `total` is the candidate pool, and the panel says so.** The results header reads "Showing 20 of 200" and the coverage line reads "Semantic search covers X of Y comments so far", so a bounded pool over a partially embedded video is legible rather than mysterious.
- **A superseded search is dropped, not rendered.** Each search carries an `AbortController`; a new query aborts the one in flight, and an abort raised by the panel itself is re-thrown rather than mapped to an `ApiError`, so a fast typist never sees a stale error.
- **Backend error bodies are surfaced.** Nest puts the actionable text in the response body ("Query parameter \"q\" is required."), so `ApiError` reads it instead of showing a bare status line.
- **The mode toggle is two real radios.** Hidden inputs with styled labels: keyboard and screen-reader behaviour is the browser's, and switching mode re-runs the current query — the same question asked the other way.

### M9 — Jump to comment
Click a result → message the content script → expand the comments section, find the comment by ID (loading more if needed), scroll into view, highlight briefly. Graceful fallback when the comment cannot be reached.
**Done when:** clicking a result scrolls the page to that comment and highlights it.

### M10 — Hardening & docs
Input validation, error mapping, YouTube/OpenAI quota handling, stale-job reclaim, config checks on boot, README, end-to-end pass on 2–3 real videos.
**Done when:** a clean clone can be set up from the README alone.

---

## 5. Explicitly deferred

AI summaries · topic clustering · sentiment · cross-video search · auth/accounts · hosting/deployment · Firefox/Edge ports · reply threading UI · caching layer.
