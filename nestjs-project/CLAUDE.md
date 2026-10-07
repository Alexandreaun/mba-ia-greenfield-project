# CLAUDE.md

## Environment Startup Verification

**Default behavior:** starting the environment means starting **only infrastructure services** (database, mail, etc.) — **never** start the NestJS application server unless the user explicitly asks to run/serve the project (e.g., "rode o projeto", "suba o servidor", "run the app").

After starting infrastructure, always confirm the containers are up before proceeding:

```bash
docker compose ps   # all services must show status "running"
```

Then verify each infrastructure service is actually ready to accept connections — not just running:

- **PostgreSQL:** `docker compose exec db pg_isready -U streamtube` — expect `accepting connections`

Only start the NestJS dev server (`npm run start:dev`) when the user **explicitly** asks to run the application — never as part of "start the environment".

## Development Environment

This project runs inside Docker. Always use the container for development:

```bash
# Start containers
docker compose up -d

# Install dependencies (first time only)
docker compose exec nestjs-api npm install

# Run the dev server (watch mode)
docker compose exec nestjs-api npm run start:dev
```

Services:
- `nestjs-api` — NestJS API, port `3000`
- `nestjs-worker` — Video Worker (background job consumer, no HTTP port) — second NestJS bootstrap in this same codebase (`src/worker/main.ts`), started via `command: npx nest start --entryFile worker/main` in `compose.yaml`
- `db` — PostgreSQL 17, port `5432`, database `streamtube`, user/password `streamtube`
- `minio` — S3-compatible object storage (video files + thumbnails), console on `9001`, API on `9000`
- `mailpit` — SMTP capture for local email testing, UI on `8025`

All verification and teardown commands run on the **host machine**:

```bash
# Verify NestJS is running (expect 200 + "Hello World!")
curl http://localhost:3000

# Verify PostgreSQL is ready (runs inside the db container)
docker compose exec db pg_isready -U streamtube

# Check container logs
docker compose logs nestjs-api
docker compose logs db

# Tear down the entire environment
docker compose down
```

## Commands

**Strict rule:** every `npm`, `npx`, `node`, `tsc`, and test command runs **inside the container**, never on the host. Running on the host causes env-var divergence (`DB_HOST` resolves to `localhost` instead of the Compose service), uses a different Node version, and produces results that do not reflect what runs in CI/prod.

### Container-only commands (always prefix with `docker compose exec nestjs-api`)

```bash
npm run start:dev                        # Dev server with hot-reload
npm run build                            # Compile to dist/
npm run start:prod                       # Run compiled build

npm test                                 # Unit tests
npm run test:watch                       # Unit tests in watch mode
npm run test:cov                         # Coverage report
npm run test:e2e                         # End-to-end tests (always with --runInBand)

npx tsc --noEmit                         # Type-check (required before declaring a task done)
npm run lint                             # ESLint with auto-fix
npm run format                           # Prettier formatting
```

### Host-only commands (Docker / connectivity probes)

```bash
docker compose ps
docker compose logs nestjs-api
docker compose logs nestjs-worker
docker compose exec db pg_isready -U streamtube
curl http://localhost:3000
```

### Test execution

Integration and e2e suites share a single test database. They **must** be run with `--runInBand`:

```bash
docker compose exec nestjs-api npm test -- --runInBand
docker compose exec nestjs-api npm run test:e2e   # already configured
```

Parallel execution causes FK violations, deadlocks, and cross-suite contamination because suites truncate or seed shared tables concurrently.

During active development, run only the tests related to the file being changed (`npm test -- path/to/file.spec.ts`). Before declaring a task done, run the full suite — see the global `CLAUDE.md` → "Definition of Done (Technical)".

## Long-running Processes

Commands that never exit (dev server, watch modes) must be run in background in the Bash tool — otherwise the agent blocks indefinitely waiting for the process to return.

This applies to: `start:dev`, `start:prod`, `test:watch`, and any other persistent process.

## Test Type Selection

