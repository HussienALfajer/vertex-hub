import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  SerializeOptions,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type RetainerTemplate,
  retainerTemplateSchema,
  type SetRetainerTemplate,
  setRetainerTemplateSchema,
  type TemplateRun,
  templateRunSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { TemplateRunsService } from './template-runs.service.js';

/** A retainer's monthly template and its current cycle's generated tasks (F07 rules 16–19). */
@ApiTags('templates')
@Controller('retainers')
export class RetainerTemplatesController {
  constructor(private readonly runs: TemplateRunsService) {}

  @Get(':id/template')
  @RequirePermissions('projects.read')
  @SerializeOptions({ schema: retainerTemplateSchema })
  @ApiOkResponse({
    description: "The linked monthly template, the current cycle's run and its lines' tasks",
    standardSchema: retainerTemplateSchema,
  })
  get(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RetainerTemplate> {
    return this.runs.retainerTemplate(actor, id);
  }

  @Put(':id/template')
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: retainerTemplateSchema })
  @ApiOkResponse({
    description: 'Links or unlinks the monthly template; it applies from the next cycle',
    standardSchema: retainerTemplateSchema,
  })
  set(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: setRetainerTemplateSchema }) input: SetRetainerTemplate,
  ): Promise<RetainerTemplate> {
    return this.runs.setRetainerTemplate(actor, id, input);
  }

  @Post(':id/cycles/:cycleId/lines/:lineId/missing-tasks')
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: templateRunSchema })
  @ApiCreatedResponse({
    description:
      "Tasks for the units of the line that have none, from the template's repeated step",
    standardSchema: templateRunSchema,
  })
  generateMissing(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
  ): Promise<TemplateRun> {
    return this.runs.generateMissing(actor, id, cycleId, lineId);
  }
}
