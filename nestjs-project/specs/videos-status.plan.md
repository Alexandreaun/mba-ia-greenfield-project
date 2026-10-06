---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.9
target_file: nestjs-project/test/videos-status.e2e-spec.ts
---

# Endpoint Test Plan — GET /videos/{id} (Status + Delivery URLs)

## Application Overview

This endpoint exposes a video's processing status and, once processing has succeeded (`status: 'ready'`), presigned streaming/download URLs generated via `StorageService.getPresignedGetUrl()` (per `phase-03-videos/TD-07`). Callers poll this endpoint after upload (SI-03.6) and background processing (SI-03.7/SI-03.8) to know when delivery URLs become available. Ownership is enforced — only the authenticated channel owner that created the draft may read it.

## Test Scenarios

### 1. Status and delivery URL gating

**Setup:** `beforeEach` truncate test DB via `cleanAllTables(dataSource)`; bootstrap via `Test.createTestingModule({ imports: [AppModule] }).compile()` + `app.init()` with the project's global `ValidationPipe` + `DomainExceptionFilter`/`ValidationExceptionFilter` (per `nestjs-project/test/auth.e2e-spec.ts` convention). Authenticated as a channel owner via the existing auth E2E login helper. Each scenario seeds a `Video` row directly via repository with the required `status`.

#### 1.1. ready-video-returns-delivery-urls

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-06T13:11:44Z

**Steps:**
  1. Seed a Video row owned by the caller's channel with `status: 'ready'`, then GET /videos/{id}
    - expect: resposta `200`
    - expect: body `urls.streamUrl` presente e truthy
    - expect: body `urls.downloadUrl` presente e truthy

#### 1.2. non-ready-video-returns-null-urls

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-06T13:11:44Z

**Steps:**
  1. Seed a Video row owned by the caller's channel with `status: 'processing'`, then GET /videos/{id}
    - expect: resposta `200`
    - expect: body `urls: null`

#### 1.3. not-owned-or-missing-returns-404

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-06T13:11:44Z

**Steps:**
  1. GET /videos/{id} com um id que não existe
    - expect: resposta `404`
    - expect: body com `error: "VIDEO_NOT_FOUND"`
  2. Seed a Video row owned por outro canal, então GET /videos/{id} autenticado como um canal diferente
    - expect: resposta `404`
    - expect: body com `error: "VIDEO_NOT_FOUND"`
