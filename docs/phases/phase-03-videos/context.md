---
kind: phase
name: phase-03-videos
sources_mtime:
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

# phase-03-videos — Context

## Scope

**Phase name:** Upload e Processamento de Vídeos

**Capabilities** (literal, `docs/project-plan.md`):

- Serviço de armazenamento de arquivos (vídeos e thumbnails)
- Serviço de processamento em segundo plano (filas)
- Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- Processamento automático do vídeo após upload (extração de duração e metadados)
- Geração automática de thumbnail a partir de um frame do vídeo
- URL única por vídeo, sem conflito com outros vídeos
- Reprodução via streaming (sem necessidade de download completo)
- Download do vídeo pelo usuário

**Out of scope:** _Not specified._

**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas.

**Affected subprojects:** `nestjs-project` (object storage, background job queue, upload endpoint/protocol, FFmpeg-based processing, streaming/download URL generation) and `next-frontend` (resumable-upload UI, draft-video orchestration, streaming/download consumption) — per the decisions doc's `Subprojects in scope` note; `project-plan.md`'s own phase bullets are backend-only phrased, but the decisions doc explicitly scopes both subprojects (TD-02, TD-03, TD-07 are Cross-layer).

**Deferred subprojects:** _None._

**Sequencing notes:** "Depende de: Fase 01, Fase 02" — Phase 03 depends on Phase 01 and Phase 02 being completed first.

**Neighbors (for boundary detection only):**

- **Phase 02:** Cadastro, Login e Gerenciamento de Conta (Depende de: Fase 01).
- **Phase 04:** Gerenciamento de Vídeos e Canal (Depende de: Fase 02, Fase 03).

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | phase | Backend | Object Storage Backend & SDK | decided | A — `@aws-sdk/client-s3` + MinIO | — |
| phase-03-videos/TD-02 | phase | Cross-layer | Upload Protocol & Resumability | decided | A — tus protocol (`@tus/server`/`@tus/s3-store`/`tus-js-client`) | — |
| phase-03-videos/TD-03 | phase | Cross-layer | Draft Video Pre-registration Flow | decided | B — REST endpoint before upload | — |
| phase-03-videos/TD-04 | phase | Backend | Background Job Queue Technology | decided | B — pg-boss (over PostgreSQL) | — |
| phase-03-videos/TD-05 | phase | Repo-wide | Video Worker Subproject Placement & Compose Topology | decided | B — entrypoint inside `nestjs-project/` | — |
| phase-03-videos/TD-06 | phase | Backend | Video Processing / FFmpeg Invocation Approach | decided | A — direct binary invocation via `execa` | — |
| phase-03-videos/TD-07 | phase | Cross-layer | Streaming & Download Delivery Mechanism | decided | A — presigned GET URLs direct from storage | — |
| phase-03-videos/TD-08 | phase | Backend | Object Storage Key Strategy & Uniqueness Guarantee | decided | A — flat key based on video UUID | — |
| phase-03-videos/TD-09 | phase | Backend | Video Processing Status Lifecycle & Failure Handling | decided | A — granular enum + pg-boss retry/backoff/DLQ | — |

_Source files:_

- phase-03-videos — `docs/decisions/technical-decisions-phase-03-videos.md` (scope_type: phase)

## Capability Coverage

| Capability (from project-plan.md) | Covered by |
|-----------------------------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-01, phase-03-videos/TD-05 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-04, phase-03-videos/TD-05 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-02 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-03, phase-03-videos/TD-09 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-05, phase-03-videos/TD-06, phase-03-videos/TD-09 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-06 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-08 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-07 |
| Download do vídeo pelo usuário | phase-03-videos/TD-07 |

