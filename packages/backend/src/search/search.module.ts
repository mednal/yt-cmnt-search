import { Module } from '@nestjs/common';

import { EmbeddingModule } from '../embedding';

import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  // Semantic search embeds the query with the same provider the pipeline
  // embedded the comments with — one binding, so the two can never disagree.
  imports: [EmbeddingModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
