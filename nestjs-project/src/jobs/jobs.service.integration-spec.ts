import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import databaseConfig from '../config/database.config';
import { JOBS_QUEUES } from './jobs.constants';
import { JobsModule } from './jobs.module';
import { JobsService } from './jobs.service';

interface VideoProcessPayload {
  videoId: string;
}

describe('JobsService (integration)', () => {
  let jobsService: JobsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [databaseConfig] }),
        JobsModule,
      ],
    }).compile();

    jobsService = module.get(JobsService);
    await jobsService.onModuleInit();
  });

  afterEach(async () => {
    await jobsService.onModuleDestroy();
    // pg-boss's internal poll loop can have one in-flight tick scheduled at
    // the moment stop() resolves; without a short settle window, the next
    // test's freshly-started worker can race it for jobs on the same
    // real queue, non-deterministically swapping which test's handler
    // receives which job.
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  it('delivers a sent job to a registered worker', async () => {
    // The real queue is shared across test runs, so a stray leftover job
    // from an earlier/unrelated run could be delivered first — only
    // resolve on the job this test actually sent.
    const delivered = new Promise<VideoProcessPayload>((resolve) => {
      void jobsService.work<VideoProcessPayload>(
        JOBS_QUEUES.VIDEO_PROCESS,
        async ([job]) => {
          if (job.data.videoId !== 'video-delivered') return;
          resolve(job.data);
        },
      );
    });

    await jobsService.send(JOBS_QUEUES.VIDEO_PROCESS, {
      videoId: 'video-delivered',
    });

    await expect(delivered).resolves.toEqual({
      videoId: 'video-delivered',
    });
  }, 15000);

  it('moves a job that fails every attempt to the dead-letter queue', async () => {
    let attempts = 0;
    void jobsService.work<VideoProcessPayload>(
      JOBS_QUEUES.VIDEO_PROCESS,
      async ([job]) => {
        if (job.data.videoId !== 'video-dlq') return;
        attempts += 1;
        throw new Error('processing failed on purpose');
      },
    );

    const deadLettered = new Promise<VideoProcessPayload>((resolve) => {
      void jobsService.work<VideoProcessPayload>(
        JOBS_QUEUES.VIDEO_PROCESSING_DLQ,
        async ([job]) => {
          if (job.data.videoId !== 'video-dlq') return;
          resolve(job.data);
        },
      );
    });

    await jobsService.send(JOBS_QUEUES.VIDEO_PROCESS, {
      videoId: 'video-dlq',
    });

    await expect(deadLettered).resolves.toEqual({ videoId: 'video-dlq' });
    expect(attempts).toBeGreaterThanOrEqual(4);
  }, 45000);
});
