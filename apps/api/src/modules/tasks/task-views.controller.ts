import { Controller, Get, Query, SerializeOptions } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type MyTaskSummary,
  myTaskSummarySchema,
  type TaskBoard,
  type TaskBoardQuery,
  type TaskWorkload,
  type TaskWorkloadQuery,
  taskBoardQuerySchema,
  taskBoardSchema,
  taskWorkloadQuerySchema,
  taskWorkloadSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { TaskViewsService } from './task-views.service.js';

/** Registered before `TasksController`, so `tasks/board` is not read as a task id. */
@ApiTags('tasks')
@Controller()
export class TaskViewsController {
  constructor(private readonly views: TaskViewsService) {}

  @Get('tasks/board')
  @RequirePermissions('tasks.read')
  @SerializeOptions({ schema: taskBoardSchema })
  @ApiOkResponse({
    description:
      'Columns by status for the departments (default: the ones the caller manages, else their own); delivered holds the last 14 days',
    standardSchema: taskBoardSchema,
  })
  board(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: taskBoardQuerySchema }) query: TaskBoardQuery,
  ): Promise<TaskBoard> {
    return this.views.board(actor, query);
  }

  @Get('tasks/workload')
  @RequirePermissions('tasks.read')
  @SerializeOptions({ schema: taskWorkloadSchema })
  @ApiOkResponse({
    description: 'Open, overdue and due-this-week counts per person of the departments',
    standardSchema: taskWorkloadSchema,
  })
  workload(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: taskWorkloadQuerySchema }) query: TaskWorkloadQuery,
  ): Promise<TaskWorkload> {
    return this.views.workload(actor, query);
  }

  @Get('me/tasks/summary')
  @RequirePermissions('tasks.read')
  @SerializeOptions({ schema: myTaskSummarySchema })
  @ApiOkResponse({
    description: 'Counts for the sections of My tasks',
    standardSchema: myTaskSummarySchema,
  })
  summary(@CurrentUser() actor: CurrentUserInfo): Promise<MyTaskSummary> {
    return this.views.summary(actor);
  }
}
