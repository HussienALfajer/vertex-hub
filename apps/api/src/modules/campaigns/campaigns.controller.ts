import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type CampaignDetail,
  type CampaignListQuery,
  type CampaignPage,
  type CampaignStatusChange,
  type CampaignUpdateInput,
  type CreateCampaign,
  campaignDetailSchema,
  campaignListQuerySchema,
  campaignPageSchema,
  campaignStatusChangeSchema,
  campaignUpdateInputSchema,
  createCampaignSchema,
  type PatchCampaignUpdate,
  patchCampaignUpdateSchema,
  type UpdateCampaign,
  updateCampaignSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { CampaignUpdatesService } from './campaign-updates.service.js';
import { CampaignsService } from './campaigns.service.js';

@ApiTags('campaigns')
@Controller()
export class CampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly updates: CampaignUpdatesService,
  ) {}

  @Get('campaigns')
  @RequirePermissions('campaigns.read')
  @SerializeOptions({ schema: campaignPageSchema })
  @ApiOkResponse({
    description: 'Campaigns of the clients in scope; planned, active and paused by default',
    standardSchema: campaignPageSchema,
  })
  list(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: campaignListQuerySchema }) query: CampaignListQuery,
  ): Promise<CampaignPage> {
    return this.campaigns.list(actor, query);
  }

  @Post('campaigns')
  @RequirePermissions('campaigns.manage')
  @SerializeOptions({ schema: campaignDetailSchema })
  @ApiCreatedResponse({ description: 'The new campaign', standardSchema: campaignDetailSchema })
  create(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: createCampaignSchema }) input: CreateCampaign,
  ): Promise<CampaignDetail> {
    return this.campaigns.create(actor, input);
  }

  @Get('campaigns/:id')
  @RequirePermissions('campaigns.read')
  @SerializeOptions({ schema: campaignDetailSchema })
  @ApiOkResponse({
    description: 'A campaign with its totals, months and updates',
    standardSchema: campaignDetailSchema,
  })
  detail(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CampaignDetail> {
    return this.campaigns.detail(actor, id);
  }

  @Put('campaigns/:id')
  @RequirePermissions('campaigns.manage')
  @SerializeOptions({ schema: campaignDetailSchema })
  @ApiOkResponse({ description: 'The saved campaign', standardSchema: campaignDetailSchema })
  update(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateCampaignSchema }) input: UpdateCampaign,
  ): Promise<CampaignDetail> {
    return this.campaigns.update(actor, id, input);
  }

  @Post('campaigns/:id/status')
  @HttpCode(200)
  @RequirePermissions('campaigns.manage')
  @SerializeOptions({ schema: campaignDetailSchema })
  @ApiOkResponse({
    description: 'Start, pause, resume, complete, reopen or cancel',
    standardSchema: campaignDetailSchema,
  })
  changeStatus(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: campaignStatusChangeSchema }) input: CampaignStatusChange,
  ): Promise<CampaignDetail> {
    return this.campaigns.changeStatus(actor, id, input);
  }

  @Post('campaigns/:id/archive')
  @HttpCode(200)
  @RequirePermissions('campaigns.manage')
  @SerializeOptions({ schema: campaignDetailSchema })
  @ApiOkResponse({ description: 'The archived campaign', standardSchema: campaignDetailSchema })
  archive(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CampaignDetail> {
    return this.campaigns.archive(actor, id);
  }

  @Post('campaigns/:id/restore')
  @HttpCode(200)
  @RequirePermissions('campaigns.manage')
  @SerializeOptions({ schema: campaignDetailSchema })
  @ApiOkResponse({ description: 'The restored campaign', standardSchema: campaignDetailSchema })
  restore(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CampaignDetail> {
    return this.campaigns.restore(actor, id);
  }

  @Post('campaigns/:id/updates')
  @RequirePermissions('campaigns.manage')
  @SerializeOptions({ schema: campaignDetailSchema })
  @ApiCreatedResponse({
    description: 'The campaign with the new update',
    standardSchema: campaignDetailSchema,
  })
  addUpdate(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: campaignUpdateInputSchema }) input: CampaignUpdateInput,
  ): Promise<CampaignDetail> {
    return this.updates.add(actor, id, input);
  }

  @Patch('campaign-updates/:id')
  @RequirePermissions('campaigns.manage')
  @SerializeOptions({ schema: campaignDetailSchema })
  @ApiOkResponse({
    description: 'The campaign with the edited update',
    standardSchema: campaignDetailSchema,
  })
  patchUpdate(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: patchCampaignUpdateSchema }) input: PatchCampaignUpdate,
  ): Promise<CampaignDetail> {
    return this.updates.patch(actor, id, input);
  }

  @Post('campaign-updates/:id/archive')
  @HttpCode(200)
  @RequirePermissions('campaigns.manage')
  @SerializeOptions({ schema: campaignDetailSchema })
  @ApiOkResponse({
    description: 'The campaign without the archived update',
    standardSchema: campaignDetailSchema,
  })
  archiveUpdate(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CampaignDetail> {
    return this.updates.archive(actor, id);
  }
}
