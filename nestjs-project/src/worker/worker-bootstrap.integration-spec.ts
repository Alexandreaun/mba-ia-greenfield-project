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
    // abortOnError defaults to true, which calls process.exit(1) directly
    // on any bootstrap error — fatal for a test run (kills the whole Jest
    // process, not just this test). WorkerModule now also starts pg-boss
    // (JobsModule) and the storage/videos modules, so boot time is no
    // longer negligible under full-suite load.
    app = await NestFactory.createApplicationContext(WorkerModule, {
      logger: false,
      abortOnError: false,
    });

    const dataSource = app.get(DataSource);

    expect(dataSource.isInitialized).toBe(true);
    await expect(dataSource.query('SELECT 1')).resolves.toEqual([
      { '?column?': 1 },
    ]);
  }, 15000);
});
