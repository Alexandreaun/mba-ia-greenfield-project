import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { execa } from 'execa';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JOBS_QUEUES } from '../jobs/jobs.constants';
import { JobsService } from '../jobs/jobs.service';
import { StorageService } from '../storage/storage.service';
import { VideosService } from '../videos/videos.service';

interface VideoProcessJobData {
  videoId: string;
  objectKey: string;
}

interface FfprobeOutput {
  format?: { duration?: string };
}

@Injectable()
export class VideoProcessingHandler implements OnModuleInit {
  private readonly logger = new Logger(VideoProcessingHandler.name);

  constructor(
    private readonly jobsService: JobsService,
    private readonly storageService: StorageService,
    private readonly videosService: VideosService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.jobsService.work<VideoProcessJobData>(
      JOBS_QUEUES.VIDEO_PROCESS,
      async ([job]) => this.process(job.data),
    );

    await this.jobsService.work<VideoProcessJobData>(
      JOBS_QUEUES.VIDEO_PROCESSING_DLQ,
      async ([job]) => {
        this.logger.error(
          `Video ${job.data.videoId} exhausted retries — marking as failed`,
        );
        await this.videosService.markFailed(job.data.videoId);
      },
    );
  }

  private async process(data: VideoProcessJobData): Promise<void> {
    const workDir = await mkdtemp(join(tmpdir(), 'video-processing-'));
    const inputPath = join(workDir, 'input');
    const thumbnailPath = join(workDir, 'thumbnail.jpg');

    try {
      const video = await this.videosService.findById(data.videoId);
      if (!video) {
        throw new Error(`Video ${data.videoId} not found`);
      }

      await this.storageService.downloadObject(data.objectKey, inputPath);

      const { stdout } = await execa('ffprobe', [
        '-show_format',
        '-show_streams',
        '-print_format',
        'json',
        inputPath,
      ]);
      const probe = JSON.parse(stdout) as FfprobeOutput;
      const durationSeconds = probe.format?.duration
        ? Math.round(parseFloat(probe.format.duration))
        : null;

      await execa('ffmpeg', [
        '-ss',
        '0',
        '-i',
        inputPath,
        '-vframes',
        '1',
        '-y',
        thumbnailPath,
      ]);

      await this.storageService.uploadFile(
        video.thumbnail_key!,
        thumbnailPath,
        'image/jpeg',
      );

      await this.videosService.markReady(data.videoId, {
        durationSeconds,
        metadata: probe as unknown as Record<string, unknown>,
      });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}
