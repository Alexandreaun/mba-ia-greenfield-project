import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { ChannelsService } from '../src/channels/channels.service';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';

describe('videos-status (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let throttlerStorage: ThrottlerStorageService;
  let videoRepository: Repository<Video>;

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
    videoRepository = dataSource.getRepository(Video);
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

  async function channelIdForToken(accessToken: string): Promise<string> {
    const jwtService = app.get(JwtService);
    const channelsService = app.get(ChannelsService);
    const payload = jwtService.decode<{ sub: string }>(accessToken);
    const channel = await channelsService.findByUserId(payload.sub);
    if (!channel) {
      throw new Error(`No channel found for user ${payload.sub}`);
    }
    return channel.id;
  }

  async function seedVideo(
    channelId: string,
    status: VideoStatus,
  ): Promise<Video> {
    const id = crypto.randomUUID();
    return videoRepository.save(
      videoRepository.create({
        id,
        channel_id: channelId,
        status,
        original_filename: 'video.mp4',
        mime_type: 'video/mp4',
        size_bytes: 1000,
        object_key: `${id}.mp4`,
        thumbnail_key: `${id}-thumbnail.jpg`,
      }),
    );
  }

  describe('videos-status', () => {
    it('ready-video-returns-delivery-urls', async () => {
      const { access_token } = await registerConfirmAndLogin(
        'videos-status-ready@example.com',
      );
      const channelId = await channelIdForToken(access_token);
      const video = await seedVideo(channelId, VideoStatus.READY);

      const res = await request(app.getHttpServer())
        .get(`/videos/${video.id}`)
        .set('Authorization', `Bearer ${access_token}`);

      expect(res.status).toBe(200);
      expect(res.body.urls.streamUrl).toBeTruthy();
      expect(res.body.urls.downloadUrl).toBeTruthy();
    });

    it('non-ready-video-returns-null-urls', async () => {
      const { access_token } = await registerConfirmAndLogin(
        'videos-status-processing@example.com',
      );
      const channelId = await channelIdForToken(access_token);
      const video = await seedVideo(channelId, VideoStatus.PROCESSING);

      const res = await request(app.getHttpServer())
        .get(`/videos/${video.id}`)
        .set('Authorization', `Bearer ${access_token}`);

      expect(res.status).toBe(200);
      expect(res.body.urls).toBeNull();
    });

    it('not-owned-or-missing-returns-404', async () => {
      const { access_token: ownerToken } = await registerConfirmAndLogin(
        'videos-status-owner@example.com',
      );
      const ownerChannelId = await channelIdForToken(ownerToken);

      const missingRes = await request(app.getHttpServer())
        .get(`/videos/${crypto.randomUUID()}`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(missingRes.status).toBe(404);
      expect(missingRes.body.error).toBe('VIDEO_NOT_FOUND');

      const video = await seedVideo(ownerChannelId, VideoStatus.READY);

      const { access_token: strangerToken } = await registerConfirmAndLogin(
        'videos-status-stranger@example.com',
      );

      const strangerRes = await request(app.getHttpServer())
        .get(`/videos/${video.id}`)
        .set('Authorization', `Bearer ${strangerToken}`);

      expect(strangerRes.status).toBe(404);
      expect(strangerRes.body.error).toBe('VIDEO_NOT_FOUND');
    });
  });
});
