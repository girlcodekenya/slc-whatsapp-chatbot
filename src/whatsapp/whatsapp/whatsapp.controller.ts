import { Body, Controller, Get, HttpCode, Logger, Post, Query } from '@nestjs/common';
import { map } from 'rxjs/operators';

import * as process from 'node:process';
import { WhatsappService } from './whatsapp.service';
import { AudioService } from '../../audio/audio.service';
import { StabilityaiService } from '../../stabilityai/stabilityai.service';
import { OpenaiService } from '../../openai/openai.service';
import { UserContextService } from '../../user-context/user-context.service';

@Controller('whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(
    private readonly whatsAppService: WhatsappService,
    private readonly stabilityaiService: StabilityaiService,
    private readonly audioService: AudioService,
    private readonly openaiService: OpenaiService,
    private readonly userContextService: UserContextService,
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
    
    const { messages, contacts } = request?.entry?.[0]?.changes?.[0].value ?? {};
    if (!messages) {
      this.logger.log('No messages in the request');
      return { status: 'success', message: 'No messages to process' };
    }

    const message = messages[0];
    const messageSender = message.from;
    const messageID = message.id;

    const contactName = contacts?.[0]?.profile?.name || 'User';
    this.logger.log(`Message from ${contactName} (${messageSender})`);

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
      case 'interactive':
        const interactiveType = message.interactive.type;
        if (interactiveType === 'button_reply') {
          const buttonId = message.interactive.button_reply.id;
          const buttonText = message.interactive.button_reply.title;
          
          // Save the user's selection to context
          await this.userContextService.saveToContext(
            `User selected: ${buttonText}`,
            'user',
            messageSender
          );
          
          // Handle specific button actions
          if (buttonId === 'more_options') {
            await this.whatsAppService.sendMoreOptionsMessage(messageSender);
          } else {
            // For other buttons, generate appropriate responses
            const serviceInfo = this.getServiceInfo(buttonId);
            
            // Save the system response
            await this.userContextService.saveToContext(
              serviceInfo,
              'assistant',
              messageSender
            );
            
            // Send service info as a regular message
            const data = JSON.stringify({
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: messageSender,
              type: 'text',
              text: {
                preview_url: false,
                body: serviceInfo,
              },
            });
            
            try {
              const response = await this.whatsAppService['httpService']
                .post(this.whatsAppService['url'], data, this.whatsAppService['config'])
                .pipe(
                  map((res) => {
                    return res.data;
                  }),
                )
                .toPromise();
              
              this.logger.log('Service info sent. Status:', response);
            } catch (error) {
              this.logger.error('Error sending service info', error);
            }
          }
        }
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
        break;
    }

    return { status: 'success', message: 'Message processed' };
  }
  
  private getServiceInfo(serviceId: string): string {
    // Return information about each service based on the button ID
    const serviceInfo = {
      branding_service: `🎨 *Studio Libra Branding Services*\n\nWe create memorable brand identities that resonate with your audience. Our branding services include:\n• Logo design\n• Brand strategy\n• Visual identity systems\n• Brand guidelines\n• Packaging design\n\nReady to elevate your brand? Let us know what you need!`,
      
      software_dev_service: `💻 *Studio Libra Software Development*\n\nWe build custom software solutions to power your business:\n• Web applications\n• Mobile apps\n• E-commerce platforms\n• AI integration\n• API development\n• Custom business software\n\nTell us about your project and we'll help bring it to life!`,
      
      models_service: `🧠 *Studio Libra 3D Models & AI Services*\n\nWe create cutting-edge 3D models and AI solutions:\n• 3D character modeling\n• Product visualization\n• Architectural models\n• AI model customization\n• Digital twins\n\nWhat kind of model are you looking for?`,
      
      illustrations_comics: `✏️ *Studio Libra Illustrations & Comics*\n\nOur talented artists create:\n• Custom illustrations\n• Comic books & strips\n• Character design\n• Storyboards\n• Editorial illustrations\n• Children's book art\n\nLet's bring your story to life!`,
      
      talk_to_human: `👋 *Talk to a Human*\n\nThanks for reaching out! A member of our team will get back to you shortly during our business hours.\n\nIf you have a specific question or project in mind, feel free to share some details while you wait.`
    };
    
    return serviceInfo[serviceId] || 'Thank you for your interest! Please tell us more about what you are looking for.';
  }
}