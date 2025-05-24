import { Injectable, Logger } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { OpenaiService } from '../openai/openai.service';
import { StabilityaiService } from '../stabilityai/stabilityai.service';
import { AudioService } from '../audio/audio.service';
import { UserContextService } from '../user-context/user-context.service';

@Injectable()
export class TelegramService {
  private bot: TelegramBot;
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    private readonly openaiService: OpenaiService,
    private readonly stabilityaiService: StabilityaiService,
    private readonly audioService: AudioService,
    private readonly userContextService: UserContextService,
  ) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is not defined');
    }
    
    // Initialize bot (webhook mode for production)
    this.bot = new TelegramBot(token);
    
    // Set up webhook if in production
    if (process.env.NODE_ENV === 'production') {
      this.setupWebhook();
    } else {
      // Use polling for development
      this.bot = new TelegramBot(token, { polling: true });
      this.setupHandlers();
    }
  }

  private async setupWebhook() {
    const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
    if (webhookUrl) {
      await this.bot.setWebHook(webhookUrl);
      this.logger.log(`Webhook set to: ${webhookUrl}`);
    }
  }

  private setupHandlers() {
    // Handle /start command
    this.bot.onText(/\/start/, (msg) => {
      this.handleStartCommand(msg);
    });

    // Handle text messages
    this.bot.on('message', (msg) => {
      if (msg.text && !msg.text.startsWith('/')) {
        this.handleTextMessage(msg);
      }
    });

    // Handle voice messages
    this.bot.on('voice', (msg) => {
      this.handleVoiceMessage(msg);
    });

    // Handle callback queries (inline buttons)
    this.bot.on('callback_query', (query) => {
      this.handleCallbackQuery(query);
    });
  }

  async processWebhookUpdate(update: any) {
    try {
      if (update.message) {
        const msg = update.message;
        
        if (msg.text?.startsWith('/start')) {
          await this.handleStartCommand(msg);
        } else if (msg.text && !msg.text.startsWith('/')) {
          await this.handleTextMessage(msg);
        } else if (msg.voice) {
          await this.handleVoiceMessage(msg);
        }
      } else if (update.callback_query) {
        await this.handleCallbackQuery(update.callback_query);
      }
    } catch (error) {
      this.logger.error('Error processing webhook update:', error);
    }
  }

  private async handleStartCommand(msg: any) {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    
    // Save initial context
    await this.userContextService.saveToContext(
      'User started conversation with Studio Libra via Telegram',
      'assistant',
      userId
    );

    const welcomeMessage = `
🎨 *Welcome to Studio Libra!*

Hi ${msg.from.first_name || 'there'}! I'm your creative assistant. 

What would you like to explore today?
    `;

    const options = {
      parse_mode: 'Markdown' as const,
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🎨 Branding', callback_data: 'branding_service' },
            { text: '💻 Software Dev', callback_data: 'software_dev_service' }
          ],
          [
            { text: '🧠 3D Models & AI', callback_data: 'models_service' },
            { text: '✏️ Illustrations', callback_data: 'illustrations_comics' }
          ],
          [
            { text: '👋 Talk to Human', callback_data: 'talk_to_human' }
          ]
        ]
      }
    };

    await this.bot.sendMessage(chatId, welcomeMessage, options);
  }

  private async handleTextMessage(msg: any) {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const text = msg.text;

    // Handle image generation command
    if (text.toLowerCase().includes('/imagine')) {
      await this.handleImageGeneration(chatId, userId, text);
      return;
    }

    // Send typing indicator
    await this.bot.sendChatAction(chatId, 'typing');

    // Generate AI response
    const aiResponse = await this.openaiService.generateAIResponse(userId, text);

    // Send response
    await this.bot.sendMessage(chatId, aiResponse, {
      parse_mode: 'Markdown',
      reply_to_message_id: msg.message_id
    });
  }

  private async handleImageGeneration(chatId: number, userId: string, text: string) {
    const prompt = text.replace(/\/imagine/gi, '').trim();
    
    if (!prompt) {
      await this.bot.sendMessage(chatId, '🎨 Please provide a description for the image you want to generate.\n\nExample: `/imagine a beautiful sunset over mountains`');
      return;
    }

    // Send generating message
    const loadingMsg = await this.bot.sendMessage(chatId, '🎨 Generating your image... This may take a moment!');

    try {
      const response = await this.stabilityaiService.textToImage(prompt);

      if (Array.isArray(response) && response.length > 0) {
        const imageUrl = `${process.env.SERVER_URL}/${response[0]}`;
        
        // Delete loading message
        await this.bot.deleteMessage(chatId, loadingMsg.message_id);
        
        // Send image
        await this.bot.sendPhoto(chatId, imageUrl, {
          caption: `🎨 Generated: "${prompt}"`
        });
      } else {
        await this.bot.editMessageText('❌ Failed to generate image. Please try again later.', {
          chat_id: chatId,
          message_id: loadingMsg.message_id
        });
      }
    } catch (error) {
      this.logger.error('Image generation error:', error);
      await this.bot.editMessageText('❌ Failed to generate image. Please try again later.', {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
    }
  }

  private async handleVoiceMessage(msg: any) {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const voiceFileId = msg.voice.file_id;

    try {
      // Send processing message
      const processingMsg = await this.bot.sendMessage(chatId, '🎤 Processing your voice message...');

      // Get file info and download
      const file = await this.bot.getFile(voiceFileId);
      const fileStream = this.bot.getFileStream(file.file_id);
      
      // Save file temporarily (you'll need to implement file saving)
      const filePath = await this.saveVoiceFile(fileStream, file.file_id);
      
      // Transcribe audio
      const transcription = await this.audioService.convertAudioToText(filePath);
      
      if (transcription.status === 'error') {
        await this.bot.editMessageText('❌ Failed to transcribe audio. Please try again.', {
          chat_id: chatId,
          message_id: processingMsg.message_id
        });
        return;
      }

      // Generate AI response
      const aiResponse = await this.openaiService.generateAIResponse(userId, transcription.data);

      // Convert response to speech
      const textToSpeech = await this.audioService.convertTextToSpeech(aiResponse);

      // Delete processing message
      await this.bot.deleteMessage(chatId, processingMsg.message_id);

      if (textToSpeech.status === 'success') {
        const audioUrl = `${process.env.SERVER_URL}/${textToSpeech.data}`;
        await this.bot.sendVoice(chatId, audioUrl, {
          reply_to_message_id: msg.message_id
        });
      } else {
        // Send text response if TTS fails
        await this.bot.sendMessage(chatId, aiResponse, {
          reply_to_message_id: msg.message_id
        });
      }

    } catch (error) {
      this.logger.error('Voice message processing error:', error);
      await this.bot.sendMessage(chatId, '❌ Failed to process voice message. Please try again.');
    }
  }

  private async handleCallbackQuery(query: any) {
    const chatId = query.message.chat.id;
    const userId = query.from.id.toString();
    const data = query.data;

    // Answer callback query to stop loading
    await this.bot.answerCallbackQuery(query.id);

    // Save user selection to context
    await this.userContextService.saveToContext(
      `User selected: ${data}`,
      'user',
      userId
    );

    // Get service information
    const serviceInfo = this.getServiceInfo(data);
    
    // Save response to context
    await this.userContextService.saveToContext(
      serviceInfo,
      'assistant',
      userId
    );

    // Send service information
    await this.bot.sendMessage(chatId, serviceInfo, {
      parse_mode: 'Markdown'
    });
  }

  private getServiceInfo(serviceId: string): string {
  const serviceInfo = {
    branding_service: `🎨 *Studio Libra Branding Services*

We deliver end-to-end branding solutions that make your business stand out:

• *Logo Design* – Unique, memorable logos that capture your brand's essence.
• *Visual Identity* – Cohesive color schemes, typography, and visuals for recognition.
• *Digital Printing* – High-quality prints: cards, brochures, banners, and more.
• *Brand Strategy* – Clear brand messaging, positioning, and identity guidelines.
• *Packaging Design* – Eye-catching packaging that boosts shelf appeal.
• *Stationery Design* – Branded stationery that strengthens your professional image.
• *Embroidery Branding* – Durable embroidery for uniforms, polos, overalls, and more.
• *Sublimation Branding* – Vivid, long-lasting sublimation prints that won’t peel or fade.

📩 *Contact us today at* info@studiolibracreatives.com`,

    software_dev_service: `💻 *Studio Libra Software Development*

We build high-performance software tailored to your business:

• *Web Development* – Modern websites, web apps, and e-commerce solutions.
• *Mobile Apps* – Native and cross-platform apps for iOS & Android.
• *Custom Software* – Solutions that automate and optimize your operations.
• *Backend Development* – Powerful APIs, databases, and cloud integration.
• *UI/UX Development* – Engaging and intuitive user interfaces and experiences.
• *Maintenance & Support* – Reliable updates, bug fixes, and improvements.

📩 *Contact us today at* info@studiolibracreatives.com`,

    models_service: `🧠 *Studio Libra 3D Models & AI Services*

We create cutting-edge 3D models and AI solutions:
• 3D character modeling
• Product visualization
• Architectural models
• AI model customization
• Digital twins

What kind of model are you looking for?`,

    illustrations_comics: `✏️ *Studio Libra Illustrations & Comics*

Our talented artists create:
• Custom illustrations
• Comic books & strips
• Character design
• Storyboards
• Editorial illustrations
• Children's book art

Let's bring your story to life!`,

    talk_to_human: `👋 *Talk to a Human*

Thanks for reaching out! A member of our team will get back to you shortly during our business hours.

If you have a specific question or project in mind, feel free to share some details while you wait.`
  };

  return serviceInfo[serviceId] || 'Thank you for your interest! Please tell us more about what you are looking for.';
}

  private async saveVoiceFile(fileStream: NodeJS.ReadableStream, fileId: string): Promise<string> {
    // Implementation to save voice file temporarily
    // You'll need to implement this based on your audio handling setup
    const fs = require('fs');
    const path = require('path');
    
    const audioFolder = process.env.AUDIO_FILES_FOLDER || 'audioFiles';
    const fileName = `${fileId}.ogg`;
    const filePath = path.join(process.cwd(), audioFolder, fileName);
    
    return new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(filePath);
      fileStream.pipe(writeStream);
      
      writeStream.on('finish', () => {
        resolve(filePath);
      });
      
      writeStream.on('error', (error) => {
        reject(error);
      });
    });
  }
}