_All 9 capabilities have ≥1 covering TD, and all 9 TDs are decided._

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** MinIO local + `@aws-sdk/client-s3`/`lib-storage`/`s3-request-presigner`. É o único caminho que atende ao "Object Storage: S3 or MinIO" do diagrama de arquitetura sem duplicar código de integração entre dev e produção: o mesmo cliente e os mesmos comandos funcionam contra MinIO local e contra AWS S3 real, trocando apenas `endpoint`/credenciais via env — consistente com o padrão de configuração namespaced já estabelecido na Fase 01.
**Libraries:** —

### phase-03-videos/TD-02

**Recommendation:** É a única opção que resolve resumabilidade como propriedade nativa do protocolo em vez de responsabilidade customizada, que é exatamente o requisito não-funcional citado nos Pontos de Atenção do projeto. A Option B alcançaria o mesmo resultado, mas exigiria reimplementar manualmente o controle de estado que o tus já resolve.
**Libraries:** —

### phase-03-videos/TD-03

**Recommendation:** Mantém a criação do rascunho como uma operação de domínio comum (`VideosService.createDraft()`), desacoplada do protocolo de upload escolhido na TD-02. Isso respeita o princípio de responsabilidade única já adotado no projeto (`CLAUDE.md` → Working Principles) e evita que `VideosModule` precise conhecer detalhes do `@tus/server`.
**Libraries:** —

### phase-03-videos/TD-04

**Recommendation:** O volume de jobs da Fase 03 é simples (um job de processamento por vídeo enviado, sem dependências entre jobs nem necessidade de rate limiting de fila), e o projeto não usa Redis em nenhuma outra parte do stack. pg-boss entrega as garantias necessárias (retry, concorrência segura) reaproveitando o Postgres já provisionado. Se fases futuras exigirem features de fila mais avançadas, a migração para BullMQ pode ser revisitada como uma nova decisão.
**Libraries:** —

### phase-03-videos/TD-05

**Recommendation:** Dado que o monorepo ainda não decidiu nenhuma ferramenta de workspace para compartilhar código Node entre subprojetos, criar um novo subprojeto físico forçaria duplicar entidades e configuração. Reaproveitar o código e a stack Compose do `nestjs-project` mantém a responsabilidade única no nível de módulo NestJS (um `WorkerModule`/bootstrap dedicado, sem HTTP), sem pagar o custo de duplicação de infraestrutura.
**Libraries:** —

### phase-03-videos/TD-06

**Recommendation:** Depois do abandono do `fluent-ffmpeg`, apostar em outro wrapper de terceiros de baixíssima adoção (`mediaforge`) repete o mesmo risco que acabou de se materializar. Chamar os binários diretamente com `execa` é mais verboso, mas a superfície de manutenção fica limitada a uma lib de execução de processos genérica que não some do dia para a noite.
**Libraries:** —

### phase-03-videos/TD-07

**Recommendation:** Segue exatamente a relação `Frontend → Storage` já definida no C4, evita transformar a API num proxy de banda larga para arquivos de até 10GB, e reaproveita o suporte nativo a Range/`Content-Disposition` do storage sem código adicional. A regra de BFF estrito do frontend continua vigente para toda comunicação com a API NestJS — este fluxo é a exceção documentada no próprio diagrama de arquitetura.
**Libraries:** —

### phase-03-videos/TD-08

**Recommendation:** A garantia de unicidade já existe de graça no UUID v4 que o Postgres gera para `Video.id` em TD-03; usar esse mesmo valor como chave do objeto elimina qualquer decisão adicional de "como evitar colisão" e mantém o cálculo da chave idêntico e trivial em toda camada que precisa dele (upload handler, worker FFmpeg, gerador de URL assinada da TD-07).
**Libraries:** —

### phase-03-videos/TD-09

**Recommendation:** Aproveita o retry + backoff + DLQ nativos do pg-boss (já decidido em TD-04) sem nenhum código customizado, cobrindo o caso comum de falha transitória sem exigir reupload manual; aceita o custo de artefatos parciais órfãos como aceitável no volume inicial do projeto. Notificação ativa (push/toast) fica fora de escopo nesta fase: o padrão de polling via GET já é o que TD-07 assume para a URL de streaming.
**Libraries:** —

