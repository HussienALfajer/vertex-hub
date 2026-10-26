import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  type ClientContentSettings,
  type ConfirmOccasionDate,
  type ContentAgencySettings,
  type ContentGrid,
  type ContentGridQuery,
  type ContentIdea,
  type ContentIdeaListQuery,
  type ContentIdeaPage,
  type ContentOccasion,
  type ContentOccasionList,
  type ContentOccasionListQuery,
  type ContentPillar,
  type ContentPillarList,
  type ContentPillarOrder,
  type ContentPlanning,
  type ContentPlanningQuery,
  type ContentSnippet,
  type ContentSnippetList,
  type ContentSnippetListQuery,
  type CreateContentIdea,
  type CreateContentOccasion,
  type CreateContentPillar,
  type CreateContentSnippet,
  clientContentSettingsSchema,
  confirmOccasionDateSchema,
  contentAgencySettingsSchema,
  contentGridQuerySchema,
  contentGridSchema,
  contentIdeaListQuerySchema,
  contentIdeaPageSchema,
  contentIdeaSchema,
  contentOccasionListQuerySchema,
  contentOccasionListSchema,
  contentOccasionSchema,
  contentPillarListSchema,
  contentPillarOrderSchema,
  contentPillarSchema,
  contentPlanningQuerySchema,
  contentPlanningSchema,
  contentSnippetListQuerySchema,
  contentSnippetListSchema,
  contentSnippetSchema,
  createContentIdeaSchema,
  createContentOccasionSchema,
  createContentPillarSchema,
  createContentSnippetSchema,
  type DropContentIdea,
  dropContentIdeaSchema,
  type OccasionSkip,
  occasionSkipSchema,
  type UpdateClientContentSettings,
  type UpdateContentAgencySettings,
  type UpdateContentIdea,
  type UpdateContentOccasion,
  type UpdateContentPillar,
  type UpdateContentSnippet,
  updateClientContentSettingsSchema,
  updateContentAgencySettingsSchema,
  updateContentIdeaSchema,
  updateContentOccasionSchema,
  updateContentPillarSchema,
  updateContentSnippetSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { ContentIdeasService } from './content-ideas.service.js';
import { ContentOccasionsService } from './content-occasions.service.js';
import { ContentPlanner } from './content-planner.js';
import { ContentSettingsService } from './content-settings.service.js';

/**
 * The planning aids of the content calendar (spec F08B part C): settings and best times,
 * pillars, occasions, snippets, ideas, the Planning check and the Instagram grid. Every user
 * reads them; who changes what is checked per record (spec F08B "Roles and access").
 */
@ApiTags('content')
@Controller('content')
export class ContentPlanningController {
  constructor(
    private readonly settings: ContentSettingsService,
    private readonly occasions: ContentOccasionsService,
    private readonly ideas: ContentIdeasService,
    private readonly planner: ContentPlanner,
  ) {}

  // Settings

  @Get('settings')
  @RequirePermissions('content.read')
  @SerializeOptions({ schema: contentAgencySettingsSchema })
  @ApiOkResponse({
    description: "The agency's default best publishing times",
    standardSchema: contentAgencySettingsSchema,
  })
  agencySettings(): Promise<ContentAgencySettings> {
    return this.settings.agencySettings();
  }

