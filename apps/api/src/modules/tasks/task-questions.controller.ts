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
  type ForwardQuestion,
  forwardQuestionSchema,
  type MyQuestionPage,
  type MyQuestionsQuery,
  myQuestionPageSchema,
  myQuestionsQuerySchema,
  type TaskComment,
  type TaskQuestionInput,
  taskCommentSchema,
  taskQuestionInputSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions, RequireSession } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { TaskCommentsService } from './task-comments.service.js';
import { TaskQuestionsService } from './task-questions.service.js';

/** Questions on a task (F06B part B): every reader asks and replies; the service checks rule B4. */
@ApiTags('tasks')
@Controller()
export class TaskQuestionsController {
  constructor(
    private readonly questions: TaskQuestionsService,
    private readonly comments: TaskCommentsService,
  ) {}

  @Get('me/questions')
  @RequireSession()
  @SerializeOptions({ schema: myQuestionPageSchema })
  @ApiOkResponse({
    description:
      'Questions waiting for my answer: to me, or to a department I manage and not forwarded',
    standardSchema: myQuestionPageSchema,
  })
  mine(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: myQuestionsQuerySchema }) query: MyQuestionsQuery,
  ): Promise<MyQuestionPage> {
    return this.comments.mine(actor, query);
  }

  @Post('tasks/:id/questions')
  @RequirePermissions('tasks.read')
  @SerializeOptions({ schema: taskCommentSchema })
  @ApiCreatedResponse({
    description: 'The new question to a person or a department, with its attachments',
    standardSchema: taskCommentSchema,
  })
  ask(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) taskId: string,
    @Body({ schema: taskQuestionInputSchema }) input: TaskQuestionInput,
  ): Promise<TaskComment> {
    return this.questions.ask(actor, taskId, input);
  }

  @Post('tasks/:id/questions/:questionId/answered')
  @HttpCode(200)
  @RequirePermissions('tasks.read')
  @SerializeOptions({ schema: taskCommentSchema })
  @ApiOkResponse({
    description:
      'The question, answered: by the asker at any time, by the addressee or a reply author once a reply exists',
    standardSchema: taskCommentSchema,
  })
  answer(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) taskId: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
  ): Promise<TaskComment> {
    return this.questions.answer(actor, taskId, questionId);
  }

  @Post('tasks/:id/questions/:questionId/reopen')
  @HttpCode(200)
  @RequirePermissions('tasks.read')
  @SerializeOptions({ schema: taskCommentSchema })
  @ApiOkResponse({
    description: 'The question, open again with its clock restarted (the asker only)',
    standardSchema: taskCommentSchema,
  })
  reopen(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) taskId: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
  ): Promise<TaskComment> {
    return this.questions.reopen(actor, taskId, questionId);
  }

  @Post('tasks/:id/questions/:questionId/forward')
  @HttpCode(200)
  @RequirePermissions('tasks.read')
  @SerializeOptions({ schema: taskCommentSchema })
  @ApiOkResponse({
    description: 'The department question, forwarded to one of its members (its managers only)',
    standardSchema: taskCommentSchema,
  })
  forward(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) taskId: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
    @Body({ schema: forwardQuestionSchema }) input: ForwardQuestion,
  ): Promise<TaskComment> {
    return this.questions.forward(actor, taskId, questionId, input);
  }
}
