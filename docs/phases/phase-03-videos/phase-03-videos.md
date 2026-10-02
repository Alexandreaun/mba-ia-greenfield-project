---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-10-02T15:37:21-0300"
  docs/project-plan.md: "2026-09-29T17:02:19-0300"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-02T15:23:24-0300"
  docs/decisions/technical-decisions-next-frontend-openapi-typing.md: "2026-09-29T17:02:19-0300"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-09-29T17:02:19-0300"
  docs/decisions/technical-decisions-next-frontend-config-base.md: "2026-09-29T17:02:19-0300"
  docs/phases/phase-01-configuracao-base/context.md: "2026-09-29T17:02:19-0300"
  docs/phases/phase-02-auth/context.md: "2026-09-29T17:02:19-0300"
  docs/phases/phase-02-auth-frontend/context.md: "2026-09-29T17:02:19-0300"
  .claude/skills/testing-guide-nestjs-project/SKILL.md: "2026-09-29T17:02:19-0300"
  .claude/skills/testing-guide-next-frontend/SKILL.md: "2026-09-29T17:02:19-0300"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Deliver resumable video upload of up to 10GB without blocking the system, automatic background processing (metadata extraction + thumbnail generation via FFmpeg), unique conflict-free object storage URLs, and streaming/download delivery with Range support — establishing the object storage, background-job, and worker foundation for subsequent video-management phases.

---

## Step Implementations

### SI-03.1 — Dependencies, Configuration Namespace, and Docker Compose

**Description:** Install the production dependencies this phase introduces, create the `storage` configuration namespace following the `registerAs` pattern from Phase 01, extend the Joi validation schema, and add the `minio` service to Docker Compose.

**Technical actions:**

