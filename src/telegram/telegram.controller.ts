import { Body, Controller, Get, HttpCode, Logger, Post } from '@nestjs/common';
import { TelegramService } from './telegram.service';

@Controller('telegram')
export class TelegramController {
  private readonly logger = new Logger(TelegramController.name);

  constructor(private readonly telegramService: TelegramService) {}

  @Get('status')
  getStatus() {
    return { status: 'Telegram bot is running' };
  }

  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(@Body() update: any) {
    this.logger.log(`Received update: ${JSON.stringify(update)}`);
    
    try {
      await this.telegramService.processWebhookUpdate(update);
      return { status: 'ok' };
    } catch (error) {
      this.logger.error('Webhook processing error:', error);
      return { status: 'error', message: error.message };
    }
  }
}