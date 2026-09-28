import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  SerializeOptions,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type CreatePlatformAccount,
  createPlatformAccountSchema,
  type PlatformAccount,
  platformAccountSchema,
  type UpdatePlatformAccount,
  updatePlatformAccountSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { ClientPlatformAccountsService } from './client-platform-accounts.service.js';

@ApiTags('clients')
@Controller('clients/:id/platform-accounts')
export class ClientPlatformAccountsController {
  constructor(private readonly accounts: ClientPlatformAccountsService) {}

  @Post()
  @RequirePermissions('clients.manage')
  @SerializeOptions({ schema: platformAccountSchema })
  @ApiCreatedResponse({
    description: 'The new platform account',
    standardSchema: platformAccountSchema,
  })
  create(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) clientId: string,
    @Body({ schema: createPlatformAccountSchema }) input: CreatePlatformAccount,
  ): Promise<PlatformAccount> {
    return this.accounts.create(actor, clientId, input);
  }

  @Patch(':accountId')
  @RequirePermissions('clients.manage')
  @SerializeOptions({ schema: platformAccountSchema })
  @ApiOkResponse({
    description: 'The updated platform account',
    standardSchema: platformAccountSchema,
  })
  update(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) clientId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body({ schema: updatePlatformAccountSchema }) input: UpdatePlatformAccount,
  ): Promise<PlatformAccount> {
    return this.accounts.update(actor, clientId, accountId, input);
  }

  @Post(':accountId/archive')
  @HttpCode(204)
  @RequirePermissions('clients.manage')
  @ApiNoContentResponse({ description: 'The platform account is removed from the client' })
  archive(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) clientId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ): Promise<void> {
    return this.accounts.archive(actor, clientId, accountId);
  }
}
