import { Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import databaseConfig from '../config/database.config';
import storageConfig from '../config/storage.config';
import { JobsModule } from '../jobs/jobs.module';
import { StorageModule } from '../storage/storage.module';
import { VideosModule } from '../videos/videos.module';
import { VideoProcessingHandler } from './video-processing.handler';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, storageConfig],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [databaseConfig.KEY],
      useFactory: (dbConfig: ConfigType<typeof databaseConfig>) => ({
        type: 'postgres',
        host: dbConfig.host,
        port: dbConfig.port,
        username: dbConfig.username,
        password: dbConfig.password,
        database: dbConfig.name,
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    JobsModule,
    StorageModule,
    VideosModule,
  ],
  providers: [VideoProcessingHandler],
})
export class WorkerModule {}
