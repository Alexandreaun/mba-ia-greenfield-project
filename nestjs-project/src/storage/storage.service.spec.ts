import { Test } from '@nestjs/testing';
import storageConfig from '../config/storage.config';
import { StorageService } from './storage.service';

const mockStorageConfig: ReturnType<typeof storageConfig> = {
  endpoint: 'http://minio:9000',
  region: 'us-east-1',
  bucket: 'streamtube-videos',
  accessKeyId: 'minioadmin',
  secretAccessKey: 'minioadmin',
};

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: storageConfig.KEY, useValue: mockStorageConfig },
      ],
    }).compile();

    service = module.get(StorageService);
  });

  describe('generateObjectKey', () => {
    it('returns a deterministic key combining the video id and extension', () => {
      const videoId = '11111111-1111-1111-1111-111111111111';
      expect(service.generateObjectKey(videoId, 'mp4')).toBe(`${videoId}.mp4`);
    });

    it('is deterministic across repeated calls for the same input', () => {
      const videoId = '22222222-2222-2222-2222-222222222222';
      expect(service.generateObjectKey(videoId, 'mov')).toBe(
        service.generateObjectKey(videoId, 'mov'),
      );
    });

    it('returns different keys for different video ids (collision-free)', () => {
      const keyA = service.generateObjectKey('video-a', 'mp4');
      const keyB = service.generateObjectKey('video-b', 'mp4');
      expect(keyA).not.toBe(keyB);
    });
  });

  describe('generateThumbnailKey', () => {
    it('returns a deterministic thumbnail key for the video id', () => {
      const videoId = '33333333-3333-3333-3333-333333333333';
      expect(service.generateThumbnailKey(videoId)).toBe(
        `${videoId}-thumbnail.jpg`,
      );
    });

    it('returns different thumbnail keys for different video ids (collision-free)', () => {
      const keyA = service.generateThumbnailKey('video-a');
      const keyB = service.generateThumbnailKey('video-b');
      expect(keyA).not.toBe(keyB);
    });
  });
});
