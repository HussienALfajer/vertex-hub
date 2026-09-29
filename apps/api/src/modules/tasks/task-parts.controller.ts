import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  SerializeOptions,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type CreateTaskChecklistItem,
  type CreateTaskLink,
  createTaskChecklistItemSchema,
  createTaskLinkSchema,
  type TaskChecklist,
  type TaskChecklistItem,
  type TaskChecklistOrder,
  type TaskLink,
  taskChecklistItemSchema,
  taskChecklistOrderSchema,
  taskChecklistSchema,
  taskLinkSchema,
  type UpdateTaskChecklistItem,
  updateTaskChecklistItemSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { TaskPartsService } from './task-parts.service.js';

/** Checklist and links: `tasks.work` or manage scope on the task, checked by the service. */
@ApiTags('tasks')
@Controller('tasks/:id')
export class TaskPartsController {
  constructor(private readonly parts: TaskPartsService) {}

  @Post('checklist')
  @RequirePermissions('tasks.read')
  @SerializeOptions({ schema: taskChecklistItemSchema })
  @ApiCreatedResponse({
    description:
      'The new checklist item, last in the list (assignee, department manager or manage scope)',
    standardSchema: taskChecklistItemSchema,
  })
  addChecklistItem(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) taskId: string,
    @Body({ schema: createTaskChecklistItemSchema }) input: CreateTaskChecklistItem,
  ): Promise<TaskChecklistItem> {
    return this.parts.addChecklistItem(actor, taskId, input);
  }

  @Put('checklist/order')
  @RequirePermissions('tasks.read')
  @SerializeOptions({ schema: taskChecklistSchema })
  @ApiOkResponse({
    description: 'The checklist in its new order',
    standardSchema: taskChecklistSchema,
  })
  reorderChecklist(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) taskId: string,
    @Body({ schema: taskChecklistOrderSchema }) order: TaskChecklistOrder,
  ): Promise<TaskChecklist> {
    return this.parts.reorderChecklist(actor, taskId, order);
  }

  @Patch('checklist/:itemId')
  @RequirePermissions('tasks.read')
  @SerializeOptions({ schema: taskChecklistItemSchema })
  @ApiOkResponse({
    description: 'The renamed, ticked or unticked item',
    standardSchema: taskChecklistItemSchema,
  })
  updateChecklistItem(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) taskId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body({ schema: updateTaskChecklistItemSchema }) input: UpdateTaskChecklistItem,
  ): Promise<TaskChecklistItem> {
    return this.parts.updateChecklistItem(actor, taskId, itemId, input);
  }

  @Post('checklist/:itemId/archive')
  @HttpCode(204)
  @RequirePermissions('tasks.read')
  @ApiNoContentResponse({ description: 'The item is removed from the checklist' })
  archiveChecklistItem(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) taskId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ): Promise<void> {
    return this.parts.archiveChecklistItem(actor, taskId, itemId);
  }

  @Post('links')
  @RequirePermissions('tasks.read')
  @SerializeOptions({ schema: taskLinkSchema })
  @ApiCreatedResponse({
    description: 'The new link (assignee, department manager or manage scope)',
    standardSchema: taskLinkSchema,
  })
  addLink(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) taskId: string,
    @Body({ schema: createTaskLinkSchema }) input: CreateTaskLink,
  ): Promise<TaskLink> {
    return this.parts.addLink(actor, taskId, input);
  }

  @Post('links/:linkId/archive')
  @HttpCode(204)
  @RequirePermissions('tasks.read')
  @ApiNoContentResponse({ description: 'The link is removed from the task' })
  archiveLink(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) taskId: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
  ): Promise<void> {
    return this.parts.archiveLink(actor, taskId, linkId);
  }
}
