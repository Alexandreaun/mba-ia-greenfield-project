import { Injectable } from '@nestjs/common';
import { VideoNotFoundException } from '../common/exceptions/domain.exception';
import { Video } from '../videos/entities/video.entity';
import { VideosService } from '../videos/videos.service';
import { JobsService } from '../jobs/jobs.service';
import { JOBS_QUEUES } from '../jobs/jobs.constants';
import { ChannelsService } from '../channels/channels.service';

@Injectable()
export class UploadsService {
  constructor(
    private readonly videosService: VideosService,
    private readonly channelsService: ChannelsService,
    private readonly jobsService: JobsService,
  ) {}

  async assertOwnedDraft(videoId: string, userId: string): Promise<Video> {
    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) {
      throw new VideoNotFoundException();
    }

    const video = await this.videosService.findOwnedDraft(videoId, channel.id);
    if (!video) {
      throw new VideoNotFoundException();
    }

    return video;
  }

  async getObjectKey(videoId: string): Promise<string | null> {
    const video = await this.videosService.findById(videoId);
    return video?.object_key ?? null;
  }

  async completeUpload(videoId: string): Promise<void> {
    const video = await this.videosService.findById(videoId);
    if (!video) {
      throw new VideoNotFoundException();
    }

    await this.videosService.markUploaded(videoId);
    await this.jobsService.send(JOBS_QUEUES.VIDEO_PROCESS, {
      videoId,
      objectKey: video.object_key,
    });
  }
}
