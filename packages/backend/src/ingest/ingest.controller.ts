import { Controller, Get, Param, Post } from '@nestjs/common';
import type { IngestStepResponse, VideoJobStatus } from '@yca/shared';

import { IngestService } from './ingest.service';

@Controller('videos/:videoId')
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

  /**
   * Runs one bounded ingest step (fetches one page of comments). The caller
   * drives ingestion to completion by calling this repeatedly until
   * `done: true` — see IMPLEMENTATION_PLAN.md §2.
   */
  @Post('ingest')
  runIngestStep(
    @Param('videoId') videoId: string,
  ): Promise<IngestStepResponse> {
    return this.ingest.step(videoId);
  }

  @Get('status')
  getStatus(@Param('videoId') videoId: string): Promise<VideoJobStatus> {
    return this.ingest.status(videoId);
  }
}