## Inherited Decisions Detail

### phase-01-configuracao-base/TD-01

**Recommendation:** Option A (@nestjs/config) — Official, core-team-maintained, guaranteed NestJS 11 compatibility. The `registerAs()` factory pattern solves the TypeORM CLI sharing problem: the factory function can be imported as a plain function by `data-source.ts` while also serving as a DI injection token inside NestJS. Building a custom module recreates solved functionality; third-party packages carry maintenance risk.
**Libraries:** `@nestjs/config@^4.x`

### phase-01-configuracao-base/TD-02

**Recommendation:** Option A (Joi) — First-class integration with `@nestjs/config` via `validationSchema`, requiring zero custom wiring. Handles string-to-number coercion natively. Using a different tool for env validation vs. request validation is reasonable — env config is validated once at startup, DTOs are validated per-request. Zod is elegant but adds a third validation paradigm to the project.
**Libraries:** `joi@^17.x`

### phase-01-configuracao-base/TD-03

**Recommendation:** Option B (Namespaced/grouped with registerAs) — The project roadmap explicitly calls for auth, email, and storage in upcoming phases. Namespaced configs provide clear file boundaries per domain, typed injection via `ConfigType<typeof databaseConfig>`, and natural scalability. The `registerAs()` factory is dual-purpose: DI token inside NestJS and plain importable function for `data-source.ts`. Initial files for Phase 01: `src/config/database.config.ts`, `src/config/app.config.ts`.
**Libraries:** —

### phase-01-configuracao-base/TD-04

**Recommendation:** Option A (Shared registerAs factory) — Natural outcome of choosing `@nestjs/config` with `registerAs`. The factory is already callable by design. `data-source.ts` imports it, calls `dotenv.config()`, then calls the factory. Zero duplication, minimal code, no extra abstraction.
**Libraries:** `dotenv` (transitive via `@nestjs/config`)

### phase-02-auth/TD-01

**Recommendation:** Argon2id — For a greenfield project in 2026, Argon2id is the OWASP-recommended choice. The native build dependency is a one-time Docker setup cost. The project has no legacy constraints favoring bcrypt. OWASP minimum: 19MiB memory, 2 iterations.
**Libraries:** `argon2@^0.41.x`

### phase-02-auth/TD-02

**Recommendation:** Option A (@nestjs/passport) — The project plan includes only email/password auth for now, but the plugin architecture costs little and future phases may add social login. Aligns with official NestJS docs, making onboarding and maintenance easier.
**Note:** Decision deliberately diverged from the Recommendation during implementation — custom guards were preferred over `@nestjs/passport` to keep the dependency surface smaller; social login is not on the near-term roadmap, so the plugin-architecture benefit did not justify the extra abstraction layer.
**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-03

**Recommendation:** Option A (Refresh Token Rotation) — Provides the strongest security model with automatic theft detection. The DB write overhead is acceptable for a video platform (auth refresh is infrequent vs. video operations). PostgreSQL is already in the stack, so no new infrastructure needed. Race conditions can be mitigated with a short grace period for the old token.
**Libraries:** —

### phase-02-auth/TD-04

**Recommendation:** Option B (Random Opaque Tokens in DB) — Revocability is important: when a user requests a new password reset, previous tokens should be invalidated. The DB table is trivial to implement, and the tokens table can also serve future needs (e.g., API keys). Keeps email tokens decoupled from the JWT auth system.
**Libraries:** —

### phase-02-auth/TD-05

**Recommendation:** Option A (@nestjs-modules/mailer) — Best NestJS integration with minimal boilerplate. Supports SMTP (matching the architecture diagram), works with MailHog/Mailpit for local development without external dependencies, and scales to any SMTP provider in production. Template engine support (Handlebars) simplifies email formatting. No vendor lock-in.
**Libraries:** `@nestjs-modules/mailer@^2.x`, `handlebars@^4.x`

