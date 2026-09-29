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
  type PageQuery,
  pageQuerySchema,
  type TaskComment,
  type TaskCommentInput,
  type TaskCommentPage,
  taskCommentInputSchema,
  taskCommentPageSchema,
  taskCommentSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { TaskCommentsService } from './task-comments.service.js';

@ApiTags('tasks')
@Controller('tasks/:id/comments')
export class TaskCommentsController {
  constructor(private readonly comments: TaskCommentsService) {}

  @Get()
  @RequirePermissions('tasks.read')
  @SerializeOptions({ schema: taskCommentPageSchema })
  @ApiOkResponse({
    description: 'Comments, oldest first; removed ones stay in place without their body',
    standardSchema: taskCommentPageSchema,
  })
  list(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) taskId: string,
    @Query({ schema: pageQuerySchema }) query: PageQuery,
  ): Promise<TaskCommentPage> {
    return this.comments.list(actor, taskId, query);
  }

  @Post()
  @RequirePermissions('tasks.read')
  @SerializeOptions({ schema: taskCommentSchema })
  @ApiCreatedResponse({
    description: 'The new comment; mentions are `@{userId}` tokens of active users',
    standardSchema: taskCommentSchema,
  })
  create(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) taskId: string,
    @Body({ schema: taskCommentInputSchema }) input: TaskCommentInput,
  ): Promise<TaskComment> {
    return this.comments.create(actor, taskId, input);
  }

  @Patch(':commentId')
  @RequirePermissions('tasks.read')
  @SerializeOptions({ schema: taskCommentSchema })
  @ApiOkResponse({
    description: 'The edited comment (its author only)',
    standardSchema: taskCommentSchema,
  })
  update(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) taskId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body({ schema: taskCommentInputSchema }) input: TaskCommentInput,
  ): Promise<TaskComment> {
    return this.comments.update(actor, taskId, commentId, input);
  }

  @Post(':commentId/archive')
  @HttpCode(204)
  @RequirePermissions('tasks.read')
  @ApiNoContentResponse({
    description: 'The comment is removed (its author, or `tasks.manage` with scope all)',
  })
  archive(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) taskId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ): Promise<void> {
    return this.comments.archive(actor, taskId, commentId);
  }
}
