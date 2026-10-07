import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  UnsupportedMediaTypeException,
  VideoNotFoundException,
  VideoTooLargeException,
} from '../common/exceptions/domain.exception';
import { StorageService } from '../storage/storage.service';
import { CreateVideoDto } from './dto/create-video.dto';
import { Video, VideoStatus } from './entities/video.entity';
import {
  MAX_VIDEO_SIZE_BYTES,
  SUPPORTED_VIDEO_MIME_TYPES,
} from './videos.constants';

export interface VideoDeliveryUrls {
  streamUrl: string;
  downloadUrl: string;
}

export interface VideoWithDeliveryUrls extends Video {
  urls: VideoDeliveryUrls | null;
}

function extractExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1 || lastDot === filename.length - 1) {
    return 'bin';
  }
  return filename.slice(lastDot + 1).toLowerCase();
}

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: StorageService,
  ) {}

  async createDraft(channelId: string, dto: CreateVideoDto): Promise<Video> {
    if (dto.size_bytes > MAX_VIDEO_SIZE_BYTES) {
      throw new VideoTooLargeException();
    }

    if (
      !SUPPORTED_VIDEO_MIME_TYPES.includes(
        dto.mime_type as (typeof SUPPORTED_VIDEO_MIME_TYPES)[number],
      )
    ) {
      throw new UnsupportedMediaTypeException();
    }

    const id = randomUUID();
    const extension = extractExtension(dto.original_filename);

    const draft = this.videoRepository.create({
      id,
      channel_id: channelId,
      status: VideoStatus.DRAFT,
      original_filename: dto.original_filename,
      mime_type: dto.mime_type,
      size_bytes: dto.size_bytes,
      object_key: this.storageService.generateObjectKey(id, extension),
      thumbnail_key: this.storageService.generateThumbnailKey(id),
    });

    return this.videoRepository.save(draft);
  }

  async findById(id: string): Promise<Video | null> {
    return this.videoRepository.findOneBy({ id });
  }

  async findOwnedDraft(id: string, channelId: string): Promise<Video | null> {
    return this.videoRepository.findOneBy({ id, channel_id: channelId });
  }

  async markUploaded(id: string): Promise<void> {
    await this.videoRepository.update(id, { status: VideoStatus.UPLOADED });
  }

  async markReady(
    id: string,
    data: { durationSeconds: number | null; metadata: Record<string, unknown> },
  ): Promise<void> {
    await this.videoRepository.update(id, {
      status: VideoStatus.READY,
      duration_seconds: data.durationSeconds,
      // TypeORM's QueryDeepPartialEntity recursively maps jsonb object columns,
      // which `Record<string, unknown>` cannot satisfy structurally — cast at
      // the library boundary per typescript-strict.md.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      metadata: data.metadata as any,
    });
  }

  async markFailed(id: string): Promise<void> {
    await this.videoRepository.update(id, { status: VideoStatus.FAILED });
  }

  async findOne(channelId: string, id: string): Promise<VideoWithDeliveryUrls> {
    const video = await this.videoRepository.findOneBy({
      id,
      channel_id: channelId,
    });
    if (!video) {
      throw new VideoNotFoundException();
    }

    let urls: VideoDeliveryUrls | null = null;
    if (video.status === VideoStatus.READY) {
      const [streamUrl, downloadUrl] = await Promise.all([
        this.storageService.getPresignedGetUrl(video.object_key),
        this.storageService.getPresignedGetUrl(video.object_key, {
          disposition: 'attachment',
        }),
      ]);
      urls = { streamUrl, downloadUrl };
    }

    return { ...video, urls };
  }
}
