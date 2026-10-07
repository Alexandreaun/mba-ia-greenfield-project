import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { WorkerModule } from './worker.module';

describe('WorkerModule bootstrap (integration)', () => {
  let app: INestApplicationContext;

  afterEach(async () => {
    await app?.close();
  });

  it('boots via NestFactory.createApplicationContext and connects to the database', async () => {
    app = await NestFactory.createApplicationContext(WorkerModule, {
      logger: false,
    });

    const dataSource = app.get(DataSource);

    expect(dataSource.isInitialized).toBe(true);
    await expect(dataSource.query('SELECT 1')).resolves.toEqual([
      { '?column?': 1 },
    ]);
  });
});
