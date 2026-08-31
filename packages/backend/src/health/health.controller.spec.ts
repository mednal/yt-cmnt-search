import { Test } from '@nestjs/testing';

import { DatabaseService } from '../database';

import { HealthController } from './health.controller';

describe('HealthController', () => {
  const build = async (ping: jest.Mock): Promise<HealthController> => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: DatabaseService, useValue: { ping } }],
    }).compile();

    return moduleRef.get(HealthController);
  };

  it('reports ok with a non-negative uptime when the database answers', async () => {
    const controller = await build(jest.fn().mockResolvedValue({ status: 'ok' }));

    const result = await controller.check();

    expect(result.status).toBe('ok');
    expect(result.database).toEqual({ status: 'ok' });
    expect(result.uptime).toBeGreaterThanOrEqual(0);
  });

  it('reports degraded, not a failure, when the database is unreachable', async () => {
    const controller = await build(
      jest.fn().mockResolvedValue({ status: 'error', error: 'ECONNREFUSED' }),
    );

    const result = await controller.check();

    expect(result.status).toBe('degraded');
    expect(result.database).toEqual({ status: 'error', error: 'ECONNREFUSED' });
  });
});
