import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type TemplateRun,
  type TemplateRunInput,
  type TemplateRunListQuery,
  type TemplateRunPage,
  type TemplateRunPlanResponse,
  templateRunInputSchema,
  templateRunListQuerySchema,
  templateRunPageSchema,
  templateRunPlanSchema,
  templateRunSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { TemplateRunsService } from './template-runs.service.js';

/** Applying a template to a project or a retainer cycle, and the run history (F07). */
@ApiTags('templates')
@Controller()
export class TemplateRunsController {
  constructor(private readonly runs: TemplateRunsService) {}

  @Post('templates/:id/preview')
  @HttpCode(200)
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: templateRunPlanSchema })
  @ApiOkResponse({
    description: 'The tasks and milestones a run would create; nothing is written',
    standardSchema: templateRunPlanSchema,
  })
  preview(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: templateRunInputSchema }) input: TemplateRunInput,
  ): Promise<TemplateRunPlanResponse> {
    return this.runs.preview(actor, id, input);
  }

  @Post('templates/:id/runs')
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: templateRunSchema })
  @ApiCreatedResponse({
    description: "The run; the project's or cycle's tasks are created",
    standardSchema: templateRunSchema,
  })
  apply(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: templateRunInputSchema }) input: TemplateRunInput,
  ): Promise<TemplateRun> {
    return this.runs.apply(actor, id, input);
  }

  @Get('template-runs')
  @RequirePermissions('projects.read')
  @SerializeOptions({ schema: templateRunPageSchema })
  @ApiOkResponse({
    description: 'Runs of a project, a retainer or the run that created a task, newest first',
    standardSchema: templateRunPageSchema,
  })
  list(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: templateRunListQuerySchema }) query: TemplateRunListQuery,
  ): Promise<TemplateRunPage> {
    return this.runs.list(actor, query);
  }
}