1. Install production dependencies in nestjs-project: `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `@aws-sdk/s3-request-presigner` (per `phase-03-videos/TD-01`), `@tus/server`, `@tus/s3-store` (per `phase-03-videos/TD-02`), `pg-boss` (per `phase-03-videos/TD-04`), `execa` (per `phase-03-videos/TD-06`)
2. Create `src/config/storage.config.ts` — `registerAs('storage', ...)` reading `STORAGE_ENDPOINT` (string, required), `STORAGE_REGION` (string, default `'us-east-1'`), `STORAGE_BUCKET` (string, required), `STORAGE_ACCESS_KEY_ID` (string, required), `STORAGE_SECRET_ACCESS_KEY` (string, required)
3. Update `src/config/env.validation.ts` — add the new storage environment variables to the Joi schema; update `.env.example`
4. Add `minio` service to `nestjs-project/compose.yaml` — image `minio/minio`, API port 9000, Console port 9001, with `nestjs-api` depending on it (per `phase-03-videos/TD-01`)

**Tests:** _(empty — Infra)_

**Dependencies:** none

**Acceptance criteria:**

- Application starts without errors when all new storage environment variables are provided
- Starting the application without `STORAGE_BUCKET` causes a Joi validation error at bootstrap
- MinIO service is reachable at its console port and accepts S3 API connections inside the Docker network

---

### SI-03.2 — Video Entity and Migration

**Description:** Create the Video entity capturing upload metadata, processing lifecycle status, and the object storage key (per `phase-03-videos/TD-03`, `TD-08`, `TD-09`).

**Technical actions:**

1. Create `src/videos/entities/video.entity.ts` — `Video` with columns per `## Technical Specifications` → `### Data Model` (`id`, `channel_id`, `status`, `original_filename`, `mime_type`, `size_bytes`, `object_key`, `thumbnail_key`, `duration_seconds`, `metadata`, `created_at`, `updated_at`); `status` as a Postgres enum type with the 5 values
2. Generate and commit the TypeORM migration for the `videos` table

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` | Integration: constraints, defaults, enum values, unique on `object_key` | `src/videos/entities/video.entity.integration-spec.ts` |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- Creating a Video row with all required fields persists successfully with `status` defaulting to `'draft'`
- Inserting two Video rows with the same `object_key` violates the unique constraint
- The migration runs cleanly against a fresh database

---

### SI-03.3 — Object Storage Client Module

**Description:** Wrap the AWS SDK v3 S3 client (MinIO-compatible) behind a `StorageModule` exposing key generation and presigned URL helpers (per `phase-03-videos/TD-01`, `TD-08`).

**Technical actions:**

1. Create `src/storage/storage.module.ts` + `storage.service.ts` — `StorageService` constructing an `S3Client` from `storage.config.ts`
2. Implement `generateObjectKey(videoId: string, ext: string): string` returning `{videoId}.{ext}` and `generateThumbnailKey(videoId: string): string` returning `{videoId}-thumbnail.jpg` (per `phase-03-videos/TD-08`)
3. Implement `getPresignedGetUrl(key: string, options?: { disposition?: 'attachment' }): Promise<string>` via `@aws-sdk/s3-request-presigner` (per `phase-03-videos/TD-07`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `StorageService` (key generation) | Unit: deterministic, collision-free key format | `src/storage/storage.service.spec.ts` |
| `StorageService` (presigned URLs) | Integration: against real MinIO — URL generation + object read | `src/storage/storage.service.integration-spec.ts` |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- `generateObjectKey` and `generateThumbnailKey` return deterministic, collision-free keys for a given video id
- `getPresignedGetUrl` without `disposition` returns a URL that streams the object without forcing download
- `getPresignedGetUrl` with `disposition: 'attachment'` returns a URL whose response includes `Content-Disposition: attachment`

---

### SI-03.4 — Background Job Queue Setup (pg-boss)

**Description:** Register pg-boss against the existing Postgres connection and define the `video.process` queue with retry/backoff/dead-letter configuration (per `phase-03-videos/TD-04`, `TD-09`).

**Technical actions:**

1. Create `src/jobs/jobs.module.ts` — bootstraps `pg-boss` using the existing `databaseConfig` connection details, exposes a `JobsService` with `send()`/`work()` wrappers
2. Register the `video.process` queue with `retryLimit: 3, retryBackoff: true, deadLetter: 'video-processing-dlq'` (per `phase-03-videos/TD-09`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `JobsService` | Integration: against real Postgres — a sent job is received by a registered worker; a job that throws on every attempt lands in the dead-letter queue | `src/jobs/jobs.service.integration-spec.ts` |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- A job sent to `video.process` is delivered to a registered consumer
- A job whose handler throws on every attempt is moved to `video-processing-dlq` after 3 retries
- pg-boss's own job tables are created automatically in the existing Postgres database, without a dedicated TypeORM migration

---

### SI-03.5 — Endpoint POST /videos (Draft Creation)

**Route:** POST /videos
**Test Specs:** _pending /plan-test-specs_
**Authorization:** Owner (authenticated channel owner)

**Description:** Implement the draft pre-registration endpoint — creates a Video row with `status: 'draft'` before any upload bytes arrive (per `phase-03-videos/TD-03`).

**Technical actions:**

1. Create `src/videos/dto/create-video.dto.ts` — `CreateVideoDto` with `original_filename` (string, required), `mime_type` (string, required), `size_bytes` (number, required)
2. Create `src/videos/videos.service.ts` — `VideosService.createDraft(channelId, dto)`: validates `size_bytes` does not exceed 10GB (else `VideoTooLargeException`) and `mime_type` is a supported video type (else `UnsupportedMediaTypeException`); generates `object_key`/`thumbnail_key` via `StorageService` (per `phase-03-videos/TD-08`); persists the Video row with `status: 'draft'`
3. Create `src/videos/videos.controller.ts` — `VideosController` with `@Post()` calling `createDraft()`, returning 201 with `{ id, status }`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService` (validation branches) | Unit: size limit, mime type rejection | `src/videos/videos.service.spec.ts` |
| `VideosService.createDraft` | Integration: persists draft row with generated keys | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.2, SI-03.3

**Acceptance criteria:**

- `POST /videos` with a valid payload returns `201` with `{ id, status: "draft" }` and persists a Video row
- `POST /videos` with `size_bytes` exceeding 10GB returns `400` with `VIDEO_TOO_LARGE`
- `POST /videos` with an unsupported `mime_type` returns `415` with `UNSUPPORTED_MEDIA_TYPE`

---

### SI-03.6 — tus Upload Server Integration

**Description:** Mount `@tus/server` with `@tus/s3-store` to accept resumable chunked uploads, correlating each upload to its draft Video and enqueueing processing on completion (per `phase-03-videos/TD-02`).

**Technical actions:**

