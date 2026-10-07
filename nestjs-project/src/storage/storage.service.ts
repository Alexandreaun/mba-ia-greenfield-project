import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import storageConfig from '../config/storage.config';

export interface PresignedGetUrlOptions {
  disposition?: 'attachment';
}

const PRESIGNED_URL_EXPIRATION_SECONDS = 3600;

@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(
    @Inject(storageConfig.KEY)
    config: ConfigType<typeof storageConfig>,
  ) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  generateObjectKey(videoId: string, ext: string): string {
    return `${videoId}.${ext}`;
  }

  generateThumbnailKey(videoId: string): string {
    return `${videoId}-thumbnail.jpg`;
  }

  async downloadObject(key: string, destPath: string): Promise<void> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    await pipeline(response.Body as Readable, createWriteStream(destPath));
  }

  async uploadFile(
    key: string,
    filePath: string,
    contentType?: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(filePath),
        ContentType: contentType,
      }),
    );
  }

  async getPresignedGetUrl(
    key: string,
    options: PresignedGetUrlOptions = {},
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(options.disposition === 'attachment' && {
          ResponseContentDisposition: 'attachment',
        }),
      }),
      { expiresIn: PRESIGNED_URL_EXPIRATION_SECONDS },
    );
  }
}
