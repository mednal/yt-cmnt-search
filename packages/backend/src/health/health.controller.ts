import { Controller, Get } from '@nestjs/common';

import { DatabaseService, type DatabaseStatus } from '../database';

export interface HealthResponse {
  /** `'degraded'` means the process is up but a dependency is not. */
  status: 'ok' | 'degraded';
  uptime: number;
  database: DatabaseStatus;
}

/**
 * Liveness endpoint.
 *
 * Always answers 200: the extension polls this to decide what to show, and a
 * degraded dependency is information, not a transport failure.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  async check(): Promise<HealthResponse> {
    const database = await this.database.ping();

    return {
      status: database.status === 'ok' ? 'ok' : 'degraded',
      uptime: Math.round(process.uptime()),
      database,
    };
  }
}