### phase-02-auth/TD-06

**Recommendation:** Option A (class-validator + class-transformer) — This is a backend-only project (no shared schemas with frontend), so Zod's single-source-of-truth advantage is less impactful. class-validator is the documented NestJS approach, and the project already uses decorators extensively (TypeORM entities, NestJS DI). Fewer integration surprises with NestJS 11.
**Libraries:** `class-validator@^0.14.x`, `class-transformer@^0.5.x`

### phase-02-auth/TD-07

**Recommendation:** Option A (Custom Domain Exception Filter) — Provides machine-readable error codes that the Next.js frontend can switch on, without the overhead of RFC 9457's URI-based type system. The project is single-consumer (first-party frontend), so a simple `{ statusCode, error, message }` format with domain codes balances clarity and simplicity. The custom filter cost is low — two small files.
**Libraries:** —

### phase-02-auth/TD-08

**Recommendation:** Option A (@nestjs/throttler) — Native NestJS integration is decisive: the guard system allows scoping rate limiting to `AuthModule` only via module-level `APP_GUARD`, with `@SkipThrottle()` for exemptions. The project is single-instance with no distributed requirements, so in-memory storage is sufficient. Using express-rate-limit would bypass NestJS's DI and guard lifecycle for no clear benefit.
**Libraries:** `@nestjs/throttler@^6.x`

### phase-02-auth/TD-09

**Recommendation:** Option B (Opaque) — Since DB lookup is mandatory (TD-03), JWT signature adds no security value. Opaque tokens are shorter, leak no data, and are simpler to generate.
**Note:** Decision deliberately diverged from the Recommendation — JWT was kept to reuse the access-token signing/verification infrastructure (`@nestjs/jwt`), trading token size and base64-readability for a single token format across the codebase.
**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-10

**Recommendation:** Option A — The platform is a video sharing service with URL-based channel handles. A strict `[a-z0-9_]` allowlist is the simplest and most portable choice: no extra dependencies, no edge cases around hyphen positioning, and the `user_<random>` fallback provides a valid handle even for extreme email prefixes. Hyphens can always be added in a future iteration if user feedback justifies it.
**Libraries:** —

### phase-02-auth-frontend/TD-01

**Recommendation:** Three reasons. (1) **Architectural fit.** The strict-BFF model in `next-frontend-config-base/TD-03` already nominates the Route Handler as the only NestJS caller; cookie-based sessions are the natural match, and Auth.js's framework adds layers between the BFF and the cookie that buy nothing because the backend is the auth authority. (2) **Smaller blast radius.** A ~50-LOC session helper is grep-friendly, debuggable, and test-friendly via the existing MSW+BFF integration test pattern. (3) **Compatibility with Next.js 16 / React 19.** Built-in `next/headers` `cookies()` is the canonical primitive both runtimes already use. Option C is rejected as unsafe (`localStorage` for refresh tokens) and architecturally regressive (loses RSC personalization).
**Libraries:** —

### phase-02-auth-frontend/TD-02

**Recommendation:** Three reasons. (1) **Defense in depth on the cookie content** — `httpOnly` blocks JS, encryption blocks accidental log/proxy inspection. (2) **Single cookie to manage** simplifies logout and avoids the orphan-cookie failure mode of Option A. (3) **Room to carry minimal user metadata** (`userId`, `email`, `channelSlug`) lets `app/layout.tsx` RSC render the authenticated chrome without a per-render `/auth/me` round-trip. Option C is rejected: it solves a problem (server-side revocation) the project does not have.
**Libraries:** iron-session

### phase-02-auth-frontend/TD-03

