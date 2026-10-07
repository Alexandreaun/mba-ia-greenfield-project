import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { PgBoss, type SendOptions, type WorkHandler } from 'pg-boss';
import databaseConfig from '../config/database.config';
import { JOBS_QUEUES } from './jobs.constants';

const VIDEO_PROCESS_RETRY_LIMIT = 3;

@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private readonly boss: PgBoss;

  constructor(
    @Inject(databaseConfig.KEY)
    config: ConfigType<typeof databaseConfig>,
  ) {
    this.boss = new PgBoss({
      host: config.host,
      port: config.port,
      database: config.name,
      user: config.username,
      password: config.password,
    });
  }

  async onModuleInit(): Promise<void> {
    this.boss.on('error', (error) => this.logger.error(error));
    await this.boss.start();
    await this.boss.createQueue(JOBS_QUEUES.VIDEO_PROCESSING_DLQ);
    await this.boss.createQueue(JOBS_QUEUES.VIDEO_PROCESS, {
      retryLimit: VIDEO_PROCESS_RETRY_LIMIT,
      retryBackoff: true,
      deadLetter: JOBS_QUEUES.VIDEO_PROCESSING_DLQ,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.boss.stop();
  }

  async send<T extends object>(
    queueName: string,
    data: T,
    options?: SendOptions,
  ): Promise<string | null> {
    return this.boss.send(queueName, data, options);
  }

  async work<ReqData, ResData = unknown>(
    queueName: string,
    handler: WorkHandler<ReqData, ResData>,
  ): Promise<string> {
    return this.boss.work<ReqData, ResData>(queueName, handler);
  }
}
