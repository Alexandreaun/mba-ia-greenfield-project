import express from 'express';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { ConfigType } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import storageConfig from '../src/config/storage.config';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { createTusServer } from '../src/uploads/tus-server.factory';
import { UploadsService } from '../src/uploads/uploads.service';
import { JOBS_QUEUES } from '../src/jobs/jobs.constants';
import { JobsService } from '../src/jobs/jobs.service';

function tusMetadata(pairs: Record<string, string>): string {
  return Object.entries(pairs)
    .map(([key, value]) => `${key} ${Buffer.from(value).toString('base64')}`)
    .join(',');
}

describe('uploads (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let throttlerStorage: ThrottlerStorageService;
  let uploadBase: ReturnType<typeof request>;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );

    // Tus mounting must happen before app.init() — Nest finalizes its router
    // (including a terminal catch-all) during init(), so raw Express
    // middleware registered afterward is never reached.
    const uploadsService = app.get(UploadsService);
    const jwtService = app.get(JwtService);
    const storage = app.get<ConfigType<typeof storageConfig>>(
      storageConfig.KEY,
    );
    const tusServer = createTusServer(uploadsService, jwtService, storage);
    const uploadApp = express();
    uploadApp.use(tusServer.handle.bind(tusServer));
    const expressInstance = app
      .getHttpAdapter()
      .getInstance() as express.Express;
    expressInstance.use('/uploads', uploadApp);

    await app.init();

    dataSource = app.get(DataSource);
    throttlerStorage = app.get<ThrottlerStorageService>(ThrottlerStorage);

    uploadBase = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    throttlerStorage.storage.clear();
  });

  async function captureConfirmationToken(
    email: string,
    password = 'password123',
  ): Promise<string> {
    const authService = app.get(AuthService);
    const mailServiceInstance = (authService as any).mailService;
    let capturedToken = '';
    jest
      .spyOn(mailServiceInstance, 'sendConfirmationEmail')
      .mockImplementationOnce(async (_e: string, _n: string, t: string) => {
        capturedToken = t;
      });
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password });
    return capturedToken;
  }

  async function registerConfirmAndLogin(
    email: string,
    password = 'password123',
  ): Promise<{ access_token: string }> {
    const token = await captureConfirmationToken(email, password);
    await request(app.getHttpServer())
      .get('/auth/confirm-email')
      .query({ token });
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });
    return { access_token: res.body.access_token };
  }

  async function createDraft(accessToken: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        original_filename: 'resumable.mp4',
        mime_type: 'video/mp4',
        size_bytes: 20,
      });
    return res.body.id;
  }

  it('completes a multi-chunk upload, flips status to uploaded, and enqueues exactly one video.process job', async () => {
    const { access_token } = await registerConfirmAndLogin(
      'uploads-1@example.com',
    );
    const videoId = await createDraft(access_token);

    const jobsService = app.get(JobsService);
    let deliveries = 0;
    // The real queue is shared across test runs, so a stray leftover job
    // from an earlier/unrelated run could be delivered first — only count
    // and resolve on the job this test actually sent.
    const firstDelivery = new Promise<{ videoId: string; objectKey: string }>(
      (resolve) => {
        void jobsService.work<{ videoId: string; objectKey: string }>(
          JOBS_QUEUES.VIDEO_PROCESS,
          async ([job]) => {
            if (job.data.videoId !== videoId) return;
            deliveries += 1;
            resolve(job.data);
          },
        );
      },
    );

    const body = Buffer.from('0123456789abcdefghij'); // 20 bytes
    const firstHalf = body.subarray(0, 10);
    const secondHalf = body.subarray(10, 20);

    const createRes = await uploadBase
      .post('/uploads')
      .set('Authorization', `Bearer ${access_token}`)
      .set('Tus-Resumable', '1.0.0')
      .set('Upload-Length', String(body.length))
      .set('Upload-Metadata', tusMetadata({ videoId }));

    expect(createRes.status).toBe(201);
    const location = createRes.headers.location;
    expect(location).toBeDefined();
    const uploadPath = location.startsWith('http')
      ? new URL(location).pathname
      : location;

    const patch1 = await uploadBase
      .patch(uploadPath)
      .set('Authorization', `Bearer ${access_token}`)
      .set('Tus-Resumable', '1.0.0')
      .set('Upload-Offset', '0')
      .set('Content-Type', 'application/offset+octet-stream')
      .send(firstHalf);

    expect(patch1.status).toBe(204);
    expect(patch1.headers['upload-offset']).toBe('10');

    // Mid-upload, status should still be draft (not yet "uploaded")
    const midCheck = await dataSource.query(
      'SELECT status FROM "videos" WHERE id = $1',
      [videoId],
    );
    expect(midCheck[0].status).toBe('draft');

    const patch2 = await uploadBase
      .patch(uploadPath)
      .set('Authorization', `Bearer ${access_token}`)
      .set('Tus-Resumable', '1.0.0')
      .set('Upload-Offset', '10')
      .set('Content-Type', 'application/offset+octet-stream')
      .send(secondHalf);

    expect(patch2.status).toBe(204);
    expect(patch2.headers['upload-offset']).toBe('20');

    const finalCheck = await dataSource.query(
      'SELECT status FROM "videos" WHERE id = $1',
      [videoId],
    );
    expect(finalCheck[0].status).toBe('uploaded');

    const jobData = await firstDelivery;
    expect(jobData.videoId).toBe(videoId);
    expect(typeof jobData.objectKey).toBe('string');
    expect(deliveries).toBe(1);
  }, 15000);

  it('rejects POST /uploads with a videoId that does not belong to the caller channel', async () => {
    const { access_token: ownerToken } = await registerConfirmAndLogin(
      'uploads-owner@example.com',
    );
    const videoId = await createDraft(ownerToken);

    const { access_token: strangerToken } = await registerConfirmAndLogin(
      'uploads-stranger@example.com',
    );

    const res = await uploadBase
      .post('/uploads')
      .set('Authorization', `Bearer ${strangerToken}`)
      .set('Tus-Resumable', '1.0.0')
      .set('Upload-Length', '20')
      .set('Upload-Metadata', tusMetadata({ videoId }));

    expect(res.status).toBe(404);
    expect(JSON.parse(res.text).error).toBe('VIDEO_NOT_FOUND');
  });

  it('resumes an interrupted upload from the correct Upload-Offset without re-sending already-received bytes', async () => {
    const { access_token } = await registerConfirmAndLogin(
      'uploads-resume@example.com',
    );
    const videoId = await createDraft(access_token);

    const body = Buffer.from('0123456789abcdefghij'); // 20 bytes
    const firstChunk = body.subarray(0, 12);
    const remainder = body.subarray(12, 20);

    const createRes = await uploadBase
      .post('/uploads')
      .set('Authorization', `Bearer ${access_token}`)
      .set('Tus-Resumable', '1.0.0')
      .set('Upload-Length', String(body.length))
      .set('Upload-Metadata', tusMetadata({ videoId }));

    const location = createRes.headers.location;
    const uploadPath = location.startsWith('http')
      ? new URL(location).pathname
      : location;

    // Simulate an interrupted upload: only the first chunk arrives.
    const firstPatch = await uploadBase
      .patch(uploadPath)
      .set('Authorization', `Bearer ${access_token}`)
      .set('Tus-Resumable', '1.0.0')
      .set('Upload-Offset', '0')
      .set('Content-Type', 'application/offset+octet-stream')
      .send(firstChunk);

    expect(firstPatch.status).toBe(204);
    const resumeOffset = Number(firstPatch.headers['upload-offset']);
    expect(resumeOffset).toBe(12);

    // A HEAD request (as a resuming client would issue) confirms the persisted offset.
    const head = await uploadBase
      .head(uploadPath)
      .set('Authorization', `Bearer ${access_token}`)
      .set('Tus-Resumable', '1.0.0');
    expect(Number(head.headers['upload-offset'])).toBe(resumeOffset);

    // Resume from the server-reported offset — only the remaining bytes are sent.
    const resumePatch = await uploadBase
      .patch(uploadPath)
      .set('Authorization', `Bearer ${access_token}`)
      .set('Tus-Resumable', '1.0.0')
      .set('Upload-Offset', String(resumeOffset))
      .set('Content-Type', 'application/offset+octet-stream')
      .send(remainder);

    expect(resumePatch.status).toBe(204);
    expect(resumePatch.headers['upload-offset']).toBe('20');

    const finalCheck = await dataSource.query(
      'SELECT status FROM "videos" WHERE id = $1',
      [videoId],
    );
    expect(finalCheck[0].status).toBe('uploaded');
  });
});
