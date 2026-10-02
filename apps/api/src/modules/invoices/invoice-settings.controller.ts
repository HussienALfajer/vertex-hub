import { Body, Controller, Get, Patch, SerializeOptions } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type InvoiceSettings,
  invoiceSettingsSchema,
  type UpdateInvoiceSettings,
  updateInvoiceSettingsSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { InvoiceSettingsService } from './invoice-settings.service.js';

@ApiTags('invoices')
@Controller('invoice-settings')
export class InvoiceSettingsController {
  constructor(private readonly settings: InvoiceSettingsService) {}

  @Get()
  @RequirePermissions('invoices.read')
  @SerializeOptions({ schema: invoiceSettingsSchema })
  @ApiOkResponse({ description: 'The invoice settings', standardSchema: invoiceSettingsSchema })
  get(@CurrentUser() actor: CurrentUserInfo): Promise<InvoiceSettings> {
    return this.settings.get(actor);
  }

  @Patch()
  @RequirePermissions('invoices.manage')
  @SerializeOptions({ schema: invoiceSettingsSchema })
  @ApiOkResponse({
    description: 'The settings after the change; a new rate records who set it and when',
    standardSchema: invoiceSettingsSchema,
  })
  update(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: updateInvoiceSettingsSchema }) input: UpdateInvoiceSettings,
  ): Promise<InvoiceSettings> {
    return this.settings.update(actor, input);
  }
}
