import { Module } from '@nestjs/common';

import { EmbeddingModule } from '../embedding';

import { EmbedController } from './embed.controller';
import { EmbedService } from './embed.service';

@Module({
  imports: [EmbeddingModule],
  controllers: [EmbedController],
  providers: [EmbedService],
  exports: [EmbedService],
})
export class EmbedModule {}
