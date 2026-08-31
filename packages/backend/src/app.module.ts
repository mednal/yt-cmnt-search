import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { DatabaseModule } from './database';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // The repo root holds the single .env alongside .env.example.
      envFilePath: ['../../.env'],
    }),
    DatabaseModule,
    HealthModule,
  ],
})
export class AppModule {}
