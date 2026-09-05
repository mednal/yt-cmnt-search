import { Controller, Param, Post } from '@nestjs/common';
import type { EmbedStepResponse } from '@yca/shared';

import { EmbedService } from './embed.service';

@Controller('videos/:videoId')
export class EmbedController {
  constructor(private readonly embed: EmbedService) {}

  /**
   * Runs one bounded embedding step (one batch of comments). The caller
   * drives embedding to completion by calling this repeatedly until
   * `done: true` — see IMPLEMENTATION_PLAN.md §2.
   */
  @Post('embed')
  runEmbedStep(@Param('videoId') videoId: string): Promise<EmbedStepResponse> {
    return this.embed.step(videoId);
  }
}
