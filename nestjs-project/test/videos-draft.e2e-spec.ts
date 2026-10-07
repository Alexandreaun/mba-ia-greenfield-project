import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';

describe('videos-draft (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let throttlerStorage: ThrottlerStorageService;

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
    await app.init();

    dataSource = app.get(DataSource);
    throttlerStorage =
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage);
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

  describe('videos', () => {
    it('POST /videos with a valid payload creates a draft', async () => {
      const { access_token } = await registerConfirmAndLogin(
        'videos-draft-1@example.com',
      );

      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${access_token}`)
        .send({
          original_filename: 'my-video.mp4',
          mime_type: 'video/mp4',
          size_bytes: 1000000,
        });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: expect.any(String), status: 'draft' });

      const persisted = await dataSource.query(
        'SELECT status FROM "videos" WHERE id = $1',
        [res.body.id],
      );
      expect(persisted).toHaveLength(1);
      expect(persisted[0].status).toBe('draft');
    });

    it('POST /videos with size_bytes exceeding 10GB returns 400 VIDEO_TOO_LARGE', async () => {
      const { access_token } = await registerConfirmAndLogin(
        'videos-draft-2@example.com',
      );

      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${access_token}`)
        .send({
          original_filename: 'big-video.mp4',
          mime_type: 'video/mp4',
          size_bytes: 10737418241,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VIDEO_TOO_LARGE');

      const persisted = await dataSource.query('SELECT * FROM "videos"');
      expect(persisted).toHaveLength(0);
    });

    it('POST /videos with an unsupported mime_type returns 415 UNSUPPORTED_MEDIA_TYPE', async () => {
      const { access_token } = await registerConfirmAndLogin(
        'videos-draft-3@example.com',
      );

      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${access_token}`)
        .send({
          original_filename: 'document.pdf',
          mime_type: 'application/pdf',
          size_bytes: 1000000,
        });

      expect(res.status).toBe(415);
      expect(res.body.error).toBe('UNSUPPORTED_MEDIA_TYPE');

      const persisted = await dataSource.query('SELECT * FROM "videos"');
      expect(persisted).toHaveLength(0);
    });
  });
});
