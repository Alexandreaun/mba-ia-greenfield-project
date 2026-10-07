import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import storageConfig from '../config/storage.config';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

describe('StorageService (integration)', () => {
  let service: StorageService;
  let setupClient: S3Client;
  const bucket = process.env.STORAGE_BUCKET ?? 'streamtube-videos';

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        StorageModule,
      ],
    }).compile();

    service = module.get(StorageService);

    setupClient = new S3Client({
      region: process.env.STORAGE_REGION ?? 'us-east-1',
      endpoint: process.env.STORAGE_ENDPOINT ?? 'http://minio:9000',
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.STORAGE_ACCESS_KEY_ID ?? 'minioadmin',
        secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY ?? 'minioadmin',
      },
    });
  });

  async function putTestObject(key: string, body: string): Promise<void> {
    await setupClient.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }),
    );
  }

  it('generates a presigned GET URL that streams the object without forcing download', async () => {
    const key = `storage-integration-${Date.now()}-stream.txt`;
    await putTestObject(key, 'hello streaming');

    const url = await service.getPresignedGetUrl(key);
    const response = await fetch(url);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('hello streaming');
    expect(response.headers.get('content-disposition')).not.toBe('attachment');
  });

  it('generates a presigned GET URL whose response forces Content-Disposition: attachment', async () => {
    const key = `storage-integration-${Date.now()}-download.txt`;
    await putTestObject(key, 'hello download');

    const url = await service.getPresignedGetUrl(key, {
      disposition: 'attachment',
    });
    const response = await fetch(url);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('attachment');
  });
});
