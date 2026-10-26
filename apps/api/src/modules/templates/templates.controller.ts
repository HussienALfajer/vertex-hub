import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiForbiddenResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type CreateTemplate,
  createTemplateSchema,
  type TaskTemplateDraft,
  type TaskTemplateDraftInput,
  type TemplateDetail,
  type TemplateFromTask,
  type TemplateListQuery,
  type TemplatePage,
  taskTemplateDraftInputSchema,
  taskTemplateDraftSchema,
  templateDetailSchema,
  templateFromTaskSchema,
  templateListQuerySchema,
  templatePageSchema,
  type UpdateTemplate,
  updateTemplateSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { TemplatesService } from './templates.service.js';

@ApiTags('templates')
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  @RequirePermissions('templates.read')
  @SerializeOptions({ schema: templatePageSchema })
  @ApiOkResponse({
    description: 'Work templates; archived ones with `templates.manage` only',
    standardSchema: templatePageSchema,
  })
  list(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: templateListQuerySchema }) query: TemplateListQuery,
  ): Promise<TemplatePage> {
    return this.templates.list(actor, query);
  }

  @Get(':id')
  @RequirePermissions('templates.read')
  @SerializeOptions({ schema: templateDetailSchema })
  @ApiOkResponse({
    description: 'A template with its stages, steps and default assignees',
    standardSchema: templateDetailSchema,
  })
  detail(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TemplateDetail> {
    return this.templates.detail(actor, id);
  }

  @Post()
  @RequirePermissions('templates.manage')
  @SerializeOptions({ schema: templateDetailSchema })
  @ApiCreatedResponse({ description: 'The new template', standardSchema: templateDetailSchema })
  create(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: createTemplateSchema }) input: CreateTemplate,
  ): Promise<TemplateDetail> {
    return this.templates.create(actor, input);
  }

  @Post('from-task/:taskId')
  @RequirePermissions('tasks.manage')
  @SerializeOptions({ schema: templateDetailSchema })
  @ApiCreatedResponse({
    description:
      'A task template saved from a top-level task with its run mode, stages and subtasks (F06B rule D1); needs assign scope on the task',
    standardSchema: templateDetailSchema,
  })
  fromTask(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body({ schema: templateFromTaskSchema }) input: TemplateFromTask,
  ): Promise<TemplateDetail> {
    return this.templates.fromTask(actor, taskId, input);
  }

  @Post(':id/task-draft')
  @HttpCode(200)
  @RequirePermissions('templates.read')
  @SerializeOptions({ schema: taskTemplateDraftSchema })
  @ApiOkResponse({
    description:
      "A task template as the creation wizard's draft, dated from the start date in work days (F06B rule D2)",
    standardSchema: taskTemplateDraftSchema,
  })
  taskDraft(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: taskTemplateDraftInputSchema }) input: TaskTemplateDraftInput,
  ): Promise<TaskTemplateDraft> {
    return this.templates.taskDraft(actor, id, input);
  }

  @Put(':id')
  @RequirePermissions('templates.read')
  @ApiForbiddenResponse({
    description: '`templates.manage`, or the creator of a task template with assign scope in it',
  })
  @SerializeOptions({ schema: templateDetailSchema })
  @ApiOkResponse({
    description: 'The template after replacing its document; a `key` equal to an id keeps that row',
    standardSchema: templateDetailSchema,
  })
  update(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateTemplateSchema }) input: UpdateTemplate,
  ): Promise<TemplateDetail> {
    return this.templates.update(actor, id, input);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions('templates.read')
  @ApiForbiddenResponse({
    description: '`templates.manage`, or the creator of a task template with assign scope in it',
  })
  @SerializeOptions({ schema: templateDetailSchema })
  @ApiOkResponse({ description: 'The archived template', standardSchema: templateDetailSchema })
  archive(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TemplateDetail> {
    return this.templates.setArchived(actor, id, true);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermissions('templates.read')
  @ApiForbiddenResponse({
    description: '`templates.manage`, or the creator of a task template with assign scope in it',
  })
  @SerializeOptions({ schema: templateDetailSchema })
  @ApiOkResponse({ description: 'The restored template', standardSchema: templateDetailSchema })
  restore(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TemplateDetail> {
    return this.templates.setArchived(actor, id, false);
  }
}
