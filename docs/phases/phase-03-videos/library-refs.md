---
libs:
  "@aws-sdk/client-s3":
    version: "^3.x"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-10-02T18:02:47-03:00"
  "@aws-sdk/lib-storage":
    version: "^3.x"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-10-02T18:02:47-03:00"
  "@aws-sdk/s3-request-presigner":
    version: "^3.x"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-10-02T18:02:47-03:00"
  "@tus/server":
    version: "latest"
    context7_id: "/tus/tus-node-server"
    fetched_at: "2026-10-02T18:02:47-03:00"
  "@tus/s3-store":
    version: "latest"
    context7_id: "/tus/tus-node-server"
    fetched_at: "2026-10-02T18:02:47-03:00"
  "tus-js-client":
    version: "latest"
    context7_id: "/tus/tus-js-client"
    fetched_at: "2026-10-02T18:02:47-03:00"
  "pg-boss":
    version: "latest"
    context7_id: "/websites/deepwiki_timgit_pg-boss"
    fetched_at: "2026-10-02T18:02:47-03:00"
  "execa":
    version: "latest"
    context7_id: "/sindresorhus/execa"
    fetched_at: "2026-10-02T18:02:47-03:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-02T17:11:36-03:00"
---

### @aws-sdk/client-s3

Create one `S3Client` per credentials/region and reuse it across operations instead of instantiating per-call:

```javascript
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

const client = new S3Client({ region, credentials }); // for MinIO: also set endpoint + forcePathStyle

await client.send(new PutObjectCommand({ Bucket, Key, Body }));
await client.send(new GetObjectCommand({ Bucket, Key }));
```

Import only the specific client + commands needed (tree-shakeable, reduces bundle size) rather than the aggregated client.

### @aws-sdk/lib-storage

`Upload` helper handles multipart upload transparently (concurrent parts, min 5MB partSize) — use for large video file uploads to S3/MinIO:

```javascript
import { Upload } from "@aws-sdk/lib-storage";
import { S3Client } from "@aws-sdk/client-s3";

const upload = new Upload({
  client: new S3Client({}),
  params: { Bucket, Key, Body },
  queueSize: 4,            // concurrency
  partSize: 1024 * 1024 * 5, // min 5MB
  leavePartsOnError: false,  // auto AbortMultipartUpload on failure
});

upload.on("httpUploadProgress", (progress) => console.log(progress));
await upload.done();
```

### @aws-sdk/s3-request-presigner

`getSignedUrl` generates presigned GET/PUT URLs; `expiresIn` defaults to 900s if omitted:

```javascript
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

const client = new S3Client(clientParams);
const url = await getSignedUrl(client, new GetObjectCommand(params), { expiresIn: 3600 });
```

To force `Content-Type` (or other headers) to be part of the signature on upload URLs, pass `signableHeaders`:

```javascript
const presigned = getSignedUrl(s3Client, new PutObjectCommand({ Bucket, Key, ContentType }), {
  signableHeaders: new Set(["content-type"]),
  expiresIn: expiration,
});
```

### @tus/server + @tus/s3-store

`Server` (from `@tus/server`) paired with `S3Store` (from `@tus/s3-store`) persists resumable-upload chunks directly to S3-compatible storage. Requires Node.js ≥ 20.19.0:

```typescript
import { Server } from "@tus/server";
import { S3Store } from "@tus/s3-store";

const s3Store = new S3Store({
  partSize: 8 * 1024 * 1024,
  s3ClientConfig: {
    bucket: process.env.AWS_BUCKET,
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  },
});

const server = new Server({ path: "/files", datastore: s3Store });
```

### tus-js-client

Client-side resumable upload via `tus.Upload`; supports resuming across browser sessions via `findPreviousUploads()` + `resumeFromPreviousUpload()`:

```javascript
const upload = new tus.Upload(file, {
  endpoint: "http://localhost:1080/files/",
  retryDelays: [0, 3000, 5000, 10000, 20000],
  metadata: { filename: file.name, filetype: file.type },
  onError: (error) => console.log("Failed because: " + error),
  onProgress: (bytesUploaded, bytesTotal) => {
    console.log(((bytesUploaded / bytesTotal) * 100).toFixed(2) + "%");
  },
  onSuccess: () => console.log("Uploaded to %s", upload.url),
});

upload.findPreviousUploads().then((previousUploads) => {
  if (previousUploads.length) upload.resumeFromPreviousUpload(previousUploads[0]);
  upload.start();
});
```

### pg-boss

PostgreSQL-backed job queue. Attach the error handler before `start()` (which initializes the schema if needed); `createQueue` then `send` to enqueue, `work` to register a processor:

```javascript
import { PgBoss } from "pg-boss";

const boss = new PgBoss(connectionString);
boss.on("error", console.error);
await boss.start();

await boss.createQueue("video-processing");
const jobId = await boss.send("video-processing", { videoId });

await boss.work("video-processing", async ([job]) => {
  // process job.data
});

// graceful shutdown
await boss.stop();
```

Retries: pass `retryLimit`, `retryDelay`, `retryBackoff` to `send()`:

```javascript
await boss.send("video-processing", data, {
  retryLimit: 3,
  retryDelay: 60,
  retryBackoff: true,
});
```

Failed jobs move `failed → created` (retryCount reset) via `retry()`; `completed`/`cancelled` jobs are unaffected by `retry()`.

### execa

Human-friendly child-process execution — use to invoke the FFmpeg binary from the video worker:

```javascript
import { execa } from "execa";

const { stdout, stderr } = await execa`ffmpeg -i input.mp4 -c:v libx264 output.mp4`;
```

Capture exit code without throwing: `const { exitCode } = await execa({ reject: false })\`ffmpeg ...\`;`

Guard against runaway stdout/stderr with `maxBuffer`; catch `error.isMaxBuffer` to detect the overflow case.
