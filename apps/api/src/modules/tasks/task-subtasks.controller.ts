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
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  type CreateSubtask,
  type CreateTaskStage,
  createSubtaskSchema,
  createTaskStageSchema,
  type HandoverNoteInput,
  handoverNoteInputSchema,
  type ReopenSubtasks,
  reopenSubtasksSchema,
  type SubtaskOrder,
  type SubtaskRunModeInput,
  subtaskOrderSchema,
  subtaskRunModeInputSchema,
  type TaskDetail,
  type TaskStage,
  type TaskSubtasks,
  taskDetailSchema,
  taskStageSchema,
  taskSubtasksSchema,
  type UpdateTaskStage,
  updateTaskStageSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { TaskSubtasksService } from './task-subtasks.service.js';

/**
 * Subtasks, stages and handovers (spec F06B part A). The parent's assignee holds these rights
 * without a permission of its own, so the routes ask for `tasks.read` and the service checks the
 * parent (manage scope, or its assignee).
 */
@ApiTags('tasks')
@Controller('tasks/:id')
export class TaskSubtasksController {
  constructor(private readonly subtasks: TaskSubtasksService) {}

  @Post('subtasks')
  @RequirePermissions('tasks.read')
  @SerializeOptions({ schema: taskDetailSchema })
  @ApiCreatedResponse({
    description:
      'The new subtask (manage scope on the parent or its assignee); an assignee needs assign scope, or is the caller in their own department',
    standardSchema: taskDetailSchema,
  })
  @ApiNotFoundResponse({ description: 'No task the caller may read' })
  add(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: createSubtaskSchema }) input: CreateSubtask,
  ): Promise<TaskDetail> {
    return this.subtasks.add(actor, id, input);
  }

  @Put('subtasks/order')
  @RequirePermissions('tasks.read')
  @SerializeOptions({ schema: taskSubtasksSchema })
  @ApiOkResponse({
    description: 'The run mode, stages and subtasks in their new order (rule A4)',
    standardSchema: taskSubtasksSchema,
  })
  order(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: subtaskOrderSchema }) input: SubtaskOrder,
  ): Promise<TaskSubtasks> {
    return this.subtasks.order(actor, id, input);
  }

  @Post('subtasks/reopen')
  @HttpCode(200)
  @RequirePermissions('tasks.read')
  @SerializeOptions({ schema: taskDetailSchema })
  @ApiOkResponse({
    description: 'The parent after chosen delivered subtasks went back to work (rule A10)',
    standardSchema: taskDetailSchema,
  })
  reopen(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: reopenSubtasksSchema }) input: ReopenSubtasks,
  ): Promise<TaskDetail> {
    return this.subtasks.reopen(actor, id, input);
  }

  @Put('run-mode')
  @RequirePermissions('tasks.read')
  @SerializeOptions({ schema: taskSubtasksSchema })
  @ApiOkResponse({
    description: 'The run mode, stages and subtasks after the change (rule A4)',
    standardSchema: taskSubtasksSchema,
  })
  setRunMode(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: subtaskRunModeInputSchema }) input: SubtaskRunModeInput,
  ): Promise<TaskSubtasks> {
    return this.subtasks.setRunMode(actor, id, input);
  }

  @Post('stages')
  @RequirePermissions('tasks.read')
  @SerializeOptions({ schema: taskStageSchema })
  @ApiCreatedResponse({ description: 'The new stage', standardSchema: taskStageSchema })
  createStage(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: createTaskStageSchema }) input: CreateTaskStage,
  ): Promise<TaskStage> {
    return this.subtasks.createStage(actor, id, input);
  }

  @Patch('stages/:stageId')
  @RequirePermissions('tasks.read')
  @SerializeOptions({ schema: taskStageSchema })
  @ApiOkResponse({ description: 'The renamed or moved stage', standardSchema: taskStageSchema })
  updateStage(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stageId', ParseUUIDPipe) stageId: string,
    @Body({ schema: updateTaskStageSchema }) input: UpdateTaskStage,
  ): Promise<TaskStage> {
    return this.subtasks.updateStage(actor, id, stageId, input);
  }

  @Post('stages/:stageId/archive')
  @HttpCode(204)
  @RequirePermissions('tasks.read')
  @ApiNoContentResponse({ description: 'The stage is removed; only an empty stage is' })
  archiveStage(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stageId', ParseUUIDPipe) stageId: string,
  ): Promise<void> {
    return this.subtasks.archiveStage(actor, id, stageId);
  }

  @Put('handover-note')
  @RequirePermissions('tasks.work')
  @SerializeOptions({ schema: taskDetailSchema })
  @ApiOkResponse({
    description: 'The subtask with its handover note (its assignee or department managers)',
    standardSchema: taskDetailSchema,
  })
  setHandoverNote(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: handoverNoteInputSchema }) input: HandoverNoteInput,
  ): Promise<TaskDetail> {
    return this.subtasks.setHandoverNote(actor, id, input);
  }
}
