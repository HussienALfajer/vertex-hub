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
  SerializeOptions,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type ConvertLead,
  type CreateLead,
  type CreateLeadNote,
  convertLeadSchema,
  createLeadNoteSchema,
  createLeadSchema,
  type LeadBoard,
  type LeadBoardQuery,
  type LeadConversionPlan,
  type LeadConversionPlanQuery,
  type LeadDetail,
  type LeadDuplicateQuery,
  type LeadDuplicates,
  type LeadInterestOptions,
  type LeadListQuery,
  type LeadNote,
  type LeadOwnerChange,
  type LeadOwnerOptions,
  type LeadPage,
  type LeadStageChange,
  type LoseLead,
  type LoseLeadResult,
  leadBoardQuerySchema,
  leadBoardSchema,
  leadConversionPlanQuerySchema,
  leadConversionPlanSchema,
  leadDetailSchema,
  leadDuplicateQuerySchema,
  leadDuplicatesSchema,
  leadInterestOptionsSchema,
  leadListQuerySchema,
  leadNoteSchema,
  leadOwnerChangeSchema,
  leadOwnerOptionsSchema,
  leadPageSchema,
  leadStageChangeSchema,
  loseLeadResultSchema,
  loseLeadSchema,
  type ReopenLead,
  reopenLeadSchema,
  type UpdateLead,
  type UpdateLeadNote,
  updateLeadNoteSchema,
  updateLeadSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { LeadConversionService } from './lead-conversion.service.js';
import { LeadNotesService } from './lead-notes.service.js';
import { LeadPipelineService } from './lead-pipeline.service.js';
import { LeadsService } from './leads.service.js';