**Recommendation:** The single-flight detail is non-trivial and goes in the helper from day one — tested by MSW with a "two concurrent intercepted upstream calls; one refresh expected" assertion. Option B's client-driven pattern is rejected because it doesn't replace Option A (RSC still needs server-side refresh). Option C's pre-emptive timer is rejected because the failure modes (multiple tabs, sleep/wake) outweigh the latency saving.
**Libraries:** —

### phase-02-auth-frontend/TD-04

**Recommendation:** Three reasons. (1) **Decoupled from TD-05** — works with Route Handlers OR Server Actions. (2) **Aligned with shadcn's canonical form primitive** — the project already commits to `radix-nova` shadcn; `npx shadcn@latest add form` produces react-hook-form wrappers. (3) **Zod-first developer ergonomics match the rest of the FE foundation.** Option B is rejected for impedance with shadcn's primitive; Option C is rejected for per-field boilerplate.
**Libraries:** react-hook-form, @hookform/resolvers

### phase-02-auth-frontend/TD-05

**Recommendation:** Three reasons. (1) **Strict-BFF alignment** — `next-frontend-config-base/TD-03` named Route Handlers as the BFF surface. (2) **Test scaffold already exists** — `next-frontend-msw-foundation` was authored for Route-Handlers-as-functions. (3) **Single mutation surface** — Phase 02 sets the precedent for Phases 03–07. Option B fragments the BFF surface and forces test-pattern reinvention.
**Libraries:** —

### phase-02-auth-frontend/TD-06

**Recommendation:** Two reinforcing reasons. (1) **No first-render flicker, no round-trip** — the session is delivered in the same response as the page HTML. (2) **No new BFF endpoint** — the cookie is the source of truth, RSC reads it, the Provider broadcasts it. The `router.refresh()` requirement after mid-session mutations is a small price. Option B is rejected for the double-read-and-flicker; Option C is dominated.
**Libraries:** —

### phase-02-auth-frontend/TD-07

**Recommendation:** Three reasons. (1) **First-paint-correct** — the user sees the right outcome on the first paint. (2) **Single integration pattern across both flows** — confirmation is RSC-only; reset is RSC + Client form, both share the "RSC owns the token, Client Component owns the input" split. (3) **Email-prefetch behavior** is solved at the backend's idempotent-confirmation level. Option B's Route-Handler-as-link-target adds redirects for no clean gain. Option C is dominated.
**Libraries:** —

### next-frontend-openapi-typing/TD-01

**Recommendation:** Option A (`openapi-typescript` + `openapi-fetch`) — Strict BFF makes the SDK surface valueless on the client; types-first matches the rest of the FE foundation; MSW typing is solved by the same `paths` symbol. The marginal cost of adding `openapi-fetch` (~6KB, server-side only) removes `fetch` boilerplate in each Route Handler while staying within the BFF model.
**Libraries:** openapi-typescript, openapi-fetch

### next-frontend-openapi-typing/TD-02

**Recommendation:** Option B (committed local copy at `next-frontend/openapi.json` + repo-root sync script) — Preserves the compose-stack independence between the two subprojects; drift is eliminated structurally when paired with TD-03's CI freshness check; the committed local file is a real artifact in PR review.
**Libraries:** —

### next-frontend-openapi-typing/TD-03

**Recommendation:** Option C (committed + CI freshness check covering `openapi.json` and `types.gen.ts`) — the only option that makes contract drift both visible (in PR diffs) and impossible to merge accidentally.
**Libraries:** —

### next-frontend-openapi-typing/TD-04

**Recommendation:** Option A (single `lib/api/contracts.ts` with explicit aliases) — handles pass-through and reshape with the same mechanism, gives a single grep target for "what shape does the BFF expose", and decouples Component imports from App Router file paths.
**Libraries:** —

### next-frontend-openapi-typing/TD-05

**Recommendation:** Option A (hand-written MSW handlers typed via `paths`) — determinism over auto-generation (BFF integration tests assert on specific values); coherence with TD-01's `paths` type as the single contract anchor; negligible manual cost at this API scale.
**Libraries:** —

