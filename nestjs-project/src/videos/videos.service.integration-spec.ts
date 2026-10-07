import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { User } from '../users/entities/user.entity';
import storageConfig from '../config/storage.config';
import { StorageModule } from '../storage/storage.module';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { Video, VideoStatus } from './entities/video.entity';
import { VideosService } from './videos.service';

const ALL_ENTITIES = [User, Channel, Video];

describe('VideosService (integration)', () => {
  let testDataSource: DataSource;
  let videosService: VideosService;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;

  beforeAll(async () => {
    testDataSource = createTestDataSource(ALL_ENTITIES);
    await testDataSource.initialize();
    userRepository = testDataSource.getRepository(User);
    channelRepository = testDataSource.getRepository(Channel);
    videoRepository = testDataSource.getRepository(Video);

    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        StorageModule,
      ],
      providers: [
        VideosService,
        { provide: getRepositoryToken(Video), useValue: videoRepository },
      ],
    }).compile();

    videosService = module.get(VideosService);
  });

  afterAll(async () => {
    await testDataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(testDataSource);
  });

  let counter = 0;
  async function createChannel(): Promise<Channel> {
    const n = ++counter;
    const user = await userRepository.save(
      userRepository.create({
        email: `videos_service_test_${n}@example.com`,
        password: 'hashed',
      }),
    );
    return channelRepository.save(
      channelRepository.create({
        name: `Channel ${n}`,
        nickname: `videos_svc_channel_${n}`,
        user_id: user.id,
      }),
    );
  }

  it('persists a draft row with generated object_key and thumbnail_key', async () => {
    const channel = await createChannel();

    const video = await videosService.createDraft(channel.id, {
      original_filename: 'my-video.mp4',
      mime_type: 'video/mp4',
      size_bytes: 1_000_000,
    });

    expect(video.status).toBe(VideoStatus.DRAFT);
    expect(video.object_key).toBe(`${video.id}.mp4`);
    expect(video.thumbnail_key).toBe(`${video.id}-thumbnail.jpg`);

    const persisted = await videoRepository.findOneBy({ id: video.id });
    expect(persisted).not.toBeNull();
    expect(persisted?.channel_id).toBe(channel.id);
    expect(persisted?.object_key).toBe(video.object_key);
    expect(persisted?.thumbnail_key).toBe(video.thumbnail_key);
  });

  it('findOne returns presigned stream/download urls for a real ready video', async () => {
    const channel = await createChannel();
    const draft = await videosService.createDraft(channel.id, {
      original_filename: 'my-video.mp4',
      mime_type: 'video/mp4',
      size_bytes: 1_000_000,
    });
    await videoRepository.update(draft.id, { status: VideoStatus.READY });

    const result = await videosService.findOne(channel.id, draft.id);

    expect(result.status).toBe(VideoStatus.READY);
    expect(result.urls?.streamUrl).toContain(draft.object_key);
    expect(result.urls?.downloadUrl).toContain(draft.object_key);
    expect(result.urls?.streamUrl).not.toBe(result.urls?.downloadUrl);
  });
});