Choose the suffix by what the test really does, not by where the code under test lives. The suffix is a contract that drives Jest config (`testRegex`, parallelism), CI steps, and reader expectations.

| Suffix                  | Purpose                                                              | DB / external I/O | Location                     |
|-------------------------|----------------------------------------------------------------------|-------------------|------------------------------|
| `*.spec.ts`             | **Unit** — pure logic, all collaborators mocked                      | Forbidden         | Next to the source file      |
| `*.integration-spec.ts` | **Integration** — exercises real DB, real repositories, real modules | Required          | Next to the source file      |
| `*.e2e-spec.ts`         | **End-to-end** — full HTTP cycle via `supertest`                     | Required          | `nestjs-project/test/`       |

A test that constructs a `TypeOrmModule.forRoot`, opens a connection, or hits the `db` service **must** be `*.integration-spec.ts`, never `*.spec.ts`. A test that boots the full Nest application and makes HTTP calls **must** be `*.e2e-spec.ts`.

Conventions for **how to write** each kind of test (mocking patterns, AAA structure, override strategies for global guards, etc.) live in `.claude/rules/nestjs-testing.md` and load when you edit a test file.

## Jest Configuration

These settings are required in `package.json` (jest config) and `test/jest-e2e.json` for the project's tests to work correctly:

- `setupFiles: ["dotenv/config"]` — without this, `.env` is not loaded inside the Jest process. `DB_HOST`, `JWT_SECRET`, etc. fall back to undefined or to the host's `localhost`, breaking container-to-container DNS.
- `testRegex: '.*\\.(spec|integration-spec)\\.ts$'` — covers both unit (`*.spec.ts`) and integration (`*.integration-spec.ts`) suffixes.

Do not add new test-file suffixes; if a new test type is needed, update the regex deliberately.

### Pure-ESM dependencies (`transformIgnorePatterns` / `moduleNameMapper`)

Several runtime dependencies (`pg-boss`, `@tus/server`/`@tus/s3-store`, `execa`) ship as pure ESM with no CommonJS build. Jest's default `transformIgnorePatterns` excludes all of `node_modules`, so a static `import` of one of these packages fails with `SyntaxError: Cannot use import statement outside a module` unless the package (and every ESM package in its transitive import chain) is whitelisted in `package.json`'s jest config `transformIgnorePatterns`. Whitelisting is viral: tracing a new ESM dependency's chain (e.g. adding `execa` pulled in `@sindresorhus/merge-streams`, `figures`, `get-stream`, `human-signals`, `is-plain-obj`, `is-stream`, `npm-run-path`, `pretty-ms`, `strip-final-newline`, `which-command`, `yoctocolors`, `parse-ms`, `@sec-ant/readable-stream`, `is-unicode-supported`, and `path-key`) requires actually running the test and whitelisting each `SyntaxError`-reported package one at a time until it passes — do not try to guess the full chain upfront.

A rarer, harder failure: some packages (e.g. `unicorn-magic`, a transitive dep of `execa` via `npm-run-path`) declare a package.json `exports` map with **only** `"import"` conditions at every leaf — there is no `require`-resolvable entry point at all, so even with transformIgnorePatterns whitelisting it, Jest's CJS resolver throws `Cannot find module` (a resolution failure, not a parse failure). The fix is a `moduleNameMapper` entry that redirects the bare specifier straight to the package's concrete ESM file, bypassing the exports-map resolution:

```json
"moduleNameMapper": {
  "^unicorn-magic$": "<rootDir>/../node_modules/unicorn-magic/default.js"
}
```

