import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Lets DatabaseService.onModuleDestroy close the pg pool on SIGINT/SIGTERM.
  app.enableShutdownHooks();

  // The side panel calls this API from a chrome-extension:// origin (M7).
  // MV3 host permissions usually cover that, but a local dev API answering
  // any origin removes a whole class of confusing opaque failures.
  app.enableCors();
  const port = app.get(ConfigService).get<number>('PORT') ?? 3000;

  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Backend listening on http://localhost:${port}`);
}

void bootstrap();
