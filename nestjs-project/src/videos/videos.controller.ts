import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ChannelsService } from '../channels/channels.service';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { CreateVideoDto } from './dto/create-video.dto';
import type { VideoDeliveryUrls } from './videos.service';
import { VideosService } from './videos.service';

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(
    private readonly videosService: VideosService,
    private readonly channelsService: ChannelsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Create a video draft',
    description:
      'Pre-registers a video as a draft before any upload bytes arrive. The caller must be the authenticated channel owner.',
  })
  @ApiResponse({
    status: 201,
    description: 'Draft created successfully',
    schema: {
      properties: {
        id: { type: 'string', format: 'uuid' },
        status: { type: 'string', example: 'draft' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed, or size_bytes exceeds the 10GB limit',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 415,
    description: 'Unsupported video mime_type',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async create(
    @Body() dto: CreateVideoDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ id: string; status: string }> {
    const channel = await this.channelsService.findByUserId(user.sub);
    if (!channel) {
      throw new Error(`No channel found for user ${user.sub}`);
    }

    const video = await this.videosService.createDraft(channel.id, dto);
    return { id: video.id, status: video.status };
  }

  @Get(':id')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get video status and delivery URLs',
    description:
      'Returns the video processing status and, once status is "ready", presigned streaming/download URLs. The caller must be the authenticated owner of the channel the video belongs to.',
  })
  @ApiResponse({
    status: 200,
    description: 'Video status (and delivery URLs, when ready)',
    schema: {
      properties: {
        id: { type: 'string', format: 'uuid' },
        status: { type: 'string', example: 'ready' },
        urls: {
          nullable: true,
          properties: {
            streamUrl: { type: 'string', format: 'uri' },
            downloadUrl: { type: 'string', format: 'uri' },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found, or not owned by the caller',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ id: string; status: string; urls: VideoDeliveryUrls | null }> {
    const channel = await this.channelsService.findByUserId(user.sub);
    if (!channel) {
      throw new Error(`No channel found for user ${user.sub}`);
    }

    const video = await this.videosService.findOne(channel.id, id);
    return { id: video.id, status: video.status, urls: video.urls };
  }
}
