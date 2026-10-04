import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  SerializeOptions,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type AdWallet,
  type AdWalletQuery,
  adWalletQuerySchema,
  adWalletSchema,
  type QuotePdfRender,
  quotePdfRenderSchema,
  type RecordWalletEntry,
  recordWalletEntrySchema,
  type UpdateWalletThreshold,
  updateWalletThresholdSchema,
  type VoidWalletEntry,
  voidWalletEntrySchema,
  type WalletListQuery,
  type WalletPage,
  walletListQuerySchema,
  walletPageSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { AdReceiptsService } from './ad-receipts.service.js';
import { AdWalletsService } from './ad-wallets.service.js';

@ApiTags('campaigns')
@Controller()
export class AdWalletsController {
  constructor(
    private readonly wallets: AdWalletsService,
    private readonly receipts: AdReceiptsService,
  ) {}

  @Get('ad-wallets')
  @RequirePermissions('campaigns.read')
  @SerializeOptions({ schema: walletPageSchema })
  @ApiOkResponse({
    description: 'Clients in scope that use the ad wallet or have a wallet campaign',
    standardSchema: walletPageSchema,
  })
  list(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: walletListQuerySchema }) query: WalletListQuery,
  ): Promise<WalletPage> {
    return this.wallets.list(actor, query);
  }

  @Get('clients/:id/ad-wallet')
  @RequirePermissions('campaigns.read')
  @SerializeOptions({ schema: adWalletSchema })
  @ApiOkResponse({
    description: "The client's ad wallet with its ledger and entries",
    standardSchema: adWalletSchema,
  })
  get(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) clientId: string,
    @Query({ schema: adWalletQuerySchema }) query: AdWalletQuery,
  ): Promise<AdWallet> {
    return this.wallets.get(actor, clientId, query);
  }

  @Patch('clients/:id/ad-wallet')
  @RequirePermissions('campaigns.manage')
  @SerializeOptions({ schema: adWalletSchema })
  @ApiOkResponse({
    description: 'The wallet with its new threshold',
    standardSchema: adWalletSchema,
  })
  setThreshold(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) clientId: string,
    @Body({ schema: updateWalletThresholdSchema }) input: UpdateWalletThreshold,
  ): Promise<AdWallet> {
    return this.wallets.setThreshold(actor, clientId, input);
  }

  @Post('clients/:id/ad-wallet/entries')
  @RequirePermissions('campaigns.fund')
  @SerializeOptions({ schema: adWalletSchema })
  @ApiCreatedResponse({
    description: 'The wallet with the new deposit or refund',
    standardSchema: adWalletSchema,
  })
  record(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) clientId: string,
    @Body({ schema: recordWalletEntrySchema }) input: RecordWalletEntry,
  ): Promise<AdWallet> {
    return this.wallets.record(actor, clientId, input);
  }

  @Post('ad-wallet-entries/:id/void')
  @HttpCode(200)
  @RequirePermissions('campaigns.fund')
  @SerializeOptions({ schema: adWalletSchema })
  @ApiOkResponse({ description: 'The wallet with the entry void', standardSchema: adWalletSchema })
  void(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: voidWalletEntrySchema }) input: VoidWalletEntry,
  ): Promise<AdWallet> {
    return this.wallets.void(actor, id, input);
  }

  @Post('ad-wallet-entries/:id/receipt')
  @HttpCode(200)
  @RequirePermissions('campaigns.read')
  @SerializeOptions({ schema: quotePdfRenderSchema })
  @ApiOkResponse({
    description: "Renders a deposit's receipt again when its PDF is not ready",
    standardSchema: quotePdfRenderSchema,
  })
  renderReceipt(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<QuotePdfRender> {
    return this.receipts.render(actor, id);
  }

  @Get('ad-wallet-entries/:id/receipt')
  @RequirePermissions('campaigns.read')
  @ApiOkResponse({ description: 'The receipt PDF of the deposit' })
  @ApiNotFoundResponse({ description: 'No such deposit, its receipt is not ready, or it is void' })
  async downloadReceipt(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: IncomingMessage,
    @Res() response: ServerResponse,
  ): Promise<void> {
    await this.receipts.serve(actor, id, request, response);
  }
}
