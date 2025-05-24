import { Module } from '@nestjs/common';
import { OpenaiService } from './openai.service';
import { UserContextService } from '../user-context/user-context.service';

@Module({
  providers: [OpenaiService, UserContextService],
})
export class OpenaiModule {}
