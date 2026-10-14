import { Body, Controller, Get, Patch, Put, SerializeOptions } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type ContractArticlesResponse,
  type ContractSettings,
  contractArticlesResponseSchema,
  contractSettingsSchema,
  type UpdateContractArticles,
  type UpdateContractSettings,
  updateContractArticlesSchema,
  updateContractSettingsSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { ContractSettingsService } from './contract-settings.service.js';

@ApiTags('retainers')
@Controller('contract-settings')
export class ContractSettingsController {
  constructor(private readonly settings: ContractSettingsService) {}

  /** Readers need client scope and `invoices.read` too, so the service checks them (403). */
  @Get()
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: contractSettingsSchema })
  @ApiOkResponse({
    description: 'The contract settings and the default articles; needs money access too',
    standardSchema: contractSettingsSchema,
  })
  get(@CurrentUser() actor: CurrentUserInfo): Promise<ContractSettings> {
    return this.settings.get(actor);
  }

  @Patch()
  @RequirePermissions('catalog.manage')
  @SerializeOptions({ schema: contractSettingsSchema })
  @ApiOkResponse({
    description: 'The settings after the change',
    standardSchema: contractSettingsSchema,
  })
  update(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: updateContractSettingsSchema }) input: UpdateContractSettings,
  ): Promise<ContractSettings> {
    return this.settings.update(actor, input);
  }

  @Put('articles')
  @RequirePermissions('catalog.manage')
  @SerializeOptions({ schema: contractArticlesResponseSchema })
  @ApiOkResponse({
    description: 'The default articles after the change, in order',
    standardSchema: contractArticlesResponseSchema,
  })
  updateArticles(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: updateContractArticlesSchema }) input: UpdateContractArticles,
  ): Promise<ContractArticlesResponse> {
    return this.settings.updateArticles(actor, input);
  }
}
