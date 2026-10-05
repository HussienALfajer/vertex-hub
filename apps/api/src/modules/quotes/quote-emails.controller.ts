import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  SerializeOptions,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  type EmailHistory,
  type EmailSummary,
  emailHistorySchema,
  emailSummarySchema,
  type QuoteEmail,
  quoteEmailSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { QuoteEmailsService } from './quote-emails.service.js';

/** F14 email: a quote emailed to the client's contacts, and its history. */
@ApiTags('quotes')
@Controller('quotes')
export class QuoteEmailsController {
  constructor(private readonly emails: QuoteEmailsService) {}

  @Post(':id/email')
  @HttpCode(202)
  @RequirePermissions('quotes.manage')
  @SerializeOptions({ schema: emailSummarySchema })
  @ApiAcceptedResponse({
    description: 'The quote or its reminder, queued with the PDF of the sent version',
    standardSchema: emailSummarySchema,
  })
  @ApiNotFoundResponse({ description: 'No such quote' })
  @ApiConflictResponse({
    description:
      '`QUOTE_NOT_SENT`, `QUOTE_EXPIRED`, `PDF_NOT_READY`, `CLIENT_ARCHIVED`, `INVALID_RECIPIENT`, `ATTACHMENT_TOO_LARGE`',
  })
  send(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: quoteEmailSchema }) input: QuoteEmail,
  ): Promise<EmailSummary> {
    return this.emails.send(actor, id, input);
  }

  @Get(':id/emails')
  @RequirePermissions('quotes.read')
  @SerializeOptions({ schema: emailHistorySchema })
  @ApiOkResponse({
    description: "The quote's emails, newest first",
    standardSchema: emailHistorySchema,
  })
  @ApiNotFoundResponse({ description: 'No such quote' })
  history(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EmailHistory> {
    return this.emails.history(actor, id);
  }
}
