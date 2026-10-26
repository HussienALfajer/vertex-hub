import { Body, Controller, Get, HttpCode, Post, Query, SerializeOptions } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type MyTaskSummary,
  myTaskSummarySchema,
  type TaskBoard,
  type TaskBoardQuery,
  type TaskReadiness,
  type TaskReadinessInput,
  type TaskTree,
  type TaskTreeQuery,
  type TaskWorkload,
  type TaskWorkloadQuery,
  taskBoardQuerySchema,
  taskBoardSchema,
  taskReadinessInputSchema,
  taskReadinessSchema,
  taskTreeQuerySchema,
  taskTreeSchema,
  taskWorkloadQuerySchema,
  taskWorkloadSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { TaskReadinessService } from './task-readiness.service.js';
import { TaskTreeService } from './task-tree.service.js';
import { TaskViewsService } from './task-views.service.js';

/** Registered before `TasksController`, so `tasks/board` is not read as a task id. */
@ApiTags('tasks')
@Controller()
export class TaskViewsController {
  constructor(
    private readonly views: TaskViewsService,
    private readonly readiness: TaskReadinessService,
    private readonly trees: TaskTreeService,
  ) {}

  @Post('tasks/readiness')
  @HttpCode(200)
  @RequirePermissions('tasks.request')
  @SerializeOptions({ schema: taskReadinessSchema })
  @ApiOkResponse({
    description:
      'Warnings for a draft and each of its subtasks before saving, assigning or re-dating (F06B rule C5); they never block',
    standardSchema: taskReadinessSchema,
  })
  checkReadiness(
    @Body({ schema: taskReadinessInputSchema }) input: TaskReadinessInput,
  ): Promise<TaskReadiness> {
    return this.readiness.check(input);
  }

  @Get('tasks/tree')
  @RequirePermissions('tasks.read')
  @SerializeOptions({ schema: taskTreeSchema })
  @ApiOkResponse({
    description:
      "A project's or a retainer cycle's tasks by milestone with their subtasks, the dependencies and the bottleneck (F06B rule D4)",
    standardSchema: taskTreeSchema,
  })
  @ApiNotFoundResponse({ description: 'No project or retainer cycle the caller may read' })
  tree(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: taskTreeQuerySchema }) query: TaskTreeQuery,
  ): Promise<TaskTree> {
    return this.trees.tree(actor, query);
  }

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
    description:
      'Open, overdue and due-this-week counts per person of the departments, with estimated hours against capacity',
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