1. Mount `@tus/server` at `/uploads` in `main.ts`, configured with `@tus/s3-store` pointing at `StorageService`'s S3 client
2. Implement the `onUploadCreate` hook — reads `videoId` from `Upload-Metadata`, verifies the draft exists and belongs to the caller's channel (else rejects with `404 VIDEO_NOT_FOUND`)
3. Implement the `onUploadFinish` hook — sets `Video.status = 'uploaded'` and enqueues a `video.process` job with `{ videoId, objectKey }` via `JobsService` (per `phase-03-videos/TD-04`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| tus upload flow | E2E: real tus protocol over HTTP — chunked upload completion, resume, ownership rejection | `test/uploads.e2e-spec.ts` |

**Dependencies:** SI-03.3, SI-03.4, SI-03.5

**Acceptance criteria:**

- A multi-chunk `PATCH /uploads/{uploadId}` sequence that reaches the full `Upload-Length` flips `Video.status` to `"uploaded"`
- Completing the upload enqueues exactly one `video.process` job
- `POST /uploads` with a `videoId` that does not belong to the caller's channel returns `404 VIDEO_NOT_FOUND`
- An interrupted upload resumed with the correct `Upload-Offset` completes successfully without re-sending already-received bytes

---

### SI-03.7 — Video Worker Bootstrap and Compose Topology

**Description:** Add a second NestJS application bootstrap (no HTTP server) that runs as the `nestjs-worker` Docker Compose service, hosting the background job consumer (per `phase-03-videos/TD-05`).

**Technical actions:**

1. Create `src/worker/main.ts` — bootstraps `WorkerModule` via `NestFactory.createApplicationContext()` (no HTTP listener)
2. Add `nestjs-worker` service to `nestjs-project/compose.yaml` — same image/`Dockerfile.dev` as `nestjs-api`, overriding `command` to run `src/worker/main.ts`, sharing the same network/DB access

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `WorkerModule` bootstrap | Integration: application context boots and connects to the database | `src/worker/worker-bootstrap.integration-spec.ts` |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- The `nestjs-worker` container starts successfully and connects to Postgres
- The worker process does not expose an HTTP port
- `nestjs-worker` shares the same database and object storage configuration as `nestjs-api` — no duplicated credentials

---

### SI-03.8 — Video Processing Job Handler (FFmpeg)

**Description:** Implement the `video.process` job consumer inside `WorkerModule` — extracts metadata via `ffprobe`, generates a thumbnail via `ffmpeg`, both invoked directly through `execa` (per `phase-03-videos/TD-06`), and reconciles the final `Video.status` per the retry/DLQ outcome (per `phase-03-videos/TD-09`).

**Technical actions:**

1. Create `src/worker/video-processing.handler.ts` registered against the `video.process` queue via `JobsService.work()`
2. Implement metadata extraction: `execa('ffprobe', ['-show_format', '-show_streams', '-print_format', 'json', ...])` against the object downloaded from `StorageService`; parse `duration_seconds` and store raw output in `metadata`
3. Implement thumbnail generation: `execa('ffmpeg', ['-ss', ..., '-i', ..., '-vframes', '1', ...])`, upload the result to `thumbnail_key` via `StorageService`
4. On success, set `Video.status = 'ready'`; on job dead-letter (final failure), set `Video.status = 'failed'`, leaving any partial artifacts in place for diagnostics (per `phase-03-videos/TD-09`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessingHandler` (happy path) | Integration: against real MinIO + real `ffmpeg`/`ffprobe` binaries — extracts correct duration, metadata, and thumbnail | `src/worker/video-processing.handler.integration-spec.ts` |
| `VideoProcessingHandler` (failure path) | Integration: corrupted input exhausts retries, lands in DLQ, flips status to `'failed'` | `src/worker/video-processing.handler.integration-spec.ts` |

**Dependencies:** SI-03.2, SI-03.3, SI-03.4, SI-03.7

**Acceptance criteria:**

- Processing a valid video sets `status: "ready"`, `duration_seconds`, `metadata`, and `thumbnail_key`
- Processing a corrupted/unreadable file exhausts retries, lands the job in `video-processing-dlq`, and sets `status: "failed"`
- A transient failure that succeeds on retry does not require any manual re-upload

---

### SI-03.9 — Endpoint GET /videos/{id} (Status + Delivery URLs)

**Route:** GET /videos/{id}
**Test Specs:** _pending /plan-test-specs_
**Authorization:** Owner (authenticated channel owner)

**Description:** Expose video status and, once processing succeeds, presigned streaming/download URLs (per `phase-03-videos/TD-07`, `TD-09`).

**Technical actions:**

1. Add `@Get(':id')` to `VideosController` calling `VideosService.findOne(channelId, id)`
2. Implement `VideosService.findOne()` — loads the Video, and when `status === 'ready'`, calls `StorageService.getPresignedGetUrl()` twice (stream: no disposition; download: `disposition: 'attachment'`) to build the `urls` object

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.findOne` (urls gating) | Unit: `urls` object only populated when `status === "ready"` | `src/videos/videos.service.spec.ts` |
| `VideosService.findOne` | Integration: end-to-end against a real `'ready'` row | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.2, SI-03.3

**Acceptance criteria:**

- `GET /videos/{id}` for a video with `status: "ready"` returns `urls.streamUrl` and `urls.downloadUrl`
- `GET /videos/{id}` for a video with any other status returns `urls: null`
- `GET /videos/{id}` for a video not owned by the caller or not found returns `404 VIDEO_NOT_FOUND`

---

## Technical Specifications

### Data Model

#### Video

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK, generated | Also doubles as the Object Storage key |
| channel_id | uuid | FK → channels.id, not null | Owning channel |
| status | enum | not null, default `'draft'`, values: `'draft'`, `'uploaded'`, `'processing'`, `'ready'`, `'failed'` | Granular lifecycle |
| original_filename | varchar | not null | Captured at draft creation |
| mime_type | varchar | not null | Validated as a supported video format before accepting upload |
| size_bytes | bigint | not null | Must not exceed 10GB |
| object_key | varchar | not null, unique | Flat key: `{id}.{ext}` |
| thumbnail_key | varchar | nullable | Flat key: `{id}-thumbnail.jpg`; set once processing succeeds |
| duration_seconds | integer | nullable | Extracted via `ffprobe`; set once processing succeeds |
| metadata | jsonb | nullable | Raw `ffprobe` output; set once processing succeeds |
| created_at | timestamptz | not null, auto-generated | |
| updated_at | timestamptz | not null, auto-generated | |

**Relations:** Video → Channel (many-to-one)
**Indexes:** `(channel_id)` — FK, `(object_key)` — unique, `(status)` — worker/DLQ queries

### API Contracts

#### POST /videos (SI-03.X)

**Request headers:**
- Authorization: Bearer <access_token>
- Content-Type: application/json

**Request body:**
- original_filename: string, required
- mime_type: string, required — must be a supported video format
- size_bytes: integer, required — must not exceed 10GB

**Response 201:**
- id: string (uuid)
- status: `"draft"`

**Error responses:**
- 400 VIDEO_TOO_LARGE: when `size_bytes` exceeds the 10GB limit
- 415 UNSUPPORTED_MEDIA_TYPE: when `mime_type` is not a supported video format
- 400 validation error: when the request body fails schema validation

---

#### POST /uploads (SI-03.X)

tus Creation extension — handled by `@tus/server`, not a hand-written NestJS controller.

**Request headers:**
- Authorization: Bearer <access_token>
- Tus-Resumable: 1.0.0
- Upload-Length: {size_bytes}
- Upload-Metadata: `videoId {base64(id)}` — correlates the upload to the draft created by `POST /videos`

**Response 201:**
- Location header: `/uploads/{uploadId}`

**Error responses:**
- 404 VIDEO_NOT_FOUND: when the `videoId` in `Upload-Metadata` does not match a draft owned by the caller

---

#### PATCH /uploads/{uploadId} (SI-03.X)

tus Core extension — handled by `@tus/server`. Repeated per chunk until `Upload-Offset` reaches `Upload-Length`; on the final chunk the `onUploadFinish` hook enqueues the processing job and flips `Video.status` to `'uploaded'`.

**Request headers:**
- Tus-Resumable: 1.0.0
- Upload-Offset: {current offset}
- Content-Type: application/offset+octet-stream

**Response 204:** No content. `Upload-Offset` response header reflects the new offset.

**Error responses:**
- 409 UPLOAD_OFFSET_MISMATCH: when the provided `Upload-Offset` does not match the server's persisted offset (tus protocol)

---

#### GET /videos/{id} (SI-03.X)

**Request headers:**
- Authorization: Bearer <access_token>

**Response 200:**
- id: string (uuid)
- status: `"draft" | "uploaded" | "processing" | "ready" | "failed"`
- originalFilename: string
- durationSeconds: number, nullable — present only once `status: "ready"`
- urls: object, nullable — present only once `status: "ready"`
  - streamUrl: string — presigned GET URL supporting Range requests
  - downloadUrl: string — presigned GET URL with `Content-Disposition: attachment`

**Error responses:**
- 404 VIDEO_NOT_FOUND: when `id` does not exist or does not belong to the caller's channel

#### Validation Rules — Draft Creation

| Field | Rule | Error code |
|-------|------|------------|
| size_bytes | Must not exceed 10,737,418,240 bytes (10GB) | VIDEO_TOO_LARGE |
| mime_type | Must be a supported video MIME type | UNSUPPORTED_MEDIA_TYPE |

---

### Authorization Matrix

| Endpoint | Anonymous | Authenticated | Owner |
|----------|-----------|---------------|-------|
| POST /videos | ✗ | ✗ | ✓ |
| POST /uploads | ✗ | ✗ | ✓ |
| PATCH /uploads/{uploadId} | ✗ | ✗ | ✓ |
| GET /videos/{id} | ✗ | ✗ | ✓ |

_Videos are not yet publishable in this phase (visibility/publication ships in Phase 04) — every endpoint is owner-only; there is no public/anonymous read path for a video's draft/processing state._

---

### Error Catalog

**Error response format:** inherited from Phase 02 (phase-02-auth/TD-07): `{ statusCode: number, error: string, message: string }`.

| Code | HTTP | Trigger |
|------|------|---------|
| VIDEO_TOO_LARGE | 400 | POST /videos with `size_bytes` exceeding the 10GB limit |
| UNSUPPORTED_MEDIA_TYPE | 415 | POST /videos with a `mime_type` that is not a supported video format |
| VIDEO_NOT_FOUND | 404 | GET /videos/{id} or POST /uploads referencing a video that does not exist or is not owned by the caller |
| UPLOAD_OFFSET_MISMATCH | 409 | PATCH /uploads/{uploadId} with an `Upload-Offset` that does not match the server's persisted offset (tus protocol) |
| VIDEO_PROCESSING_FAILED | — | Not an HTTP error — surfaced via `Video.status: "failed"` on GET /videos/{id} after pg-boss exhausts retries and dead-letters the job |

---

### Events/Messages

#### video.process

**Payload:**

```json
{ "videoId": "uuid", "objectKey": "string" }
```

**Producer:** `VideosService` — enqueued from the `@tus/server` `onUploadFinish` hook when the upload completes (per `phase-03-videos/TD-02`, `phase-03-videos/TD-03`)
**Consumer:** `WorkerModule`, running as a second bootstrap inside `nestjs-project/` (per `phase-03-videos/TD-05`) — invokes `ffmpeg`/`ffprobe` via `execa` (per `phase-03-videos/TD-06`) to extract `duration_seconds`/`metadata` and generate the thumbnail at `thumbnail_key`
**Trigger:** the tus upload reaches `Upload-Offset == Upload-Length` (upload fully received)
**Delivery semantics:** at-least-once — pg-boss (per `phase-03-videos/TD-04`) retries with exponential backoff (`retryLimit`, `retryBackoff`) and routes to a dead-letter queue once retries are exhausted; `Video.status` flips to `"ready"` on success or `"failed"` on dead-letter (per `phase-03-videos/TD-09`)

---

<!-- phase-a-complete -->

## Dependency Map

```
SI-03.1 (root)
├── SI-03.2 — depends on SI-03.1 (entity needs config in place)
├── SI-03.3 — depends on SI-03.1 (storage client needs config in place)
├── SI-03.4 — depends on SI-03.1 (job queue needs config in place)
└── SI-03.7 — depends on SI-03.1 (worker bootstrap needs config in place)

SI-03.5 — depends on SI-03.2, SI-03.3 (draft creation needs the entity + storage key generation)
└── SI-03.6 — depends on SI-03.3, SI-03.4, SI-03.5 (tus upload needs storage, the queue, and an existing draft)

SI-03.8 — depends on SI-03.2, SI-03.3, SI-03.4, SI-03.7 (worker job handler needs the entity, storage, queue, and worker bootstrap)

SI-03.9 — depends on SI-03.2, SI-03.3 (status/delivery endpoint needs the entity + storage)
```

---

## Deliverables

- [ ] SI-03.1 — Dependencies, Configuration Namespace, and Docker Compose
- [ ] SI-03.2 — Video Entity and Migration
- [ ] SI-03.3 — Object Storage Client Module
- [ ] SI-03.4 — Background Job Queue Setup (pg-boss)
- [ ] SI-03.5 — Endpoint POST /videos (Draft Creation)
- [ ] SI-03.6 — tus Upload Server Integration
- [ ] SI-03.7 — Video Worker Bootstrap and Compose Topology
- [ ] SI-03.8 — Video Processing Job Handler (FFmpeg)
- [ ] SI-03.9 — Endpoint GET /videos/{id} (Status + Delivery URLs)

**Full test suites:**

- [ ] Backend unit + integration tests pass (`docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] Backend E2E tests pass (`docker compose exec nestjs-api npm run test:e2e`)
- [ ] Type/compilation checks pass (`docker compose exec nestjs-api npx tsc --noEmit`)
- [ ] Lint passes (`docker compose exec nestjs-api npm run lint`)

_`next-frontend` is listed as an affected subproject in context.md (`TD-02`/`TD-03`/`TD-07` are Cross-layer) but receives no SIs in this build — no screen inventory was generated for this phase (`ui_in_scope: false`), so the frontend-side upload UI and streaming/download consumption are deferred to a future phase/task that runs `/screen-inventory` first._
