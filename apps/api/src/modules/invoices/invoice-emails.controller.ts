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
  type ClientEmail,
  clientEmailSchema,
  type EmailHistory,
  type EmailSummary,
  emailHistorySchema,
  emailSummarySchema,
  type InvoiceEmail,
  invoiceEmailSchema,
  type StatementEmail,
  statementEmailSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { InvoiceEmailsService } from './invoice-emails.service.js';

const CLIENT_EMAIL_CONFLICTS =
  '`PDF_NOT_READY`, `CLIENT_ARCHIVED`, `INVALID_RECIPIENT`, `ATTACHMENT_TOO_LARGE`';

/** F14 email: invoices, receipts and statements emailed to the client's contacts. */
@ApiTags('invoices')
@Controller()
export class InvoiceEmailsController {
  constructor(private readonly emails: InvoiceEmailsService) {}

  @Post('invoices/:id/email')
  @HttpCode(202)
  @RequirePermissions('invoices.send')
  @SerializeOptions({ schema: emailSummarySchema })
  @ApiAcceptedResponse({
    description: 'The invoice or its overdue reminder, queued with the invoice PDF',
    standardSchema: emailSummarySchema,
  })
  @ApiNotFoundResponse({ description: 'No such invoice' })
  @ApiConflictResponse({
    description: `\`INVOICE_NOT_ISSUED\`, \`INVOICE_NOT_OVERDUE\`, ${CLIENT_EMAIL_CONFLICTS}`,
  })
  sendInvoice(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: invoiceEmailSchema }) input: InvoiceEmail,
  ): Promise<EmailSummary> {
    return this.emails.sendInvoice(actor, id, input);
  }

  @Get('invoices/:id/emails')
  @RequirePermissions('invoices.read')
  @SerializeOptions({ schema: emailHistorySchema })
  @ApiOkResponse({
    description: "The emails of the invoice and of its payments' receipts, newest first",
    standardSchema: emailHistorySchema,
  })
  @ApiNotFoundResponse({ description: 'No such invoice' })
  invoiceHistory(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EmailHistory> {
    return this.emails.invoiceHistory(actor, id);
  }

  @Post('payments/:id/email')
  @HttpCode(202)
  @RequirePermissions('invoices.send')
  @SerializeOptions({ schema: emailSummarySchema })
  @ApiAcceptedResponse({
    description: "The payment's receipt, queued with its PDF",
    standardSchema: emailSummarySchema,
  })
  @ApiNotFoundResponse({ description: 'No such payment' })
  @ApiConflictResponse({ description: `\`PAYMENT_VOIDED\`, ${CLIENT_EMAIL_CONFLICTS}` })
  sendReceipt(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: clientEmailSchema }) input: ClientEmail,
  ): Promise<EmailSummary> {
    return this.emails.sendReceipt(actor, id, input);
  }

  @Post('clients/:id/statement/email')
  @HttpCode(202)
  @RequirePermissions('invoices.send')
  @SerializeOptions({ schema: emailSummarySchema })
  @ApiAcceptedResponse({
    description: 'The statement as it is now, queued with a copy of its ready PDF',
    standardSchema: emailSummarySchema,
  })
  @ApiNotFoundResponse({ description: 'No such client' })
  @ApiConflictResponse({ description: CLIENT_EMAIL_CONFLICTS })
  sendStatement(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: statementEmailSchema }) input: StatementEmail,
  ): Promise<EmailSummary> {
    return this.emails.sendStatement(actor, id, input);
  }

  @Get('clients/:id/statement/emails')
  @RequirePermissions('invoices.read')
  @SerializeOptions({ schema: emailHistorySchema })
  @ApiOkResponse({
    description: "The client's emailed statements, newest first",
    standardSchema: emailHistorySchema,
  })
  @ApiNotFoundResponse({ description: 'No such client' })
  statementHistory(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EmailHistory> {
    return this.emails.statementHistory(actor, id);
  }
}
