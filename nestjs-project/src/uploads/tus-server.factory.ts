import { S3Store } from '@tus/s3-store';
import { Server } from '@tus/server';
import type { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { BEARER_PREFIX } from '../auth/auth.constants';
import type { JwtPayload } from '../auth/auth.types';
import {
  DomainException,
  VideoNotFoundException,
} from '../common/exceptions/domain.exception';
import storageConfig from '../config/storage.config';
import { UploadsService } from './uploads.service';

const PART_SIZE_BYTES = 8 * 1024 * 1024;

// tus's hook contract reads `error.status_code`/`error.body` off whatever is
// thrown (see @tus/server's PostHandler/onError) to shape the HTTP response —
// a real Error subclass satisfies that duck-typed contract while still being
// a proper Error instance.
class TusError extends Error {
  constructor(
    public readonly status_code: number,
    public readonly body: string,
  ) {
    super(body);
  }
}

function toTusError(error: unknown): TusError {
  if (error instanceof DomainException) {
    return new TusError(
      error.httpStatus,
      JSON.stringify({
        statusCode: error.httpStatus,
        error: error.errorCode,
        message: error.message,
      }),
    );
  }
  throw error;
}

function unauthorized(): TusError {
  return new TusError(
    401,
    JSON.stringify({
      statusCode: 401,
      error: 'UNAUTHORIZED',
      message: 'Unauthorized',
    }),
  );
}

export function createTusServer(
  uploadsService: UploadsService,
  jwtService: JwtService,
  storage: ConfigType<typeof storageConfig>,
): Server {
  async function authenticate(req: Request): Promise<JwtPayload> {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith(BEARER_PREFIX)) {
      throw unauthorized();
    }

    const token = authHeader.slice(BEARER_PREFIX.length);
    try {
      return await jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw unauthorized();
    }
  }

  const s3Store = new S3Store({
    partSize: PART_SIZE_BYTES,
    s3ClientConfig: {
      bucket: storage.bucket,
      region: storage.region,
      endpoint: storage.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: storage.accessKeyId,
        secretAccessKey: storage.secretAccessKey,
      },
    },
  });

  return new Server({
    path: '/uploads',
    datastore: s3Store,
    // The object's S3 key must match `Video.object_key` (per
    // phase-03-videos/TD-08) so the worker and presigned-URL generator can
    // find it later — @tus/s3-store otherwise defaults to a random id, which
    // is never coordinated with the rest of the system.
    async namingFunction(_req, metadata) {
      const videoId = metadata?.videoId;
      if (!videoId) {
        throw new TusError(
          400,
          JSON.stringify({
            statusCode: 400,
            error: 'VALIDATION_ERROR',
            message: 'Upload-Metadata must include videoId',
          }),
        );
      }

      const objectKey = await uploadsService.getObjectKey(videoId);
      if (!objectKey) {
        throw toTusError(new VideoNotFoundException());
      }

      return objectKey;
    },
    async onIncomingRequest(req) {
      await authenticate(req);
    },
    async onUploadCreate(req, upload) {
      const user = await authenticate(req);
      const videoId = upload.metadata?.videoId as string;

      try {
        await uploadsService.assertOwnedDraft(videoId, user.sub);
      } catch (error) {
        throw toTusError(error);
      }

      return { metadata: upload.metadata };
    },
    async onUploadFinish(_req, upload) {
      const videoId = upload.metadata?.videoId as string;
      try {
        await uploadsService.completeUpload(videoId);
      } catch (error) {
        throw toTusError(error);
      }

      return {};
    },
  });
}
