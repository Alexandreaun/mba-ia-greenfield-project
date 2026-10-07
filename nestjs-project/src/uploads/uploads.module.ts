import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { JobsModule } from '../jobs/jobs.module';
import { VideosModule } from '../videos/videos.module';
import { UploadsService } from './uploads.service';

@Module({
  imports: [VideosModule, ChannelsModule, JobsModule],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule {}
