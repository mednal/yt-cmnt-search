import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { DatabaseModule } from './database';
import { HealthModule } from './health/health.module';
import { IngestModule } from './ingest';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // The repo root holds the single .env alongside .env.example.
      envFilePath: ['../../.env'],
    }),
    DatabaseModule,
    HealthModule,
    IngestModule,
  ],
})
export class AppModule {}