@ApiTags('leads')
@Controller('leads')
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly pipeline: LeadPipelineService,
    private readonly notes: LeadNotesService,
    private readonly conversion: LeadConversionService,
  ) {}

  @Get()
  @RequirePermissions('leads.read')
  @SerializeOptions({ schema: leadPageSchema })
  @ApiOkResponse({
    description: 'Leads in scope; open, non-archived leads by next follow-up date by default',
    standardSchema: leadPageSchema,
  })
  list(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: leadListQuerySchema }) query: LeadListQuery,
  ): Promise<LeadPage> {
    return this.leads.list(actor, query);
  }

  @Get('board')
  @RequirePermissions('leads.read')
  @SerializeOptions({ schema: leadBoardSchema })
  @ApiOkResponse({ description: 'The pipeline board', standardSchema: leadBoardSchema })
  board(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: leadBoardQuerySchema }) query: LeadBoardQuery,
  ): Promise<LeadBoard> {
    return this.leads.board(actor, query);
  }

  @Get('owners')
  @RequirePermissions('leads.manage')
  @SerializeOptions({ schema: leadOwnerOptionsSchema })
  @ApiOkResponse({ description: 'Users who may own leads', standardSchema: leadOwnerOptionsSchema })
  owners(): Promise<LeadOwnerOptions> {
    return this.leads.owners();
  }

  @Get('interest-options')
  @RequirePermissions('leads.manage')
  @SerializeOptions({ schema: leadInterestOptionsSchema })
  @ApiOkResponse({
    description: 'Services and packages a lead may ask for',
    standardSchema: leadInterestOptionsSchema,
  })
  interestOptions(): Promise<LeadInterestOptions> {
    return this.leads.interestOptions();
  }

  @Post('duplicates')
  @HttpCode(200)
  @RequirePermissions('leads.read')
  @SerializeOptions({ schema: leadDuplicatesSchema })
  @ApiOkResponse({
    description: 'Open leads and clients that look like the same person (a warning only)',
    standardSchema: leadDuplicatesSchema,
  })
  duplicates(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: leadDuplicateQuerySchema }) query: LeadDuplicateQuery,
  ): Promise<LeadDuplicates> {
    return this.leads.duplicates(actor, query);
  }

  @Post()
  @RequirePermissions('leads.manage')
  @SerializeOptions({ schema: leadDetailSchema })
  @ApiCreatedResponse({ description: 'The new lead', standardSchema: leadDetailSchema })
  create(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: createLeadSchema }) input: CreateLead,
  ): Promise<LeadDetail> {
    return this.leads.create(actor, input);
  }

  @Get(':id')
  @RequirePermissions('leads.read')
  @SerializeOptions({ schema: leadDetailSchema })
  @ApiOkResponse({
    description: 'A lead with its interests and activity log',
    standardSchema: leadDetailSchema,
  })
  detail(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LeadDetail> {
    return this.leads.detail(actor, id);
  }

  @Patch(':id')
  @RequirePermissions('leads.manage')
  @SerializeOptions({ schema: leadDetailSchema })
  @ApiOkResponse({ description: 'The saved lead', standardSchema: leadDetailSchema })
  update(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateLeadSchema }) input: UpdateLead,
  ): Promise<LeadDetail> {
    return this.leads.update(actor, id, input);
  }

  @Post(':id/stage')
  @HttpCode(200)
  @RequirePermissions('leads.manage')
  @SerializeOptions({ schema: leadDetailSchema })
  @ApiOkResponse({
    description: 'Moved among New, Contacted and Meeting',
    standardSchema: leadDetailSchema,
  })
  changeStage(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: leadStageChangeSchema }) input: LeadStageChange,
  ): Promise<LeadDetail> {
    return this.pipeline.changeStage(actor, id, input);
  }

  @Post(':id/owner')
  @HttpCode(200)
  @RequirePermissions('leads.manage')
  @SerializeOptions({ schema: leadDetailSchema })
  @ApiOkResponse({ description: 'The lead with its new owner', standardSchema: leadDetailSchema })
  changeOwner(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: leadOwnerChangeSchema }) input: LeadOwnerChange,
  ): Promise<LeadDetail> {
    return this.pipeline.changeOwner(actor, id, input);
  }

  @Post(':id/lose')
  @HttpCode(200)
  @RequirePermissions('leads.manage')
  @SerializeOptions({ schema: loseLeadResultSchema })
  @ApiOkResponse({
    description: 'The lost lead and the quotes the loss rejected',
    standardSchema: loseLeadResultSchema,
  })
  lose(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: loseLeadSchema }) input: LoseLead,
  ): Promise<LoseLeadResult> {
    return this.pipeline.lose(actor, id, input);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  @RequirePermissions('leads.manage')
  @SerializeOptions({ schema: leadDetailSchema })
  @ApiOkResponse({ description: 'The reopened lead', standardSchema: leadDetailSchema })
  reopen(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: reopenLeadSchema }) input: ReopenLead,
  ): Promise<LeadDetail> {
    return this.pipeline.reopen(actor, id, input);
  }

  @Get(':id/conversion-plan')
  @RequirePermissions('leads.manage')
  @SerializeOptions({ schema: leadConversionPlanSchema })
  @ApiOkResponse({
    description: 'The convert dialog: new-client defaults, or the existing client with clientId',
    standardSchema: leadConversionPlanSchema,
  })
  conversionPlan(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Query({ schema: leadConversionPlanQuerySchema }) query: LeadConversionPlanQuery,
  ): Promise<LeadConversionPlan> {
    return this.conversion.planFor(actor, id, query);
  }

  @Post(':id/convert')
  @HttpCode(200)
  @RequirePermissions('leads.manage')
  @SerializeOptions({ schema: leadDetailSchema })
  @ApiOkResponse({
    description: 'The won lead, linked to its new or existing client',
    standardSchema: leadDetailSchema,
  })
  convert(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: convertLeadSchema }) input: ConvertLead,
  ): Promise<LeadDetail> {
    return this.conversion.convertFor(actor, id, input);
  }

  @Post(':id/archive')
  @HttpCode(204)
  @RequirePermissions('leads.manage')
  @ApiNoContentResponse({ description: 'Archived (scope all)' })
  archive(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.pipeline.archive(actor, id);
  }

  @Post(':id/restore')
  @HttpCode(204)
  @RequirePermissions('leads.manage')
  @ApiNoContentResponse({ description: 'Restored (scope all)' })
  restore(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.pipeline.restore(actor, id);
  }

  @Post(':id/notes')
  @RequirePermissions('leads.manage')
  @SerializeOptions({ schema: leadNoteSchema })
  @ApiCreatedResponse({
    description: 'The logged activity; the lead gets its new follow-up date',
    standardSchema: leadNoteSchema,
  })
  createNote(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: createLeadNoteSchema }) input: CreateLeadNote,
  ): Promise<LeadNote> {
    return this.notes.create(actor, id, input);
  }

  @Patch(':id/notes/:noteId')
  @RequirePermissions('leads.manage')
  @SerializeOptions({ schema: leadNoteSchema })
  @ApiOkResponse({
    description: 'The edited activity (its author)',
    standardSchema: leadNoteSchema,
  })
  updateNote(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body({ schema: updateLeadNoteSchema }) input: UpdateLeadNote,
  ): Promise<LeadNote> {
    return this.notes.update(actor, id, noteId, input);
  }

  @Post(':id/notes/:noteId/archive')
  @HttpCode(204)
  @RequirePermissions('leads.manage')
  @ApiNoContentResponse({ description: 'Archived (its author or scope all)' })
  archiveNote(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
  ): Promise<void> {
    return this.notes.archive(actor, id, noteId);
  }
}
