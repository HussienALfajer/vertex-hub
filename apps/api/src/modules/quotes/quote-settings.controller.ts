import { Body, Controller, Get, Patch, SerializeOptions } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type QuoteSettings,
  quoteSettingsSchema,
  type UpdateQuoteSettings,
  updateQuoteSettingsSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions, RequireSession } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { QuoteSettingsService } from './quote-settings.service.js';

@ApiTags('quotes')
@Controller('quote-settings')
export class QuoteSettingsController {
  constructor(private readonly settings: QuoteSettingsService) {}

  @Get()
  @RequirePermissions('quotes.read')
  @SerializeOptions({ schema: quoteSettingsSchema })
  @ApiOkResponse({ description: 'The quote settings', standardSchema: quoteSettingsSchema })
  get(@CurrentUser() actor: CurrentUserInfo): Promise<QuoteSettings> {
    return this.settings.get(actor);
  }

  /** Two permissions split the fields, so the service checks them (403). */
  @Patch()
  @RequireSession()
  @SerializeOptions({ schema: quoteSettingsSchema })
  @ApiOkResponse({
    description:
      'The settings after the change. Texts and validity need `catalog.manage`; the threshold `quotes.approve_discount`',
    standardSchema: quoteSettingsSchema,
  })
  update(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: updateQuoteSettingsSchema }) input: UpdateQuoteSettings,
  ): Promise<QuoteSettings> {
    return this.settings.update(actor, input);
  }
}
