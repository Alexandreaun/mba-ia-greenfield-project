---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.5
target_file: nestjs-project/test/videos-draft.e2e-spec.ts
---

# Endpoint Test Plan — POST /videos (Draft Creation)

## Application Overview

This endpoint pre-registers a video as a draft before any upload bytes arrive. The authenticated channel owner submits file metadata (`original_filename`, `mime_type`, `size_bytes`); the backend validates the size against the 10GB limit and the mime type against the supported-video allowlist, generates object/thumbnail storage keys, and persists a `Video` row with `status: 'draft'`. This is the entry point to the resumable tus upload flow (SI-03.6) — the draft's `id` correlates the subsequent upload.

## Test Scenarios

### 1. Draft creation

**Setup:** `beforeEach` truncate test DB via `cleanAllTables(dataSource)`; bootstrap via `Test.createTestingModule({ imports: [AppModule] }).compile()` + `app.init()` with the project's global `ValidationPipe` + `DomainExceptionFilter`/`ValidationExceptionFilter` (per `nestjs-project/test/auth.e2e-spec.ts` convention). Authenticated as a channel owner via the existing auth E2E login helper.

#### 1.1. valid-payload-creates-draft

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-06T13:11:44Z

**Steps:**
  1. POST /videos com body `{ original_filename, mime_type: "video/mp4", size_bytes: 1000000 }` autenticado como owner do canal
    - expect: resposta `201`
    - expect: body `{ id, status: "draft" }`
    - expect: Video row persistida no DB com `status: 'draft'` e o mesmo `id`

#### 1.2. size-exceeds-limit-rejected

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-06T13:11:44Z

**Steps:**
  1. POST /videos com body `{ original_filename, mime_type: "video/mp4", size_bytes: 10737418241 }` (10GB + 1 byte)
    - expect: resposta `400`
    - expect: body com `error: "VIDEO_TOO_LARGE"`
    - expect: nenhuma Video row persistida

#### 1.3. unsupported-mime-type-rejected

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-06T13:11:44Z

**Steps:**
  1. POST /videos com body `{ original_filename, mime_type: "application/pdf", size_bytes: 1000000 }`
    - expect: resposta `415`
    - expect: body com `error: "UNSUPPORTED_MEDIA_TYPE"`
    - expect: nenhuma Video row persistida
