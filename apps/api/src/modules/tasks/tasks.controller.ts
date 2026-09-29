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
  type CreateTask,
  createTaskSchema,
  type RevisionDecisionInput,
  revisionDecisionInputSchema,
  type TaskDependenciesInput,
  type TaskDependencyList,
  type TaskDetail,
  type TaskListQuery,
  type TaskPage,
  type TaskRevision,
  type TaskStatusChange,
  taskDependenciesInputSchema,
  taskDependencyListSchema,
  taskDetailSchema,
  taskListQuerySchema,
  taskPageSchema,
  taskRevisionSchema,
  taskStatusChangeSchema,
  type UpdateTask,
  updateTaskSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { TaskWorkflowService } from './task-workflow.service.js';
import { TasksService } from './tasks.service.js';

@ApiTags('tasks')
@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly workflow: TaskWorkflowService,
  ) {}

  @Get()
  @RequirePermissions('tasks.read')
  @SerializeOptions({ schema: taskPageSchema })
  @ApiOkResponse({
    description: 'Tasks; open ones by due date by default',
    standardSchema: taskPageSchema,
  })
  list(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: taskListQuerySchema }) query: TaskListQuery,
  ): Promise<TaskPage> {
    return this.tasks.list(actor, query);
  }

  @Get(':id')
  @RequirePermissions('tasks.read')
  @SerializeOptions({ schema: taskDetailSchema })
  @ApiOkResponse({
    description: 'A task with its dependencies, checklist, links and revisions',
    standardSchema: taskDetailSchema,
  })
  detail(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TaskDetail> {
    return this.tasks.detail(actor, id);
  }

  @Post()
  @RequirePermissions('tasks.request')
  @SerializeOptions({ schema: taskDetailSchema })
  @ApiCreatedResponse({
    description:
      'The new task: unassigned or assigned to oneself for anyone; any assignee with assign scope; client requests with client scope',
    standardSchema: taskDetailSchema,
  })
  create(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: createTaskSchema }) input: CreateTask,
  ): Promise<TaskDetail> {
    return this.tasks.create(actor, input);
  }

  @Patch(':id')
  @RequirePermissions('tasks.request')
  @SerializeOptions({ schema: taskDetailSchema })
  @ApiOkResponse({
    description:
      'The updated task (manage scope, or the creator of an unassigned new request); assignee and department need assign scope, the request scope client scope',
    standardSchema: taskDetailSchema,
  })
  update(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateTaskSchema }) input: UpdateTask,
  ): Promise<TaskDetail> {
    return this.tasks.update(actor, id, input);
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequirePermissions('tasks.read')
  @SerializeOptions({ schema: taskDetailSchema })
  @ApiOkResponse({
    description: 'The task after the move; each move has its roles (spec F06, rule 1)',
    standardSchema: taskDetailSchema,
  })
  changeStatus(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: taskStatusChangeSchema }) change: TaskStatusChange,
  ): Promise<TaskDetail> {
    return this.workflow.changeStatus(actor, id, change);
  }

  @Put(':id/dependencies')
  @RequirePermissions('tasks.manage')
  @SerializeOptions({ schema: taskDependencyListSchema })
  @ApiOkResponse({
    description: 'The tasks this task waits on (manage scope)',
    standardSchema: taskDependencyListSchema,
  })
  setDependencies(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: taskDependenciesInputSchema }) input: TaskDependenciesInput,
  ): Promise<TaskDependencyList> {
    return this.workflow.setDependencies(actor, id, input);
  }

  @Post(':id/revisions/:revisionId/decision')
  @HttpCode(200)
  @RequirePermissions('tasks.manage')
  @SerializeOptions({ schema: taskRevisionSchema })
  @ApiOkResponse({
    description: 'The decided over-limit revision (client scope)',
    standardSchema: taskRevisionSchema,
  })
  decideRevision(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Body({ schema: revisionDecisionInputSchema }) input: RevisionDecisionInput,
  ): Promise<TaskRevision> {
    return this.workflow.decideRevision(actor, id, revisionId, input);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions('tasks.manage')
  @SerializeOptions({ schema: taskDetailSchema })
  @ApiOkResponse({
    description: 'The archived task (scope all only)',
    standardSchema: taskDetailSchema,
  })
  archive(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TaskDetail> {
    return this.tasks.archive(actor, id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermissions('tasks.manage')
  @SerializeOptions({ schema: taskDetailSchema })
  @ApiOkResponse({
    description: 'The restored task (scope all only)',
    standardSchema: taskDetailSchema,
  })
  restore(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TaskDetail> {
    return this.tasks.restore(actor, id);
  }
}
