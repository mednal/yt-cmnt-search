import { Test } from '@nestjs/testing';

import { DatabaseService } from '../database';
import { EMBEDDING_PROVIDER, LOCAL_EMBEDDING_DIMENSIONS } from '../embedding';
import type { EmbeddingProvider } from '../embedding';

import { EmbedController } from './embed.controller';
import { EmbedService } from './embed.service';

describe('EmbedController', () => {
  it('resolves the embedding provider from the token, not a concrete class', async () => {
    const provider: EmbeddingProvider = {
      model: 'stub',
      dimensions: LOCAL_EMBEDDING_DIMENSIONS,
      embed: async () => [],
    };

    // Compiling with only the token bound proves EmbedService depends on the
    // interface: had it asked for OpenAIEmbeddingProvider, this would throw.
    const moduleRef = await Test.createTestingModule({
      controllers: [EmbedController],
      providers: [
        EmbedService,
        { provide: DatabaseService, useValue: { query: jest.fn() } },
        { provide: EMBEDDING_PROVIDER, useValue: provider },
      ],
    }).compile();

    expect(moduleRef.get(EmbedService)).toBeInstanceOf(EmbedService);
  });

  it('delegates one step to the service', async () => {
    const step = jest.fn().mockResolvedValue({
      state: 'complete',
      embeddedCount: 3,
      remaining: 0,
      done: true,
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [EmbedController],
      providers: [{ provide: EmbedService, useValue: { step } }],
    }).compile();

    const result = await moduleRef.get(EmbedController).runEmbedStep('v1');

    expect(step).toHaveBeenCalledWith('v1');
    expect(result).toEqual({
      state: 'complete',
      embeddedCount: 3,
      remaining: 0,
      done: true,
    });
  });
});
