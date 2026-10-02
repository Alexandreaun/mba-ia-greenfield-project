---
kind: phase
name: phase-03-videos
status: clean
issue_count: 0
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-10-02T15:37:21-0300"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-02T15:23:24-0300"
issues:
  - id: OQ-1
    status: resolved
    summary: "TD-01 pending — Object Storage Backend & SDK"
    resolved_by: phase-03-videos/TD-01
  - id: OQ-2
    status: resolved
    summary: "TD-02 pending — Upload Protocol & Resumability"
    resolved_by: phase-03-videos/TD-02
  - id: OQ-3
    status: resolved
    summary: "TD-03 pending — Draft Video Pre-registration Flow"
    resolved_by: phase-03-videos/TD-03
  - id: OQ-4
    status: resolved
    summary: "TD-04 pending — Background Job Queue Technology"
    resolved_by: phase-03-videos/TD-04
  - id: OQ-5
    status: resolved
    summary: "TD-05 pending — Video Worker Subproject Placement & Compose Topology"
    resolved_by: phase-03-videos/TD-05
  - id: OQ-6
    status: resolved
    summary: "TD-06 pending — Video Processing / FFmpeg Invocation Approach"
    resolved_by: phase-03-videos/TD-06
  - id: OQ-7
    status: resolved
    summary: "TD-07 pending — Streaming & Download Delivery Mechanism"
    resolved_by: phase-03-videos/TD-07
  - id: OQ-8
    status: resolved
    summary: "TD-08 pending — Object Storage Key Strategy & Uniqueness Guarantee"
    resolved_by: phase-03-videos/TD-08
  - id: OQ-9
    status: resolved
    summary: "TD-09 pending — Video Processing Status Lifecycle & Failure Handling"
    resolved_by: phase-03-videos/TD-09
---

# phase-03-videos — Validation

## Findings

### Inconsistencies

_None._ The 9 decided choices remain mutually compatible. No decided TD's `Capability:` field cites a bullet outside `## Scope`.

### Ambiguities

_None._

### Missing Decisions

_None._ All 9 capabilities have ≥1 decided TD. The shared-types contract-sync check (Decisão #29) does not apply — no active UI scope in this phase (the newly inherited `openapi-docs-nestjs` and `next-frontend-openapi-typing` TDs are informational background, not a trigger, since `ui_in_scope` is false here).

### Dependency Gaps

_None._

### Inherited Constraint Conflicts

_None._ Re-checked against the expanded `## Inherited Decisions Detail` (now also includes `openapi-docs-nestjs` and `next-frontend-config-base` TDs from the correlator): no current-scope TD conflicts with the inherited OpenAPI-exposure policy or the inherited strict-BFF `API_URL` constraint — TD-07's direct `Frontend → Object Storage` presigned URL flow remains the documented architectural exception, not a contradiction of either.

### Unresolved Open Questions

_None._ All 9 TDs remain decided (carried forward as resolved from the prior revision — see `## Resolved Issues`).

### UI Coverage Gaps

_None._ `## UI Inventory` is absent for this phase.

## Resolved Issues

- **OQ-1** _(resolved_by phase-03-videos/TD-01)_ — TD-01 pending — Object Storage Backend & SDK. Decided: A — `@aws-sdk/client-s3` + MinIO (Docker Compose).
- **OQ-2** _(resolved_by phase-03-videos/TD-02)_ — TD-02 pending — Upload Protocol & Resumability. Decided: A — tus protocol (`@tus/server` + `@tus/s3-store` + `tus-js-client`).
- **OQ-3** _(resolved_by phase-03-videos/TD-03)_ — TD-03 pending — Draft Video Pre-registration Flow. Decided: B — Endpoint REST dedicado antes do upload.
- **OQ-4** _(resolved_by phase-03-videos/TD-04)_ — TD-04 pending — Background Job Queue Technology. Decided: B — pg-boss (fila sobre PostgreSQL).
- **OQ-5** _(resolved_by phase-03-videos/TD-05)_ — TD-05 pending — Video Worker Subproject Placement & Compose Topology. Decided: B — Entrypoint adicional dentro de `nestjs-project/`.
- **OQ-6** _(resolved_by phase-03-videos/TD-06)_ — TD-06 pending — Video Processing / FFmpeg Invocation Approach. Decided: A — invocação direta via `child_process` (execa).
- **OQ-7** _(resolved_by phase-03-videos/TD-07)_ — TD-07 pending — Streaming & Download Delivery Mechanism. Decided: A — URLs assinadas (presigned GET) direto do Object Storage.
- **OQ-8** _(resolved_by phase-03-videos/TD-08)_ — TD-08 pending — Object Storage Key Strategy & Uniqueness Guarantee. Decided: A — Chave plana baseada no UUID do vídeo.
- **OQ-9** _(resolved_by phase-03-videos/TD-09)_ — TD-09 pending — Video Processing Status Lifecycle & Failure Handling. Decided: A — Enum granular + retry/backoff/DLQ nativos do pg-boss.
