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
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { AdWalletEmailsService } from './ad-wallet-emails.service.js';

/**
 * F14 email: ad deposit receipts and low-balance notices emailed to the client's contacts. The
 * guard requires `campaigns.read`; the service requires `campaigns.fund`, or `campaigns.manage`
 * over the client, to send.
 */
@ApiTags('campaigns')
@Controller()
export class AdWalletEmailsController {
  constructor(private readonly emails: AdWalletEmailsService) {}

  @Post('ad-wallet-entries/:id/email')
  @HttpCode(202)
  @RequirePermissions('campaigns.read')
  @SerializeOptions({ schema: emailSummarySchema })
  @ApiAcceptedResponse({
    description: "The deposit's receipt, queued with its PDF",
    standardSchema: emailSummarySchema,
  })
  @ApiNotFoundResponse({ description: 'No such deposit' })
  @ApiConflictResponse({
    description:
      '`ENTRY_VOIDED`, `PDF_NOT_READY`, `CLIENT_ARCHIVED`, `INVALID_RECIPIENT`, `ATTACHMENT_TOO_LARGE`',
  })
  sendReceipt(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: clientEmailSchema }) input: ClientEmail,
  ): Promise<EmailSummary> {
    return this.emails.sendReceipt(actor, id, input);
  }

  @Post('clients/:id/ad-wallet/email')
  @HttpCode(202)
  @RequirePermissions('campaigns.read')
  @SerializeOptions({ schema: emailSummarySchema })
  @ApiAcceptedResponse({
    description: 'The low-balance notice, queued while the wallet is below its threshold',
    standardSchema: emailSummarySchema,
  })
  @ApiNotFoundResponse({ description: 'No such client' })
  @ApiConflictResponse({
    description: '`BUDGET_NOT_LOW`, `CLIENT_ARCHIVED`, `INVALID_RECIPIENT`',
  })
  sendBudgetLow(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: clientEmailSchema }) input: ClientEmail,
  ): Promise<EmailSummary> {
    return this.emails.sendBudgetLow(actor, id, input);
  }

  @Get('clients/:id/ad-wallet/emails')
  @RequirePermissions('campaigns.read')
  @SerializeOptions({ schema: emailHistorySchema })
  @ApiOkResponse({
    description: "The client's emailed ad receipts and budget notices, newest first",
    standardSchema: emailHistorySchema,
  })
  @ApiNotFoundResponse({ description: 'No such client' })
  history(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EmailHistory> {
    return this.emails.history(actor, id);
  }
}
