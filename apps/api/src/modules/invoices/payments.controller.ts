import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  SerializeOptions,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type InvoiceDetail,
  invoiceDetailSchema,
  type QuotePdfRender,
  quotePdfRenderSchema,
  type RecordPayment,
  recordPaymentSchema,
  type VoidPayment,
  voidPaymentSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { InvoicePdfService } from './invoice-pdf.service.js';
import { PaymentsService } from './payments.service.js';

@ApiTags('invoices')
@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly pdf: InvoicePdfService,
  ) {}

  @Post('invoices/:id/payments')
  @RequirePermissions('payments.manage')
  @SerializeOptions({ schema: invoiceDetailSchema })
  @ApiCreatedResponse({
    description: 'The invoice with the new payment, its paid amount and status',
    standardSchema: invoiceDetailSchema,
  })
  record(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: recordPaymentSchema }) input: RecordPayment,
  ): Promise<InvoiceDetail> {
    return this.payments.record(actor, id, input);
  }

  @Post('payments/:id/void')
  @HttpCode(200)
  @RequirePermissions('payments.manage')
  @SerializeOptions({ schema: invoiceDetailSchema })
  @ApiOkResponse({
    description: 'The invoice with the payment void, its paid amount and status recomputed',
    standardSchema: invoiceDetailSchema,
  })
  void(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: voidPaymentSchema }) input: VoidPayment,
  ): Promise<InvoiceDetail> {
    return this.payments.void(actor, id, input);
  }

  @Post('payments/:id/receipt')
  @HttpCode(200)
  @RequirePermissions('invoices.read')
  @SerializeOptions({ schema: quotePdfRenderSchema })
  @ApiOkResponse({
    description: 'Renders the receipt again when its PDF is not ready',
    standardSchema: quotePdfRenderSchema,
  })
  renderReceipt(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<QuotePdfRender> {
    return this.pdf.renderReceipt(actor, id);
  }

  @Get('payments/:id/receipt')
  @RequirePermissions('invoices.read')
  @ApiOkResponse({ description: 'The receipt PDF of the payment' })
  @ApiNotFoundResponse({ description: 'No such payment, its receipt is not ready, or it is void' })
  async downloadReceipt(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: IncomingMessage,
    @Res() response: ServerResponse,
  ): Promise<void> {
    await this.pdf.serveReceipt(actor, id, request, response);
  }
}
