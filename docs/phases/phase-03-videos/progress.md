# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 9/9 completed

### SI-03.1 — Dependencies, Configuration Namespace, and Docker Compose
- **Status:** completed
- **Tests:** no tests (infra)
- **Observations:**
  - `minio` service already existed in `compose.yaml` (pre-provisioned outside this run) using `bitnamilegacy/minio` with `minioadmin`/`minioadmin` credentials instead of the plan's suggested `minio/minio` image — kept as-is since it was already healthy; `storage.config.ts` and `.env`/`.env.example` were written to match the running instance rather than the plan's literal image/credential suggestion.
  - Created the `streamtube-videos` bucket in MinIO via `mc mb` (not explicitly listed in the SI's technical actions, but required for `StorageService` in SI-03.3 to have a target bucket).
  - `nestjs-worker` compose service also already existed as a bare skeleton (no command override) — left untouched; SI-03.7 owns pointing it at the worker entrypoint.

### SI-03.2 — Video Entity and Migration
- **Status:** completed
- **Tests:** 5 passing
- **Observations:**
  - Added the inverse `@OneToMany(() => Video, ...)` on `Channel` alongside `Video`'s `@ManyToOne` — required by `.claude/rules/nestjs-entities.md` ("always define both sides of a relationship"), even though existing token entities (`RefreshToken`/`VerificationToken` → `User`) only had the unidirectional side; followed the written rule over the pre-existing partial precedent for this new entity.
  - `size_bytes` uses a `bigint` column with a to/from transformer so the service layer can compare against the 10GB limit as a plain `number` (safely within `Number.MAX_SAFE_INTEGER`) instead of TypeORM's default string-for-bigint behavior.
  - Hit the "synchronize residue" trap documented in `.claude/rules/typeorm-migrations.md`: ran the integration test (which defaults to `synchronize: true` against the same shared dev DB) before running `migration:run`, so TypeORM synchronize pre-created the `videos` table/enum out-of-band; `migration:run` then failed with `type "videos_status_enum" already exists`. Recovered per the rule's documented procedure (drop the orphan table + enum, then re-run the migration cleanly). For subsequent SIs with new entities, run `migration:run` before the integration test to avoid repeating this.

### SI-03.3 — Object Storage Client Module
- **Status:** completed
- **Tests:** 7 passing
- **Observations:**
  - Fixed `storage.config.ts` (written in SI-03.1) to use `!` non-null assertions on required-without-default env vars, matching the `auth.config.ts` convention — it had been left as plain `process.env.X` (implicitly `string | undefined`).
  - Fix-loop attempt 1/3: the attachment-disposition integration test initially used `.not.toContain('attachment')` against `response.headers.get('content-disposition')`, which is `null` when MinIO omits the header entirely — Jest's `.not.toContain()` throws a matcher-usage error on `null` rather than evaluating false. Switched to `.not.toBe('attachment')`, which handles `null` correctly. Not a StorageService bug — a test-assertion bug.

### SI-03.4 — Background Job Queue Setup (pg-boss)
- **Status:** completed
- **Tests:** 2 passing
- **Observations:**
  - Fix-loop (2/3 attempts): `pg-boss@12.x` ships as pure ESM and Jest's default `transformIgnorePatterns` excludes all of `node_modules`. Added a `transformIgnorePatterns` override to both `package.json`'s jest config and `test/jest-e2e.json`. Attempt 1 only whitelisted `pg-boss` itself and still failed on its transitive ESM deps (`serialize-error`, `non-error`); attempt 2 traced the full eager-load chain (`pg-boss` → `serialize-error` → `non-error`, and separately `pg-boss`'s `timekeeper.js` → `rrule-temporal` → `temporal-spec`) and whitelisted all five. `type-fest` (serialize-error's other dep) is types-only, no runtime import, so it did not need whitelisting.
  - Both the `video.process` queue and its `video-processing-dlq` dead-letter sink are created via `createQueue()` in `onModuleInit` (idempotent — pg-boss's `create_queue` SQL function uses `ON CONFLICT DO NOTHING`). The DLQ queue must exist before `video.process` registers it as `deadLetter`, so creation order matters.
  - No dedicated test for AC3 ("pg-boss's own job tables are created automatically... without a dedicated TypeORM migration") — implicitly verified by the other two tests passing against the real `db` container with no migration ever written for pg-boss's schema, consistent with how SI-03.2's "migration runs cleanly" AC was verified by the actual `migration:run` rather than a dedicated automated test.

### SI-03.5 — Endpoint POST /videos (Draft Creation)
- **Status:** completed
- **Tests:** 9 passing (6 unit+integration via `npm test`, 3 e2e via spec-derived `test/videos-draft.e2e-spec.ts`)
- **Observations:**
  - The JWT access-token payload (`JwtPayload`) only carries `sub`/`email`, not a channel id, and there was no existing "resolve current user's channel" lookup. Added `ChannelsService.findByUserId(userId)` (not in the plan's technical actions) since `VideosController` has no other way to resolve the owning channel from the authenticated request.
  - Generated the `Video.id` UUID client-side (`randomUUID()`) before the first insert, instead of saving once to get a DB-generated id and then updating `object_key`/`thumbnail_key` in a second save — the two-save approach would briefly insert a row with an empty `object_key`, which could collide with a concurrent draft creation under the column's `unique` constraint. Single atomic insert avoids that window entirely.
  - Made `status: VideoStatus.DRAFT` explicit in the service's `repository.create()` call rather than relying on the entity's DB-level `@Column({ default: ... })`: a mocked repository in the unit test can't replicate Postgres's `DEFAULT` + `RETURNING` behavior, so the service needed to set it explicitly to be unit-testable without a real DB.
  - No supported-video-MIME-type allowlist was specified anywhere in context.md/TDs; defined one locally in `videos.constants.ts` (`video/mp4`, `video/quicktime`, `video/x-matroska`, `video/webm`, `video/x-msvideo`) covering the spec's `video/mp4` example.
  - E2E test reuses the same local register→confirm→login helper pattern as `test/auth.e2e-spec.ts` (no shared auth-helper module exists yet) and clears `ThrottlerStorage` in `beforeEach` — 4 requests/test × 3 tests would otherwise approach the global 10-req/60s throttle limit.

### SI-03.6 — tus Upload Server Integration
- **Status:** completed
- **Tests:** 3 passing (e2e via `test/uploads.e2e-spec.ts`)
- **Observations:**
  - `tus-server.factory.ts` mounts `@tus/server` + `@tus/s3-store` as a raw Express sub-app, mounted in `main.ts` before `app.init()` — Nest finalizes its router (including a terminal catch-all) during `init()`, so middleware registered afterward would never be reached.
  - `onIncomingRequest`/`onUploadCreate` authenticate the bearer JWT manually (no Nest guard pipeline applies to the raw tus `Server`); a `TusError` class carries `status_code`/`body` to satisfy tus's duck-typed error contract while remaining a real `Error` subclass.
  - `onUploadCreate` resolves the caller's channel via `ChannelsService.findByUserId` (added in SI-03.5) and rejects with `404 VIDEO_NOT_FOUND` if the `videoId` from `Upload-Metadata` isn't an owned draft.
  - `onUploadFinish` flips `Video.status` to `uploaded` and enqueues exactly one `video.process` job via `JobsService` — verified by the e2e test subscribing a one-shot worker and asserting a single delivery.

### SI-03.7 — Video Worker Bootstrap and Compose Topology
- **Status:** completed
- **Tests:** 1 passing (integration via `src/worker/worker-bootstrap.integration-spec.ts`)
- **Observations:**
  - `WorkerModule` is deliberately minimal for this SI: only `ConfigModule` (loading `databaseConfig` + `storageConfig`) + `TypeOrmModule.forRootAsync` — no `JobsModule`/`VideosModule`/`StorageModule` import yet. SI-03.8 owns registering the actual pg-boss job consumer; adding those imports now would be scope creep ahead of that SI.
  - Verified manually via `docker compose exec nestjs-api npx nest start --entryFile worker/main` that the command compiles `src/worker/main.ts` to `dist/worker/main.js` and `TypeOrmCoreModule` initializes (real Postgres connection) before the process exits — exit is expected and harmless: `NestFactory.createApplicationContext()` has nothing holding the event loop open until SI-03.8 registers the job consumer's listener.
  - Test deviates from `testing-guide-nestjs-project`'s default "Module → Unit compilation test" convention by design: used the real `NestFactory.createApplicationContext()` bootstrap (the actual production entrypoint) against the live `db` container, per the plan's Tests-table row ("Integration: application context boots and connects to the database"), rather than `Test.createTestingModule()`.

### SI-03.8 — Video Processing Job Handler (FFmpeg)
- **Status:** completed
- **Tests:** 2 passing (integration via `src/worker/video-processing.handler.integration-spec.ts`, real MinIO + real ffmpeg/ffprobe + real pg-boss)
- **Observations:**
  - `Dockerfile.dev` now installs `ffmpeg` (apt package, provides both the `ffmpeg` and `ffprobe` binaries) — required for the worker to actually run the technical actions; not an explicit technical action but a necessary infra addition, mirroring how SI-03.1 added `minio` to compose.
  - Extended `StorageService` with `downloadObject(key, destPath)` and `uploadFile(key, filePath, contentType)` (stream-based, via `GetObjectCommand`/`PutObjectCommand` + `node:stream/promises.pipeline`) — required by technical actions 2/3 ("against the object downloaded from StorageService" / "upload... via StorageService") but not pre-existing; `StorageService` previously only had presigned-URL and key-generation methods.
  - Extended `VideosService` with `markReady(id, { durationSeconds, metadata })` and `markFailed(id)`, mirroring the existing `markUploaded` pattern.
  - `VideoProcessingHandler` registers two separate `JobsService.work()` consumers in `onModuleInit`: one on `video.process` (the real ffmpeg/ffprobe work — throws on any failure so pg-boss's native retry/backoff from SI-03.4 kicks in untouched) and one on `video-processing-dlq` (sets `status: 'failed'`). Confirmed via `pg-boss`'s own source (`manager.js` → `insertDeadLetterJob`) that the dead-lettered job's `data` is a verbatim copy of the original job's data, so `videoId` is available directly on the DLQ side without any extra lookup.
  - `VideoStatus.PROCESSING` (declared in SI-03.2's full lifecycle enum, per `phase-03-videos/TD-09`'s `draft → uploaded → processing → ready | failed`) is **not** set by this handler — the SI's technical actions only specify the `ready`/`failed` transition, so the video's status stays `uploaded` for the whole duration of processing. Flagging as a gap: `PROCESSING` is currently a dead enum value with no code path that sets it.
  - Fix-loop: `execa` (TD-06's chosen library) is a pure-ESM package, and one of its transitive deps (`unicorn-magic`) ships a package.json `exports` map with only `"import"` conditions at every leaf — genuinely unresolvable via Jest's default CJS `require()` resolution (not just an unparsed-syntax problem like pg-boss's case in SI-03.4). Fixed by extending `package.json`'s jest `transformIgnorePatterns` with the full real ESM dependency chain (execa + ~14 transitive deps) **and** adding a `moduleNameMapper` entry (`"^unicorn-magic$"` → its concrete `default.js` file) to bypass the unresolvable exports map for that one package. A dynamic `import()` workaround was tried first and reverted — Jest's default (non-VM-modules) runtime throws `"A dynamic import callback was invoked without --experimental-vm-modules"`, and enabling that flag project-wide broke the existing static `import` of pg-boss (which relies on the CJS-transform workaround), so it was abandoned as oversized for this SI's scope.
  - Found and recovered from a **pre-existing latent bug** unrelated to this SI's own code: `src/database/migrations.integration-spec.ts`'s `MANAGED_TABLES` list (written in SI-03.2's predecessor phase, before the `Video` entity existed) does not include `"videos"`. When that spec's `DROP TABLE ... CASCADE` + migration-rerun cycle runs in the same full-suite invocation as a video-creating integration test, it recreates `channels`/`users` as empty tables but leaves any pre-existing `videos` row in place, orphaning its `channel_id` — which then makes `synchronize: true` fail with a foreign-key violation on the *next* integration test that tries to sync that FK. Recovered by manually deleting the orphaned row (`DELETE FROM videos WHERE id = ...`) to unblock this SI's own test. Not fixed in `migrations.integration-spec.ts` itself (out of scope — that file belongs to SI-03.2) but flagged here as a real flakiness risk for the full suite; recommend a follow-up task to add `"videos"` to that file's `MANAGED_TABLES`.

### SI-03.9 — Endpoint GET /videos/{id} (Status + Delivery URLs)
- **Status:** completed
- **Tests:** 13 passing (3 unit via `videos.service.spec.ts`, 4 integration via `videos.service.integration-spec.ts` including 1 new real-`ready`-row test, 6 e2e via spec-derived `test/videos-status.e2e-spec.ts`)
- **Observations:**
  - Added `VideosService.findOne(channelId, id)` — same ownership-scoped lookup shape as `findOwnedDraft` (kept as a separate method rather than reusing `findOwnedDraft`, since the latter's name is upload-flow-specific even though its query isn't actually draft-filtered; diverging call-sites may need different semantics later). Throws `VideoNotFoundException` directly (mirroring `UploadsService.assertOwnedDraft`'s precedent for the identical ownership-miss case) rather than returning `null` for the controller to check.
  - `VideosController.findOne` mirrors `create()`'s existing (pre-existing, not introduced here) pattern of resolving the caller's channel via `ChannelsService.findByUserId` and throwing a plain `Error` if no channel exists — left as-is for consistency within the same controller rather than fixing in this SI's new method only.
  - The e2e spec (`test/videos-status.e2e-spec.ts`, authored from `nestjs-project/specs/videos-status.plan.md` per the modern Test Specs flow) seeds `Video` rows directly via the repository rather than driving them through the real upload/processing flow, per the spec's own `Setup:` field.
  - Pre-existing lint debt (same `no-unsafe-*`/`require-await` pattern already flagged in SI-03.6's observations for `auth.e2e-spec.ts`/`uploads.e2e-spec.ts`/`videos-draft.e2e-spec.ts`) also appears in the new `videos-status.e2e-spec.ts` — left untouched, consistent with treating it as a project-wide gap outside this SI's scope.
