import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { execa } from 'execa';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource, Repository } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import databaseConfig from '../config/database.config';
import storageConfig from '../config/storage.config';
import { JOBS_QUEUES } from '../jobs/jobs.constants';
import { JobsModule } from '../jobs/jobs.module';
import { JobsService } from '../jobs/jobs.service';
import { StorageModule } from '../storage/storage.module';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Video, VideoStatus } from '../videos/entities/video.entity';
import { VideosService } from '../videos/videos.service';
import { VideoProcessingHandler } from './video-processing.handler';

const ALL_ENTITIES = [User, Channel, Video];

async function waitUntil(
  predicate: () => Promise<boolean>,
  { timeoutMs, intervalMs = 500 }: { timeoutMs: number; intervalMs?: number },
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`waitUntil timed out after ${timeoutMs}ms`);
}

describe('VideoProcessingHandler (integration)', () => {
  let testDataSource: DataSource;
  let videosService: VideosService;
  let jobsService: JobsService;
  let handler: VideoProcessingHandler;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;
  let s3Client: S3Client;
  let fixturesDir: string;
  const bucket = process.env.STORAGE_BUCKET ?? 'streamtube-videos';

  beforeAll(async () => {
    testDataSource = createTestDataSource(ALL_ENTITIES);
    await testDataSource.initialize();
    userRepository = testDataSource.getRepository(User);
    channelRepository = testDataSource.getRepository(Channel);
    videoRepository = testDataSource.getRepository(Video);

    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [databaseConfig, storageConfig],
        }),
        StorageModule,
        JobsModule,
      ],
      providers: [
        VideosService,
        VideoProcessingHandler,
        { provide: getRepositoryToken(Video), useValue: videoRepository },
      ],
    }).compile();

    videosService = module.get(VideosService);
    jobsService = module.get(JobsService);
    handler = module.get(VideoProcessingHandler);

    await jobsService.onModuleInit();
    await handler.onModuleInit();

    s3Client = new S3Client({
      region: process.env.STORAGE_REGION ?? 'us-east-1',
      endpoint: process.env.STORAGE_ENDPOINT ?? 'http://minio:9000',
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.STORAGE_ACCESS_KEY_ID ?? 'minioadmin',
        secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY ?? 'minioadmin',
      },
    });

    fixturesDir = await mkdtemp(join(tmpdir(), 'video-processing-fixtures-'));
  });

  afterAll(async () => {
    await jobsService.onModuleDestroy();
    await testDataSource.destroy();
    await rm(fixturesDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await cleanAllTables(testDataSource);
  });

  let counter = 0;
  async function createDraftVideo(): Promise<Video> {
    const n = ++counter;
    const user = await userRepository.save(
      userRepository.create({
        email: `video_processing_test_${n}@example.com`,
        password: 'hashed',
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: `Channel ${n}`,
        nickname: `video_processing_channel_${n}`,
        user_id: user.id,
      }),
    );
    return videosService.createDraft(channel.id, {
      original_filename: `video-${n}.mp4`,
      mime_type: 'video/mp4',
      size_bytes: 1000,
    });
  }

  async function putObject(key: string, filePath: string): Promise<void> {
    const body = await readFile(filePath);
    await s3Client.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }),
    );
  }

  it('processes a valid video: sets ready status, duration, metadata, and uploads a thumbnail', async () => {
    const video = await createDraftVideo();

    const sourcePath = join(fixturesDir, `${video.id}-source.mp4`);
    await execa('ffmpeg', [
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=64x64:d=2',
      '-y',
      sourcePath,
    ]);
    await putObject(video.object_key, sourcePath);

    await jobsService.send(JOBS_QUEUES.VIDEO_PROCESS, {
      videoId: video.id,
      objectKey: video.object_key,
    });

    await waitUntil(
      async () => {
        const current = await videoRepository.findOneBy({ id: video.id });
        return current?.status === VideoStatus.READY;
      },
      { timeoutMs: 20000 },
    );

    const updated = await videoRepository.findOneBy({ id: video.id });
    expect(updated?.status).toBe(VideoStatus.READY);
    expect(updated?.duration_seconds).toBeGreaterThanOrEqual(1);
    expect(updated?.metadata).not.toBeNull();

    const thumbnailHead = await s3Client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: video.thumbnail_key! }),
    );
    expect(thumbnailHead.ContentLength).toBeGreaterThan(0);
  }, 30000);

  it('exhausts retries on a corrupted file, lands the job in the DLQ, and marks status failed', async () => {
    const video = await createDraftVideo();

    const corruptPath = join(fixturesDir, `${video.id}-corrupt.bin`);
    await writeFile(corruptPath, Buffer.from('not a real video container'));
    await putObject(video.object_key, corruptPath);

    await jobsService.send(JOBS_QUEUES.VIDEO_PROCESS, {
      videoId: video.id,
      objectKey: video.object_key,
    });

    await waitUntil(
      async () => {
        const current = await videoRepository.findOneBy({ id: video.id });
        return current?.status === VideoStatus.FAILED;
      },
      { timeoutMs: 45000 },
    );

    const updated = await videoRepository.findOneBy({ id: video.id });
    expect(updated?.status).toBe(VideoStatus.FAILED);
  }, 60000);
});
