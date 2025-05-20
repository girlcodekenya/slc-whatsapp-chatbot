import { Body, Controller, Get, HttpCode, Logger, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';

import * as process from 'node:process';
import { WhatsappService } from './whatsapp.service';
import { AudioService } from 'src/audio/audio.service';
import { StabilityaiService } from 'src/stabilityai/stabilityai.service';
import { OpenaiService } from 'src/openai/openai.service';

@Controller('whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(
    private readonly whatsAppService: WhatsappService,
    private readonly stabilityaiService: StabilityaiService,
    private readonly audioService: AudioService,
    private readonly openaiService: OpenaiService,
  ) {}

  @Get('webhook')
  whatsappVerificationChallenge(
    @Query('hub.mode') mode: string,
    @Query('hub.challenge') challenge: string,
    @Query('hub.verify_token') token: string,
  ) {
    this.logger.log(`Received verification request - Mode: ${mode}, Token: ${token}`);
    
    const verificationToken =
      process.env.WHATSAPP_CLOUD_API_WEBHOOK_VERIFICATION_TOKEN;

    if (!mode || !token) {
      this.logger.error('Missing mode or token in verification request');
      return 'Error: Missing Parameters';
    }

    if (mode === 'subscribe' && token === verificationToken) {
      this.logger.log('Webhook verified successfully');
      return challenge;
    }
    
    this.logger.error(`Webhook verification failed - Token mismatch or invalid mode`);
    return 'Error: Token Mismatch';
  }

  @Post('webhook')
  @HttpCode(200)
  async handleIncomingWhatsappMessage(@Body() request: any) {
    this.logger.log(`Received webhook request: ${JSON.stringify(request)}`);
    
    const { messages } = request?.entry?.[0]?.changes?.[0].value ?? {};
    if (!messages) {
      this.logger.log('No messages in the request');
      return { status: 'success', message: 'No messages to process' };
    }

    const message = messages[0];
    const messageSender = message.from;
    const messageID = message.id;

    await this.whatsAppService.markMessageAsRead(messageID);

    switch (message.type) {
      case 'text':
        const text = message.text.body;
        const imageGenerationCommand = '/imagine';
        if (text.toLowerCase().includes(imageGenerationCommand)) {
          const response = await this.stabilityaiService.textToImage(
            text.replaceAll(imageGenerationCommand, ''),
          );

          if (Array.isArray(response)) {
            await this.whatsAppService.sendImageByUrl(
              messageSender,
              response[0],
              messageID,
            );
          }
          return { status: 'success', message: 'Image generation processed' };
        }

        await this.whatsAppService.sendWhatsAppMessage(
          messageSender,
          text,
          messageID,
        );
        break;
      case 'audio':
        const audioID = message.audio.id;
        const response = await this.whatsAppService.downloadMedia(audioID);
        if (response.status === 'error') {
          return { status: 'error', message: 'Failed to download audio' };
        }

        const transcribedSpeech = await this.audioService.convertAudioToText(
          response.data,
        );

        if (transcribedSpeech.status === 'error') {
          return { status: 'error', message: 'Failed to transcribe audio' };
        }

        const aiResponse = await this.openaiService.generateAIResponse(
          messageSender,
          transcribedSpeech.data,
        );

        const textToSpeech =
          await this.audioService.convertTextToSpeech(aiResponse);

        if (textToSpeech.status === 'error') {
          return { status: 'error', message: 'Failed to convert text to speech' };
        }

        await this.whatsAppService.sendAudioByUrl(
          messageSender,
          textToSpeech.data,
        );
    }

    return { status: 'success', message: 'Message processed' };
  }
}