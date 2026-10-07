import express from 'express';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { DomainExceptionFilter } from './common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from './common/filters/validation-exception.filter';
import storageConfig from './config/storage.config';
import swaggerConfig from './config/swagger.config';
import { buildSwaggerDocument } from './swagger/swagger-document';
import { createTusServer } from './uploads/tus-server.factory';
import { UploadsService } from './uploads/uploads.service';
import swaggerMetadata from './metadata.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port') ?? 3000;

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(
    new DomainExceptionFilter(),
    new ValidationExceptionFilter(),
  );

  const uploadsService = app.get(UploadsService);
  const jwtService = app.get(JwtService);
  const storage = app.get<ConfigType<typeof storageConfig>>(storageConfig.KEY);
  const tusServer = createTusServer(uploadsService, jwtService, storage);
  const uploadApp = express();
  uploadApp.use(tusServer.handle.bind(tusServer));
  const expressInstance = app.getHttpAdapter().getInstance() as express.Express;
  expressInstance.use('/uploads', uploadApp);

  const swagger = app.get<ConfigType<typeof swaggerConfig>>(swaggerConfig.KEY);

  if (swagger.enabled) {
    await SwaggerModule.loadPluginMetadata(swaggerMetadata);
    const document = buildSwaggerDocument(app);
    SwaggerModule.setup('api/docs', app, document, {
      customSiteTitle: 'StreamTube API Docs',
      swaggerOptions: { persistAuthorization: true },
    });
  }

  await app.listen(port);
}
void bootstrap();
