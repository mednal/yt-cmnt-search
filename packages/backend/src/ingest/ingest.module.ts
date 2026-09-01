import { Module } from '@nestjs/common';

import { YoutubeModule } from '../youtube';

import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';

@Module({
  imports: [YoutubeModule],
  controllers: [IngestController],
  providers: [IngestService],
})
export class IngestModule {}
