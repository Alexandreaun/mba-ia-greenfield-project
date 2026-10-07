import { DataSource, Repository } from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import { User } from '../../users/entities/user.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { Video, VideoStatus } from './video.entity';

const ALL_ENTITIES = [User, Channel, Video];

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  let counter = 0;
  async function createChannel(): Promise<Channel> {
    const n = ++counter;
    const user = await userRepository.save(
      userRepository.create({
        email: `video_test_user_${n}@example.com`,
        password: 'hashed',
      }),
    );
    return channelRepository.save(
      channelRepository.create({
        name: `Channel ${n}`,
        nickname: `channel_${n}`,
        user_id: user.id,
      }),
    );
  }

  function buildVideo(
    channelId: string,
    overrides: Partial<Video> = {},
  ): Partial<Video> {
    return {
      channel_id: channelId,
      original_filename: 'my-video.mp4',
      mime_type: 'video/mp4',
      size_bytes: 1_000_000,
      object_key: `object-key-${++counter}`,
      ...overrides,
    };
  }

  it('persists a Video row with all required fields and defaults status to draft', async () => {
    const channel = await createChannel();
    const video = await videoRepository.save(
      videoRepository.create(buildVideo(channel.id)),
    );

    expect(video.id).toBeDefined();
    expect(video.status).toBe(VideoStatus.DRAFT);
    expect(video.created_at).toBeInstanceOf(Date);
    expect(video.updated_at).toBeInstanceOf(Date);
    expect(video.thumbnail_key).toBeNull();
    expect(video.duration_seconds).toBeNull();
    expect(video.metadata).toBeNull();
  });

  it('rejects an invalid enum value for status', async () => {
    const channel = await createChannel();
    const video = videoRepository.create(
      buildVideo(channel.id, { status: 'not-a-status' as VideoStatus }),
    );

    await expect(videoRepository.save(video)).rejects.toThrow();
  });

  it('enforces the unique constraint on object_key', async () => {
    const channel = await createChannel();
    const sharedKey = 'duplicate-object-key';
    await videoRepository.save(
      videoRepository.create(buildVideo(channel.id, { object_key: sharedKey })),
    );

    const duplicate = videoRepository.create(
      buildVideo(channel.id, { object_key: sharedKey }),
    );

    await expect(videoRepository.save(duplicate)).rejects.toThrow();
  });

  it('persists size_bytes as a number (bigint transformer)', async () => {
    const channel = await createChannel();
    const video = await videoRepository.save(
      videoRepository.create(
        buildVideo(channel.id, { size_bytes: 10_737_418_240 }),
      ),
    );

    const found = await videoRepository.findOneBy({ id: video.id });
    expect(found?.size_bytes).toBe(10_737_418_240);
    expect(typeof found?.size_bytes).toBe('number');
  });

  it('loads the related channel via ManyToOne relation', async () => {
    const channel = await createChannel();
    const video = await videoRepository.save(
      videoRepository.create(buildVideo(channel.id)),
    );

    const found = await videoRepository.findOne({
      where: { id: video.id },
      relations: ['channel'],
    });

    expect(found?.channel.id).toBe(channel.id);
  });
});
