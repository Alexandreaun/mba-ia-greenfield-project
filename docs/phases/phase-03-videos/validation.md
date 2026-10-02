---
kind: phase
name: phase-03-videos
status: clean
issue_count: 0
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-10-02T17:18:54-0300"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-02T17:11:36-0300"
  docs/phases/phase-03-videos/library-refs.md: "2026-10-02T18:03:09-0300"
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

_None._ Adding explicit `**Libraries:**` fields to the 9 decided TDs changed no scope or decision content — the 9 choices remain mutually compatible.

### Ambiguities

_None._

### Missing Decisions

_None._ All 9 capabilities have ≥1 decided TD. No active UI scope, so the shared-types contract-sync check (Decisão #29) does not apply.

### Dependency Gaps

_None._

### Inherited Constraint Conflicts

_None._ Re-checked against the expanded `## Inherited Decisions Detail` (now also includes `next-frontend-msw-foundation` alongside `openapi-docs-nestjs`, `next-frontend-openapi-typing`, `next-frontend-config-base`): no conflicts with the inherited strict-BFF / OpenAPI-exposure conventions.

### Unresolved Open Questions

_None._ All 9 TDs remain decided (carried forward as resolved — see `## Resolved Issues`).

### UI Coverage Gaps

_None._ `## UI Inventory` is absent for this phase.

## Resolved Issues

- **OQ-1** _(resolved_by phase-03-videos/TD-01)_ — TD-01 pending — Object Storage Backend & SDK. Decided: A — `@aws-sdk/client-s3` + MinIO (Docker Compose). Libraries: @aws-sdk/client-s3, @aws-sdk/lib-storage, @aws-sdk/s3-request-presigner.
- **OQ-2** _(resolved_by phase-03-videos/TD-02)_ — TD-02 pending — Upload Protocol & Resumability. Decided: A — tus protocol. Libraries: @tus/server, @tus/s3-store, tus-js-client.
- **OQ-3** _(resolved_by phase-03-videos/TD-03)_ — TD-03 pending — Draft Video Pre-registration Flow. Decided: B — Endpoint REST dedicado antes do upload.
- **OQ-4** _(resolved_by phase-03-videos/TD-04)_ — TD-04 pending — Background Job Queue Technology. Decided: B — pg-boss. Libraries: pg-boss.
- **OQ-5** _(resolved_by phase-03-videos/TD-05)_ — TD-05 pending — Video Worker Subproject Placement & Compose Topology. Decided: B — Entrypoint adicional dentro de `nestjs-project/`.
- **OQ-6** _(resolved_by phase-03-videos/TD-06)_ — TD-06 pending — Video Processing / FFmpeg Invocation Approach. Decided: A — invocação direta via `execa`. Libraries: execa.
- **OQ-7** _(resolved_by phase-03-videos/TD-07)_ — TD-07 pending — Streaming & Download Delivery Mechanism. Decided: A — URLs assinadas (presigned GET). Libraries: @aws-sdk/s3-request-presigner.
- **OQ-8** _(resolved_by phase-03-videos/TD-08)_ — TD-08 pending — Object Storage Key Strategy & Uniqueness Guarantee. Decided: A — Chave plana baseada no UUID do vídeo.
- **OQ-9** _(resolved_by phase-03-videos/TD-09)_ — TD-09 pending — Video Processing Status Lifecycle & Failure Handling. Decided: A — Enum granular + retry/backoff/DLQ nativos do pg-boss. Libraries: pg-boss.
