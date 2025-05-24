import { Module } from '@nestjs/common';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';
import { OpenaiService } from '../openai/openai.service';
import { UserContextService } from '../user-context/user-context.service';
import { StabilityaiService } from '../stabilityai/stabilityai.service';
import { AudioService } from '../audio/audio.service';

@Module({
  controllers: [TelegramController],
  providers: [
    TelegramService,
    OpenaiService,
    UserContextService,
    StabilityaiService,
    AudioService,
  ],
})
export class TelegramModule {}