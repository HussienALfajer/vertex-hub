import { Controller, Get, HttpCode, Post, Query, SerializeOptions } from '@nestjs/common';
import { ApiAcceptedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type EmailListQuery,
  type EmailPage,
  type EmailSummary,
  emailListQuerySchema,
  emailPageSchema,
  emailSummarySchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { EmailService } from './email.service.js';
import { CurrentSender, type EmailSender } from './email-sender.decorator.js';

@ApiTags('email')
@Controller('emails')
export class EmailController {
  constructor(private readonly emails: EmailService) {}

  @Get()
  @RequirePermissions('audit.read')
  @SerializeOptions({ schema: emailPageSchema })
  @ApiOkResponse({
    description: 'Emails of the outbox, newest first',
    standardSchema: emailPageSchema,
  })
  list(@Query({ schema: emailListQuerySchema }) query: EmailListQuery): Promise<EmailPage> {
    return this.emails.list(query);
  }

  @Post('test')
  @HttpCode(202)
  @RequirePermissions('users.manage')
  @SerializeOptions({ schema: emailSummarySchema })
  @ApiAcceptedResponse({
    description: 'A test email to your own address, queued',
    standardSchema: emailSummarySchema,
  })
  sendTest(@CurrentSender() sender: EmailSender): Promise<EmailSummary> {
    return this.emails.sendTest(sender);
  }
}
