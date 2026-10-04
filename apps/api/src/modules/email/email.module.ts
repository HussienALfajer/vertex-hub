import { Module } from '@nestjs/common';
import { EmailController } from './email.controller.js';
import { EmailService } from './email.service.js';
import { Mailer } from './mailer.js';

/**
 * The email outbox (F14 email, ADR 0028): modules queue emails with `Mailer.queue` in the
 * transaction of their change; the worker sends them. Serves the email log and the test email.
 */
@Module({
  controllers: [EmailController],
  providers: [Mailer, EmailService],
  exports: [Mailer],
})
export class EmailModule {}