(`rootDir` is `src/` in this project's jest config, hence `../node_modules/...`.) Dynamic `import()` is **not** a viable workaround here — Jest's default (non-VM-modules) runtime throws `A dynamic import callback was invoked without --experimental-vm-modules`, and enabling that flag project-wide breaks the existing static `import` of already-whitelisted ESM packages like `pg-boss` (which rely on the transform-to-CJS workaround, not real ESM loading).

## Environment File Conventions

`.env` is parsed by both Docker Compose and `dotenv` — values containing shell-special characters (`<`, `>`, `|`, `&`, spaces) **must be quoted** or rewritten:

```dotenv
# Wrong — the unquoted angle brackets are shell redirection syntax and break parsing
MAIL_FROM=StreamTube <noreply@streamtube.local>

# Right — quote the value
MAIL_FROM="StreamTube <noreply@streamtube.local>"
```

Whenever possible, prefer storing only the bare address in `.env` and composing display names in code (e.g., in `mail.config.ts`) so the file stays shell-safe.

## Build Assets

`tsc` (and therefore `nest build`) only emits compiled `.ts` files to `dist/`. Any non-TypeScript runtime asset — Handlebars templates (`.hbs`), JSON fixtures, static config files, etc. — must be declared in `nest-cli.json` under `compilerOptions.assets` (with `watchAssets: true` for dev). Without that, the file exists in `src/` but is missing in `dist/` and runtime fails only after build.

## System Dependencies (Dockerfile.dev)

`Dockerfile.dev` installs `ffmpeg` (apt package) alongside `procps`/`curl` — it provides both the `ffmpeg` and `ffprobe` binaries the Video Worker invokes via `execa` to extract metadata and generate thumbnails.

**Gotcha — Compose builds a separate image per service, even when they share one Dockerfile.** `nestjs-api` and `nestjs-worker` both build from `Dockerfile.dev`, but Docker Compose tags each service's result independently (`nestjs-project-nestjs-api`, `nestjs-project-nestjs-worker`) — rebuilding one does **not** rebuild the other. This actually happened: adding `ffmpeg` here and running `docker compose build nestjs-api` left `nestjs-worker` on its old image with no `ffmpeg`/`ffprobe` at all, so every processing job failed with a binary-not-found error that no test caught (every test that shells out to `ffmpeg` runs inside the `nestjs-api` container via `npm test`, never inside the actual `nestjs-worker` container). After any `Dockerfile.dev` change, rebuild **both**: `docker compose build nestjs-api nestjs-worker` (or just `docker compose build` with no service arg, or `docker compose up -d --build` to rebuild-and-recreate everything in one step) — never target a single service by name when the change is to the shared Dockerfile.

## Architecture

NestJS with standard module structure. Source lives in `src/`, compiled output in `dist/`.

- Each domain feature gets its own module (e.g., `UsersModule`, `VideosModule`) registered in `AppModule`
- Controllers handle HTTP routing; Services hold business logic; both are scoped to their module

### Two application bootstraps

This codebase ships **two** NestFactory entrypoints, sharing all entities/config/modules — not two subprojects:

- `src/main.ts` → `AppModule`, `NestFactory.create()` + `app.listen()` — the HTTP API (`nestjs-api` service)
- `src/worker/main.ts` → `WorkerModule`, `NestFactory.createApplicationContext()` — the background job consumer (`nestjs-worker` service), **no HTTP listener**. `WorkerModule` (`src/worker/worker.module.ts`) imports only the infra/domain modules the worker actually needs (`ConfigModule`, `TypeOrmModule`, `JobsModule`, `StorageModule`, `VideosModule`) plus a bare `TypeOrmModule.forFeature([User])` — it does not import `AuthModule`/`UploadsModule`/`UsersModule`, since the worker never handles HTTP requests or needs user business logic.
- Job handlers (e.g. `VideoProcessingHandler` in `src/worker/video-processing.handler.ts`) register themselves against a queue via `JobsService.work()` inside their own `onModuleInit()` — they are plain providers in `WorkerModule`, not controllers.
- When adding a new background job, extend `WorkerModule`'s imports/providers, not `AppModule`'s — keep the two bootstraps' dependency graphs independent so `nestjs-api` never needs queue-consumer code and `nestjs-worker` never needs route/guard code.

### Object storage key coordination

The object key is a flat `{videoId}.{ext}` / `{videoId}-thumbnail.jpg` (`StorageService.generateObjectKey`/`generateThumbnailKey`, per `phase-03-videos/TD-08`). Nothing in the database enforces that every layer actually writes to or reads from this same key — each layer computes or is told the key independently, so a layer that diverges fails **silently downstream**, not at the point of divergence:

- `VideosService.createDraft` computes and persists `Video.object_key` *before* any upload starts.
- The tus upload path must be explicitly told to use that same key — `@tus/s3-store` does not know about `Video.object_key` on its own. It's wired via `@tus/server`'s `namingFunction` option in `createTusServer()` (`src/uploads/tus-server.factory.ts`), which looks up `Upload-Metadata`'s `videoId` via `UploadsService.getObjectKey()` and returns `video.object_key`. **If `namingFunction` is ever removed or left unset, `@tus/s3-store` silently falls back to its own randomly-generated upload id as the S3 key** — uploads still report `204`/success and the DB still flips to `uploaded` (nothing on that path reads the actual bytes), so the break only surfaces later, as every processing job failing with a storage "not found" error once the worker tries to download a key that was never written. This exact regression happened once already and was only caught by manually driving a real tus upload end-to-end — no existing automated test exercises the real tus-upload-key path together with the real worker (SI-03.6's e2e test only asserts DB status; SI-03.8's integration test seeds the object directly via the S3 SDK using the correct key, bypassing tus entirely).
- `VideoProcessingHandler` (the worker) and `VideosService.findOne`'s presigned-URL generation both read `Video.object_key`/`thumbnail_key` straight from the DB row — they trust it's correct.

When adding any new path that writes to or reads from object storage, use the `Video` row's own `object_key`/`thumbnail_key` columns as the single source of truth — never invent a new key-generation scheme, and never let a third-party library's own default id generation apply to a code path that stores anything this project later needs to locate by `videoId`.

**Gotcha — TypeORM relation metadata when extending `WorkerModule`'s imports:** if a module you add has an entity with a relation (`@OneToOne`, `@ManyToOne`, etc.) pointing to an entity that no module in `WorkerModule`'s import graph registers, `DataSource.initialize()` throws `Entity metadata for <Entity>#<field> was not found` — TypeORM requires every entity on *both* sides of a relation to be present in the same `DataSource`, even if the worker never queries that entity directly. Fix by adding a bare `TypeOrmModule.forFeature([TheRelatedEntity])` to `WorkerModule` (entity registration only — don't pull in the whole owning module and its services/controllers). Example: adding `VideosModule` pulled in `ChannelsModule` → `Channel`, whose `user` field is a `@OneToOne(() => User, ...)` — `User` had to be registered the same way even though the worker never reads `User` rows.

**Gotcha — testing a bootstrap via `NestFactory.createApplicationContext()`/`create()` directly:** always pass `abortOnError: false`. The default (`true`) calls `process.exit(1)` synchronously on *any* bootstrap error instead of rejecting the returned promise — inside a Jest test this kills the whole worker process, which Jest's parent then reports as a misleading `"Exceeded timeout of Xms"` rather than the real error. This only applies when bootstrapping via raw `NestFactory` (as `worker-bootstrap.integration-spec.ts` does, to exercise the real production entrypoint) — `Test.createTestingModule()`-based tests aren't affected.

## Code Conventions

- **TypeScript:** `nodenext` module resolution, `ES2023` target, `strictNullChecks` on, `noImplicitAny` off
- **Decorators:** `emitDecoratorMetadata` + `experimentalDecorators` enabled — required for NestJS DI
- **Prettier:** single quotes, trailing commas everywhere
- **ESLint:** `no-explicit-any` allowed; `no-floating-promises` and `no-unsafe-argument` are warnings

## REST Conventions

This is a RESTful API. All endpoints must follow standard REST conventions — correct HTTP methods, proper status codes, plural resource nouns, and consistent URL structure. Details are enforced via rules on controller files.