  @Put('settings')
  @RequirePermissions('content.review')
  @SerializeOptions({ schema: contentAgencySettingsSchema })
  @ApiOkResponse({
    description: 'Saved (`content.review` over all posts)',
    standardSchema: contentAgencySettingsSchema,
  })
  updateAgencySettings(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: updateContentAgencySettingsSchema }) input: UpdateContentAgencySettings,
  ): Promise<ContentAgencySettings> {
    return this.settings.updateAgencySettings(actor, input);
  }

  @Get('clients/:clientId/settings')
  @RequirePermissions('content.read')
  @SerializeOptions({ schema: clientContentSettingsSchema })
  @ApiOkResponse({
    description: "The client's content settings, the defaults while none are saved",
    standardSchema: clientContentSettingsSchema,
  })
  clientSettings(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('clientId', ParseUUIDPipe) clientId: string,
  ): Promise<ClientContentSettings> {
    return this.settings.clientSettings(actor, clientId);
  }

  @Put('clients/:clientId/settings')
  @RequirePermissions('content.manage')
  @SerializeOptions({ schema: clientContentSettingsSchema })
  @ApiOkResponse({
    description: 'Saved (`content.manage` covering the client)',
    standardSchema: clientContentSettingsSchema,
  })
  @ApiBadRequestResponse({ description: '`INVALID_TARGETS`, `INVALID_LINK`' })
  updateClientSettings(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body({ schema: updateClientContentSettingsSchema }) input: UpdateClientContentSettings,
  ): Promise<ClientContentSettings> {
    return this.settings.updateClientSettings(actor, clientId, input);
  }

  @Post('clients/:clientId/occasion-skips')
  @HttpCode(200)
  @RequirePermissions('content.manage')
  @SerializeOptions({ schema: clientContentSettingsSchema })
  @ApiOkResponse({
    description: '"No post this year" for the occasion (rule C6)',
    standardSchema: clientContentSettingsSchema,
  })
  skipOccasion(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body({ schema: occasionSkipSchema }) input: OccasionSkip,
  ): Promise<ClientContentSettings> {
    return this.settings.skipOccasion(actor, clientId, input, true);
  }

  @Delete('clients/:clientId/occasion-skips/:occasionId/:year')
  @RequirePermissions('content.manage')
  @SerializeOptions({ schema: clientContentSettingsSchema })
  @ApiOkResponse({ description: 'The skip removed', standardSchema: clientContentSettingsSchema })
  unskipOccasion(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('occasionId', ParseUUIDPipe) occasionId: string,
    @Param('year', ParseIntPipe) year: number,
  ): Promise<ClientContentSettings> {
    return this.settings.skipOccasion(actor, clientId, { occasionId, year }, false);
  }

  // Pillars

  @Get('pillars')
  @RequirePermissions('content.read')
  @SerializeOptions({ schema: contentPillarListSchema })
  @ApiOkResponse({ description: 'Every pillar', standardSchema: contentPillarListSchema })
  pillars(): Promise<ContentPillarList> {
    return this.settings.pillars();
  }

  @Post('pillars')
  @RequirePermissions('content.review')
  @SerializeOptions({ schema: contentPillarSchema })
  @ApiCreatedResponse({ description: 'Added at the end', standardSchema: contentPillarSchema })
  @ApiConflictResponse({ description: '`LIMIT_REACHED` (10), `NAME_TAKEN`' })
  createPillar(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: createContentPillarSchema }) input: CreateContentPillar,
  ): Promise<ContentPillar> {
    return this.settings.createPillar(actor, input);
  }

  @Put('pillars/order')
  @RequirePermissions('content.review')
  @SerializeOptions({ schema: contentPillarListSchema })
  @ApiOkResponse({
    description: 'The pillars in the new order',
    standardSchema: contentPillarListSchema,
  })
  @ApiBadRequestResponse({ description: '`INVALID_ORDER`' })
  orderPillars(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: contentPillarOrderSchema }) input: ContentPillarOrder,
  ): Promise<ContentPillarList> {
    return this.settings.orderPillars(actor, input);
  }

  @Patch('pillars/:id')
  @RequirePermissions('content.review')
  @SerializeOptions({ schema: contentPillarSchema })
  @ApiOkResponse({ description: 'Renamed or recoloured', standardSchema: contentPillarSchema })
  @ApiConflictResponse({ description: '`NAME_TAKEN`' })
  updatePillar(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateContentPillarSchema }) input: UpdateContentPillar,
  ): Promise<ContentPillar> {
    return this.settings.updatePillar(actor, id, input);
  }

  @Post('pillars/:id/archive')
  @HttpCode(200)
  @RequirePermissions('content.review')
  @SerializeOptions({ schema: contentPillarSchema })
  @ApiOkResponse({
    description: 'No longer offered; posts keep it',
    standardSchema: contentPillarSchema,
  })
  archivePillar(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ContentPillar> {
    return this.settings.archivePillar(actor, id);
  }

  @Post('pillars/:id/restore')
  @HttpCode(200)
  @RequirePermissions('content.review')
  @SerializeOptions({ schema: contentPillarSchema })
  @ApiOkResponse({ description: 'Offered again, at the end', standardSchema: contentPillarSchema })
  @ApiConflictResponse({ description: '`LIMIT_REACHED`, `NAME_TAKEN`' })
  restorePillar(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ContentPillar> {
    return this.settings.restorePillar(actor, id);
  }

  // Occasions

  @Get('occasions')
  @RequirePermissions('content.read')
  @SerializeOptions({ schema: contentOccasionListSchema })
  @ApiOkResponse({
    description: 'Occasions with their dates in the range (with `clientId`, those applying to it)',
    standardSchema: contentOccasionListSchema,
  })
  listOccasions(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: contentOccasionListQuerySchema }) query: ContentOccasionListQuery,
  ): Promise<ContentOccasionList> {
    return this.occasions.list(actor, query);
  }

  @Post('occasions')
  @RequirePermissions('content.manage')
  @SerializeOptions({ schema: contentOccasionSchema })
  @ApiCreatedResponse({
    description:
      'An agency occasion (`content.review` over all posts), or a client’s own (`content.manage` covering it)',
    standardSchema: contentOccasionSchema,
  })
  @ApiBadRequestResponse({ description: '`INVALID_DATES`, `INVALID_LINK`' })
  createOccasion(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: createContentOccasionSchema }) input: CreateContentOccasion,
  ): Promise<ContentOccasion> {
    return this.occasions.create(actor, input);
  }

  @Patch('occasions/:id')
  @RequirePermissions('content.manage')
  @SerializeOptions({ schema: contentOccasionSchema })
  @ApiOkResponse({ description: 'The occasion', standardSchema: contentOccasionSchema })
  @ApiBadRequestResponse({ description: '`INVALID_DATES`' })
  updateOccasion(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateContentOccasionSchema }) input: UpdateContentOccasion,
  ): Promise<ContentOccasion> {
    return this.occasions.update(actor, id, input);
  }

  @Post('occasions/:id/archive')
  @HttpCode(200)
  @RequirePermissions('content.manage')
  @SerializeOptions({ schema: contentOccasionSchema })
  @ApiOkResponse({
    description: 'No longer shown or checked',
    standardSchema: contentOccasionSchema,
  })
  archiveOccasion(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ContentOccasion> {
    return this.occasions.setArchived(actor, id, true);
  }

  @Post('occasions/:id/restore')
  @HttpCode(200)
  @RequirePermissions('content.manage')
  @SerializeOptions({ schema: contentOccasionSchema })
  @ApiOkResponse({ description: 'Shown again', standardSchema: contentOccasionSchema })
  restoreOccasion(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ContentOccasion> {
    return this.occasions.setArchived(actor, id, false);
  }

  @Put('occasions/:id/dates/:year')
  @RequirePermissions('content.review')
  @SerializeOptions({ schema: contentOccasionSchema })
  @ApiOkResponse({
    description: "The year's start confirmed, replacing the computed one (rule C5)",
    standardSchema: contentOccasionSchema,
  })
  @ApiBadRequestResponse({ description: '`INVALID_DATES`' })
  confirmOccasionDate(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('year', ParseIntPipe) year: number,
    @Body({ schema: confirmOccasionDateSchema }) input: ConfirmOccasionDate,
  ): Promise<ContentOccasion> {
    return this.occasions.confirmDate(actor, id, year, input);
  }

  @Delete('occasions/:id/dates/:year')
  @RequirePermissions('content.review')
  @SerializeOptions({ schema: contentOccasionSchema })
  @ApiOkResponse({
    description: 'Back to the computed start',
    standardSchema: contentOccasionSchema,
  })
  clearOccasionDate(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('year', ParseIntPipe) year: number,
  ): Promise<ContentOccasion> {
    return this.occasions.clearDate(actor, id, year);
  }

  // Snippets

  @Get('snippets')
  @RequirePermissions('content.read')
  @SerializeOptions({ schema: contentSnippetListSchema })
  @ApiOkResponse({
    description: "The client's snippets and the agency's",
    standardSchema: contentSnippetListSchema,
  })
  snippets(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: contentSnippetListQuerySchema }) query: ContentSnippetListQuery,
  ): Promise<ContentSnippetList> {
    return this.settings.snippets(actor, query);
  }

  @Post('snippets')
  @RequirePermissions('content.manage')
  @SerializeOptions({ schema: contentSnippetSchema })
  @ApiCreatedResponse({
    description:
      "A client's snippet (`content.manage` covering it) or the agency's (`content.review` over all posts)",
    standardSchema: contentSnippetSchema,
  })
  @ApiConflictResponse({ description: '`LIMIT_REACHED` (50 per kind)' })
  createSnippet(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: createContentSnippetSchema }) input: CreateContentSnippet,
  ): Promise<ContentSnippet> {
    return this.settings.createSnippet(actor, input);
  }

  @Patch('snippets/:id')
  @RequirePermissions('content.manage')
  @SerializeOptions({ schema: contentSnippetSchema })
  @ApiOkResponse({ description: 'The snippet', standardSchema: contentSnippetSchema })
  updateSnippet(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateContentSnippetSchema }) input: UpdateContentSnippet,
  ): Promise<ContentSnippet> {
    return this.settings.updateSnippet(actor, id, input);
  }

  @Post('snippets/:id/archive')
  @HttpCode(204)
  @RequirePermissions('content.manage')
  @ApiNoContentResponse({ description: 'Removed from the pickers' })
  archiveSnippet(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.settings.archiveSnippet(actor, id);
  }

  // Ideas

  @Get('ideas')
  @RequirePermissions('content.read')
  @SerializeOptions({ schema: contentIdeaPageSchema })
  @ApiOkResponse({ description: 'Ideas, newest first', standardSchema: contentIdeaPageSchema })
  listIdeas(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: contentIdeaListQuerySchema }) query: ContentIdeaListQuery,
  ): Promise<ContentIdeaPage> {
    return this.ideas.list(actor, query);
  }

  @Post('ideas')
  @RequirePermissions('content.suggest')
  @SerializeOptions({ schema: contentIdeaSchema })
  @ApiCreatedResponse({ description: 'The idea, open', standardSchema: contentIdeaSchema })
  @ApiBadRequestResponse({ description: '`INVALID_LINK`' })
  @ApiConflictResponse({ description: '`CLIENT_ARCHIVED`' })
  createIdea(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: createContentIdeaSchema }) input: CreateContentIdea,
  ): Promise<ContentIdea> {
    return this.ideas.create(actor, input);
  }

  @Patch('ideas/:id')
  @RequirePermissions('content.suggest')
  @SerializeOptions({ schema: contentIdeaSchema })
  @ApiOkResponse({
    description: 'Edited by its author while open, or by edit scope on its client',
    standardSchema: contentIdeaSchema,
  })
  @ApiConflictResponse({ description: '`IDEA_USED`' })
  updateIdea(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateContentIdeaSchema }) input: UpdateContentIdea,
  ): Promise<ContentIdea> {
    return this.ideas.update(actor, id, input);
  }

  @Post('ideas/:id/drop')
  @HttpCode(200)
  @RequirePermissions('content.suggest')
  @SerializeOptions({ schema: contentIdeaSchema })
  @ApiOkResponse({ description: 'Dropped', standardSchema: contentIdeaSchema })
  @ApiConflictResponse({ description: '`IDEA_USED`' })
  dropIdea(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: dropContentIdeaSchema }) input: DropContentIdea,
  ): Promise<ContentIdea> {
    return this.ideas.drop(actor, id, input);
  }

  @Post('ideas/:id/restore')
  @HttpCode(200)
  @RequirePermissions('content.manage')
  @SerializeOptions({ schema: contentIdeaSchema })
  @ApiOkResponse({ description: 'Open again', standardSchema: contentIdeaSchema })
  restoreIdea(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ContentIdea> {
    return this.ideas.restore(actor, id);
  }

  // Planning

  @Get('planning')
  @RequirePermissions('content.read')
  @SerializeOptions({ schema: contentPlanningSchema })
  @ApiOkResponse({
    description:
      'Per client with an open content cycle or settings: the issues of the range (at most 45 days), the pillar balance of its first month and the commitments',
    standardSchema: contentPlanningSchema,
  })
  planning(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: contentPlanningQuerySchema }) query: ContentPlanningQuery,
  ): Promise<ContentPlanning> {
    return this.planner.planning(actor, query);
  }

  @Get('grid')
  @RequirePermissions('content.read')
  @SerializeOptions({ schema: contentGridSchema })
  @ApiOkResponse({
    description: "The client's Instagram feed posts of the month and the two before, newest first",
    standardSchema: contentGridSchema,
  })
  grid(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: contentGridQuerySchema }) query: ContentGridQuery,
  ): Promise<ContentGrid> {
    return this.planner.grid(actor, query);
  }
}
