import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  SerializeOptions,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type InvoiceDetail,
  invoiceDetailSchema,
  type RecordPayment,
  recordPaymentSchema,
  type VoidPayment,
  voidPaymentSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { PaymentsService } from './payments.service.js';

@ApiTags('invoices')
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

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
}