### openapi-docs-nestjs/TD-01

**Recommendation:** Option A (`@nestjs/swagger`) — é a única opção que preserva as decisões anteriores (`class-validator` em TD-06 de phase-02-auth) sem re-platform; o CLI plugin com `classValidatorShim: true` aproveita os decoradores `class-validator` existentes para inferir schemas.
**Libraries:** @nestjs/swagger

### openapi-docs-nestjs/TD-02

**Recommendation:** Option C (Ambos — UI interativa + `openapi.json` exportado) — o custo marginal sobre Option A é apenas um npm script e o benefício é uma fundação correta para futura integração FE sem perder a UI interativa que dev/QA usam.
**Libraries:** —

### openapi-docs-nestjs/TD-03

**Recommendation:** Option B (Apenas em dev/staging) — alinha com a postura defensiva já estabelecida na Fase 02; o `openapi.json` commitado em TD-02 cumpre o papel de "spec consultável fora da UI".
**Libraries:** —

### next-frontend-config-base/TD-01

**Recommendation:** Option A (Zod 4) — Type-inference matches the FE's strict-TS culture; ecosystem gravity in Next.js/React 19 (Server Actions, form resolvers); direct enablement of TD-02 Option A (`@t3-oss/env-nextjs`). Backend parity with Joi is not load-bearing since env schemas are not shared FE↔BE.
**Libraries:** zod

### next-frontend-config-base/TD-02

**Recommendation:** Option A (`@t3-oss/env-nextjs`) — the only option combining type-level `NEXT_PUBLIC_` prefix enforcement, runtime Proxy-based leak detection, and single-file/single-import-path consumer ergonomics.
**Libraries:** @t3-oss/env-nextjs

### next-frontend-config-base/TD-03

