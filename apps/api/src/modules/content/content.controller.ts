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
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  type ContentCalendar,
  type ContentCalendarQuery,
  type CreatePost,
  contentCalendarQuerySchema,
  contentCalendarSchema,
  createPostSchema,
  type DuplicatePost,
  duplicatePostSchema,
  type MedicalReview,
  type MyContentSummary,
  medicalReviewSchema,
  myContentSummarySchema,
  type PostDetail,
  type PostListQuery,
  type PostPage,
  type PostStatusChange,
  postDetailSchema,
  postListQuerySchema,
  postPageSchema,
  postStatusChangeSchema,
  type UpdatePost,
  updatePostSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { ContentService } from './content.service.js';
import { PostWorkflowService } from './post-workflow.service.js';

@ApiTags('content')
@Controller()
export class ContentController {
  constructor(
    private readonly content: ContentService,
    private readonly workflow: PostWorkflowService,
  ) {}

  @Get('content/calendar')
  @RequirePermissions('content.read')
  @SerializeOptions({ schema: contentCalendarSchema })
  @ApiOkResponse({
    description:
      'Posts with a publish date in the range (at most 45 days), by date and time, cancelled ones included, and counts by status',
    standardSchema: contentCalendarSchema,
  })
  calendar(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: contentCalendarQuerySchema }) query: ContentCalendarQuery,
  ): Promise<ContentCalendar> {
    return this.content.calendar(actor, query);
  }

  @Get('me/content/summary')
  @RequirePermissions('content.read')
  @SerializeOptions({ schema: myContentSummarySchema })
  @ApiOkResponse({
    description: 'Counts for the sections of My posts',
    standardSchema: myContentSummarySchema,
  })
  summary(@CurrentUser() actor: CurrentUserInfo): Promise<MyContentSummary> {
    return this.content.summary(actor);
  }

  @Get('content/posts')
  @RequirePermissions('content.read')
  @SerializeOptions({ schema: postPageSchema })
  @ApiOkResponse({
    description: 'Posts by publish date; `archived` needs `content.review` over all posts',
    standardSchema: postPageSchema,
  })
  list(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: postListQuerySchema }) query: PostListQuery,
  ): Promise<PostPage> {
    return this.content.list(actor, query);
  }

  @Post('content/posts')
  @RequirePermissions('content.manage')
  @SerializeOptions({ schema: postDetailSchema })
  @ApiCreatedResponse({
    description: 'The new post, an idea (edit scope on the client)',
    standardSchema: postDetailSchema,
  })
  @ApiConflictResponse({ description: '`CLIENT_ARCHIVED`, `CLIENT_ENDED`, `CYCLE_CLOSED`' })
  create(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: createPostSchema }) input: CreatePost,
  ): Promise<PostDetail> {
    return this.content.create(actor, input);
  }

  @Get('content/posts/:id')
  @RequirePermissions('content.read')
  @SerializeOptions({ schema: postDetailSchema })
  @ApiOkResponse({
    description: 'A post with its media, reviews and client responses',
    standardSchema: postDetailSchema,
  })
  detail(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PostDetail> {
    return this.content.detail(actor, id);
  }

  @Patch('content/posts/:id')
  @RequirePermissions('content.manage')
  @SerializeOptions({ schema: postDetailSchema })
  @ApiOkResponse({
    description:
      'The updated post (edit scope): the content in idea and in production, the schedule in any open status, the publish time and links once published',
    standardSchema: postDetailSchema,
  })
  @ApiConflictResponse({
    description: '`POST_LOCKED`, `POST_ARCHIVED`, `INVALID_TRANSITION`, `CYCLE_CLOSED`',
  })
  update(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updatePostSchema }) input: UpdatePost,
  ): Promise<PostDetail> {
    return this.content.update(actor, id, input);
  }

  @Post('content/posts/:id/status')
  @HttpCode(200)
  @RequirePermissions('content.read')
  @SerializeOptions({ schema: postDetailSchema })
  @ApiOkResponse({
    description: 'The post after the move; each move has its roles (spec F08, rule 1)',
    standardSchema: postDetailSchema,
  })
  @ApiConflictResponse({
    description:
      '`INVALID_TRANSITION`, `NOTHING_TO_APPROVE`, `REVIEW_CONTENT_CHANGED`, `PUBLISH_TIME_REQUIRED`, `POST_ARCHIVED`',
  })
  changeStatus(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: postStatusChangeSchema }) change: PostStatusChange,
  ): Promise<PostDetail> {
    return this.workflow.changeStatus(actor, id, change);
  }

  @Post('content/posts/:id/medical-review')
  @HttpCode(200)
  @RequirePermissions('approvals.review_medical')
  @SerializeOptions({ schema: postDetailSchema })
  @ApiOkResponse({
    description:
      'The post after the medical review: cleared, or returned with notes; never by its responsible person',
    standardSchema: postDetailSchema,
  })
  @ApiConflictResponse({ description: '`INVALID_TRANSITION`, `POST_ARCHIVED`' })
  medicalReview(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: medicalReviewSchema }) input: MedicalReview,
  ): Promise<PostDetail> {
    return this.workflow.medicalReview(actor, id, input);
  }

  @Post('content/posts/:id/duplicate')
  @RequirePermissions('content.manage')
  @SerializeOptions({ schema: postDetailSchema })
  @ApiCreatedResponse({
    description: 'A new idea with the content of the post, the caller responsible',
    standardSchema: postDetailSchema,
  })
  @ApiConflictResponse({ description: '`CLIENT_ARCHIVED`, `CLIENT_ENDED`' })
  duplicate(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: duplicatePostSchema }) input: DuplicatePost,
  ): Promise<PostDetail> {
    return this.content.duplicate(actor, id, input);
  }

  @Post('content/posts/:id/archive')
  @HttpCode(204)
  @RequirePermissions('content.review')
  @ApiNoContentResponse({ description: 'Archived (`content.review` over all posts)' })
  archive(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.content.archive(actor, id);
  }

  @Post('content/posts/:id/restore')
  @HttpCode(200)
  @RequirePermissions('content.review')
  @SerializeOptions({ schema: postDetailSchema })
  @ApiOkResponse({
    description: 'The restored post, in the status it had (`content.review` over all posts)',
    standardSchema: postDetailSchema,
  })
  restore(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PostDetail> {
    return this.content.restore(actor, id);
  }
}
