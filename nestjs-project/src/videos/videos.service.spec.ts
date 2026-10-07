import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import {
  UnsupportedMediaTypeException,
  VideoNotFoundException,
  VideoTooLargeException,
} from '../common/exceptions/domain.exception';
import { StorageService } from '../storage/storage.service';
import { CreateVideoDto } from './dto/create-video.dto';
import { Video, VideoStatus } from './entities/video.entity';
import { VideosService } from './videos.service';

describe('VideosService', () => {
  let service: VideosService;
  let videoRepositoryMock: {
    create: jest.Mock;
    save: jest.Mock;
    findOneBy: jest.Mock;
  };
  let storageServiceMock: {
    generateObjectKey: jest.Mock;
    generateThumbnailKey: jest.Mock;
    getPresignedGetUrl: jest.Mock;
  };

  beforeEach(async () => {
    videoRepositoryMock = {
      create: jest.fn((v) => v),
      save: jest.fn((v) => Promise.resolve(v)),
      findOneBy: jest.fn(),
    };
    storageServiceMock = {
      generateObjectKey: jest.fn((id: string, ext: string) => `${id}.${ext}`),
      generateThumbnailKey: jest.fn((id: string) => `${id}-thumbnail.jpg`),
      getPresignedGetUrl: jest.fn(
        (key: string, options?: { disposition?: string }) =>
          Promise.resolve(
            options?.disposition === 'attachment'
              ? `https://storage.local/${key}?download`
              : `https://storage.local/${key}`,
          ),
      ),
    };

    const module = await Test.createTestingModule({
      providers: [
        VideosService,
        { provide: getRepositoryToken(Video), useValue: videoRepositoryMock },
        { provide: StorageService, useValue: storageServiceMock },
      ],
    }).compile();

    service = module.get(VideosService);
  });

  function buildDto(overrides: Partial<CreateVideoDto> = {}): CreateVideoDto {
    return {
      original_filename: 'my-video.mp4',
      mime_type: 'video/mp4',
      size_bytes: 1_000_000,
      ...overrides,
    };
  }

  it('rejects size_bytes exceeding the 10GB limit', async () => {
    await expect(
      service.createDraft(
        'channel-1',
        buildDto({ size_bytes: 10_737_418_241 }),
      ),
    ).rejects.toBeInstanceOf(VideoTooLargeException);

    expect(videoRepositoryMock.save).not.toHaveBeenCalled();
  });

  it('accepts size_bytes exactly at the 10GB limit', async () => {
    await expect(
      service.createDraft(
        'channel-1',
        buildDto({ size_bytes: 10_737_418_240 }),
      ),
    ).resolves.toBeDefined();
  });

  it('rejects an unsupported mime_type', async () => {
    await expect(
      service.createDraft(
        'channel-1',
        buildDto({ mime_type: 'application/pdf' }),
      ),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);

    expect(videoRepositoryMock.save).not.toHaveBeenCalled();
  });

  it('accepts a supported mime_type and persists the draft with status draft', async () => {
    const result = await service.createDraft('channel-1', buildDto());

    expect(result.status).toBe('draft');
    expect(result.channel_id).toBe('channel-1');
    expect(videoRepositoryMock.save).toHaveBeenCalledTimes(1);
  });

  it('generates object_key and thumbnail_key via StorageService using the extension from original_filename', async () => {
    const result = await service.createDraft(
      'channel-1',
      buildDto({ original_filename: 'clip.mov' }),
    );

    expect(storageServiceMock.generateObjectKey).toHaveBeenCalledWith(
      result.id,
      'mov',
    );
    expect(storageServiceMock.generateThumbnailKey).toHaveBeenCalledWith(
      result.id,
    );
    expect(result.object_key).toBe(`${result.id}.mov`);
    expect(result.thumbnail_key).toBe(`${result.id}-thumbnail.jpg`);
  });

  describe('findOne', () => {
    function buildVideo(overrides: Partial<Video> = {}): Video {
      return {
        id: 'video-1',
        channel_id: 'channel-1',
        status: VideoStatus.UPLOADED,
        object_key: 'video-1.mp4',
        thumbnail_key: 'video-1-thumbnail.jpg',
        ...overrides,
      } as Video;
    }

    it('populates urls when status is ready', async () => {
      videoRepositoryMock.findOneBy.mockResolvedValue(
        buildVideo({ status: VideoStatus.READY }),
      );

      const result = await service.findOne('channel-1', 'video-1');

      expect(result.urls).toEqual({
        streamUrl: 'https://storage.local/video-1.mp4',
        downloadUrl: 'https://storage.local/video-1.mp4?download',
      });
      expect(storageServiceMock.getPresignedGetUrl).toHaveBeenCalledWith(
        'video-1.mp4',
      );
      expect(storageServiceMock.getPresignedGetUrl).toHaveBeenCalledWith(
        'video-1.mp4',
        { disposition: 'attachment' },
      );
    });

    it('leaves urls null when status is not ready', async () => {
      videoRepositoryMock.findOneBy.mockResolvedValue(
        buildVideo({ status: VideoStatus.PROCESSING }),
      );

      const result = await service.findOne('channel-1', 'video-1');

      expect(result.urls).toBeNull();
      expect(storageServiceMock.getPresignedGetUrl).not.toHaveBeenCalled();
    });

    it('throws VideoNotFoundException when no video matches the id/channel', async () => {
      videoRepositoryMock.findOneBy.mockResolvedValue(null);

      await expect(
        service.findOne('channel-1', 'missing-video'),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
    });
  });
});