**Recommendation:** Option A (Strict BFF — single server-only `API_URL`) — aligned with the BFF testing strategy already documented in `next-frontend/CLAUDE.md`; eliminates CORS and public exposure of the backend URL. Note: for Phase 03+, large video payloads will need object-storage presigned URLs as a separate mechanism — this does not argue for a `NEXT_PUBLIC_API_URL` key (relevant to this phase's TD-07).
**Libraries:** —

## Inherited Conventions

- Backend config uses `@nestjs/config` with namespaced `registerAs(name, () => ({...}))` factories — one file per domain in `src/config/`. _(from phase 01)_
- Env variables are validated by a Joi schema in `src/config/env.validation.ts`, passed to `ConfigModule.forRoot({ validationSchema, validationOptions: {...} })`. _(from phase 01)_
- Config is injected into modules via `ConfigType<typeof xxxConfig>` and `@Inject(xxxConfig.KEY)`; the same factory is importable as a plain function for non-DI contexts (e.g., TypeORM CLI). _(from phase 01)_
- `data-source.ts` loads `.env` via `import 'dotenv/config'` at the top, then imports the config factory and calls it as a plain function. _(from phase 01)_
- Database connection parameters are sourced from a single `databaseConfig` factory — never duplicated between `AppModule` and `data-source.ts`. _(from phase 01)_
- `TypeOrmModule.forRootAsync` is used (not `forRoot`), with `imports: [ConfigModule]`, `inject: [databaseConfig.KEY]`, `useFactory` returning options including `autoLoadEntities: true`, `synchronize: false`. _(from phase 01)_

## Inherited Deferred Capabilities

| Capability | Status | Origin phase | Rationale |
|-----------|--------|--------------|-----------|
| Telas de frontend | deferred | phase-01-configuracao-base | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| Telas de cadastro, login, confirmação de conta e recuperação de senha | deferred | phase-02-auth | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| "Confirmação de conta via e-mail com link de ativação" | deferred | phase-02-auth-frontend | deferred_to_next_phase — UI landing screen de-scoped 2026-05-14; FE confirmation flow (TD-07) picked up by a future phase. BE side unchanged in `phase-02-auth`. |
| "Logout" | deferred | phase-02-auth-frontend | deferred_to_next_phase — logout button lives inside authenticated chrome (typically Phase 04). Phase 02 still implements POST `/api/auth/logout` so the contract is ready when the chrome lands. |
| "Recuperação de senha (destination screen / set-new-password)" | deferred | phase-02-auth-frontend | deferred_to_next_phase — `/forgot-password` ships this phase sending the e-mail; the reset-password destination screen is absent from Figma → link destination remains a 404 until a later phase delivers the screen. |
| "Telas de cadastro, login, confirmação de conta e recuperação de senha" | deferred | phase-02-auth-frontend | the umbrella bullet's full coverage requires the confirmação and reset-password destination screens; both are deferred per rows above. The 3 ship-this-phase telas (signup, login, forgot-password) are inventoried and covered by their own verbs; the umbrella bullet itself is deferred to the phase that lands the missing screens. |

## Non-UI / Deferred Capabilities

| Capability | Status | Rationale | TD refs |
|-----------|--------|-----------|---------|
| (empty on first assembly — plan-resolve appends rows as user marks capabilities) |

## Testing Requirements

_Capability bullets for this phase do not match UI phrasing (`Tela`, `Página`, `Área`, `Login`, `UI`) — no `## UI Inventory` section emitted. `next-frontend` is still affected (TD-02/TD-03/TD-07 are Cross-layer), so its testing requirements are listed below for the BFF/Route-Handler/Client-Component surface this phase will add._

### nestjs-project

| Artifact created | Required tests |
|---|---|
| Entity (`*.entity.ts`) | Integration: constraints, defaults, `select: false` |
| Service with branching + DB | Unit: branch logic (mock repo) + Integration: DB contract |
| Service with DB only (no branching) | Integration: DB contract |
| Service with configured lib (JWT, cache, queue) | Unit: real lib with test config |
| Service with side-effect dep (object storage, FFmpeg process) | Integration: real capture service (MinIO) or local adapter |
| Module with configured imports | Unit: compilation test |
| Controller | E2E only — do NOT write unit tests |
| DTO | E2E: one validation wiring test per endpoint |
| Guard (delegates to service for business logic) | E2E + Unit if complex internal logic |
| Guard (simple, delegates to Passport) | E2E only |
| Strategy (Passport) | E2E via guard |
| Pipe (custom transformation/validation) | Unit |
| Interceptor (response transform, logging) | Unit and/or E2E |
| Exception Filter | Unit + E2E |
| Middleware | E2E |

### next-frontend

| Artifact created | Required tests |
|---|---|
| Page — sync RSC, static, no logic | None at component level; cover only if part of a critical flow → `*.e2e-spec.ts` |
| Page — sync RSC composing client children | Test client children directly; cover rendered page via `*.e2e-spec.ts` |
| Page — async RSC (`async function Page()` with `await`) | `*.e2e-spec.ts` only — Vitest cannot render it |
| Layout (`layout.tsx`) | None unless it adds logic (auth gate, conditional render); else via E2E |
| Client component (`"use client"`) with state/handlers | `*.test.tsx` — RTL + `jsdom` docblock, mock `next/navigation`, MSW for fetch |
| Feature component (server, composes primitives) | Skip unit; cover via the page's E2E |
| shadcn UI primitive (`components/ui/*`) | None — trust the library; cover via consumers |
| Icon (`components/icons/*`) | None |
| `lib/` utility / boundary module with branching or shape assumptions | `*.test.ts` |
| Custom hook (`hooks/*`) | `*.test.ts(x)` with `renderHook`, `jsdom` docblock |
| Route handler (`app/api/**/route.ts`) — proxy or with branching | `*.integration.test.ts` with MSW (+ `*.test.ts` for extracted pure logic) |
