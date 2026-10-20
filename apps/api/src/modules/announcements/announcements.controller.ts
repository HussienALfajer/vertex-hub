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
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  type Announcement,
  type AnnouncementHome,
  type AnnouncementListQuery,
  type AnnouncementPage,
  type AnnouncementReceipts,
  type AnnouncementReceiptsQuery,
  announcementHomeSchema,
  announcementListQuerySchema,
  announcementPageSchema,
  announcementReceiptsQuerySchema,
  announcementReceiptsSchema,
  announcementSchema,
  type CreateAnnouncement,
  createAnnouncementSchema,
  type RemindAnnouncementResult,
  remindAnnouncementResultSchema,
  type SendAnnouncement,
  sendAnnouncementSchema,
  type UpdateAnnouncement,
  updateAnnouncementSchema,
} from '@vertex-hub/contracts';
import { RequireSession } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { AnnouncementsService } from './announcements.service.js';

/**
 * F16 part D (ADR 0038): every active user writes announcements; the service checks author,
 * recipient and `announcements.manage` per route, and answers 404 to those who may not read one.
 */
@ApiTags('announcements')
@ApiUnauthorizedResponse({ description: 'No valid session' })
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  @RequireSession()
  @SerializeOptions({ schema: announcementPageSchema })
  @ApiOkResponse({ description: 'A page of announcements', standardSchema: announcementPageSchema })
  @ApiForbiddenResponse({ description: '`all` without `announcements.manage` scope all' })
  list(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: announcementListQuerySchema }) query: AnnouncementListQuery,
  ): Promise<AnnouncementPage> {
    return this.announcements.list(actor, query);
  }

  @Get('home')
  @RequireSession()
  @SerializeOptions({ schema: announcementHomeSchema })
  @ApiOkResponse({
    description: "The caller's pinned announcements and unacknowledged critical ones",
    standardSchema: announcementHomeSchema,
  })
  home(@CurrentUser() actor: CurrentUserInfo): Promise<AnnouncementHome> {
    return this.announcements.home(actor);
  }

  @Get(':id')
  @RequireSession()
  @SerializeOptions({ schema: announcementSchema })
  @ApiOkResponse({
    description: "The announcement; a recipient's first opening is recorded",
    standardSchema: announcementSchema,
  })
  @ApiNotFoundResponse({ description: 'No such announcement, or not for the caller' })
  detail(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Announcement> {
    return this.announcements.open(actor, id);
  }

  @Post()
  @RequireSession()
  @SerializeOptions({ schema: announcementSchema })
  @ApiCreatedResponse({
    description: 'The announcement, sent, scheduled or kept as a draft',
    standardSchema: announcementSchema,
  })
  @ApiBadRequestResponse({ description: 'Invalid input, schedule time or pin date' })
  @ApiConflictResponse({ description: '`EMPTY_AUDIENCE`' })
  @ApiForbiddenResponse({ description: '`FORBIDDEN_AUDIENCE`: critical or pinned out of reach' })
  create(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: createAnnouncementSchema }) input: CreateAnnouncement,
  ): Promise<Announcement> {
    return this.announcements.create(actor, input);
  }

  @Patch(':id')
  @RequireSession()
  @SerializeOptions({ schema: announcementSchema })
  @ApiOkResponse({
    description: 'The announcement after the edit',
    standardSchema: announcementSchema,
  })
  @ApiConflictResponse({ description: '`LOCKED_FIELD`, `ALREADY_WITHDRAWN`, `EMPTY_AUDIENCE`' })
  @ApiForbiddenResponse({ description: 'Not the author, or `FORBIDDEN_AUDIENCE`' })
  @ApiNotFoundResponse({ description: 'No such announcement, or not for the caller' })
  update(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateAnnouncementSchema }) input: UpdateAnnouncement,
  ): Promise<Announcement> {
    return this.announcements.update(actor, id, input);
  }

  @Post(':id/send')
  @HttpCode(200)
  @RequireSession()
  @SerializeOptions({ schema: announcementSchema })
  @ApiOkResponse({
    description: 'The draft sent now, or scheduled for `scheduledAt`',
    standardSchema: announcementSchema,
  })
  @ApiConflictResponse({ description: '`NOT_DRAFT`, `EMPTY_AUDIENCE`' })
  @ApiForbiddenResponse({ description: 'Not the author, or `FORBIDDEN_AUDIENCE`' })
  send(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: sendAnnouncementSchema }) input: SendAnnouncement,
  ): Promise<Announcement> {
    return this.announcements.send(actor, id, input);
  }

  @Post(':id/cancel-schedule')
  @HttpCode(200)
  @RequireSession()
  @SerializeOptions({ schema: announcementSchema })
  @ApiOkResponse({
    description: 'The announcement, a draft again',
    standardSchema: announcementSchema,
  })
  @ApiConflictResponse({ description: '`NOT_SCHEDULED`' })
  @ApiForbiddenResponse({ description: 'Not the author' })
  cancelSchedule(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Announcement> {
    return this.announcements.cancelSchedule(actor, id);
  }

  @Post(':id/withdraw')
  @HttpCode(200)
  @RequireSession()
  @SerializeOptions({ schema: announcementSchema })
  @ApiOkResponse({ description: 'The announcement, withdrawn', standardSchema: announcementSchema })
  @ApiConflictResponse({ description: '`ALREADY_WITHDRAWN`' })
  @ApiForbiddenResponse({ description: 'Neither the author nor `announcements.manage` scope all' })
  withdraw(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Announcement> {
    return this.announcements.withdraw(actor, id);
  }

  @Post(':id/archive')
  @HttpCode(204)
  @RequireSession()
  @ApiNoContentResponse({ description: 'The draft discarded' })
  @ApiConflictResponse({ description: '`NOT_DRAFT`' })
  @ApiForbiddenResponse({ description: 'Not the author' })
  archive(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.announcements.archive(actor, id);
  }

  @Post(':id/acknowledge')
  @HttpCode(204)
  @RequireSession()
  @ApiNoContentResponse({ description: '"I have read this" recorded' })
  @ApiConflictResponse({ description: '`NO_ACK_REQUIRED`' })
  @ApiNotFoundResponse({ description: 'Not a sent announcement the caller received' })
  acknowledge(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.announcements.acknowledge(actor, id);
  }

  @Post(':id/remind')
  @HttpCode(200)
  @RequireSession()
  @SerializeOptions({ schema: remindAnnouncementResultSchema })
  @ApiOkResponse({
    description: 'How many recipients who have not acknowledged were reminded',
    standardSchema: remindAnnouncementResultSchema,
  })
  @ApiConflictResponse({ description: '`NO_ACK_REQUIRED`' })
  @ApiForbiddenResponse({ description: 'Not the author' })
  @ApiTooManyRequestsResponse({ description: 'Reminded less than an hour ago' })
  remind(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RemindAnnouncementResult> {
    return this.announcements.remind(actor, id);
  }

  @Get(':id/receipts')
  @RequireSession()
  @SerializeOptions({ schema: announcementReceiptsSchema })
  @ApiOkResponse({
    description: 'Each recipient with when they opened and acknowledged it',
    standardSchema: announcementReceiptsSchema,
  })
  @ApiForbiddenResponse({ description: 'Neither the author nor `announcements.manage` scope all' })
  @ApiNotFoundResponse({ description: 'No such announcement, or not for the caller' })
  receipts(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Query({ schema: announcementReceiptsQuerySchema }) query: AnnouncementReceiptsQuery,
  ): Promise<AnnouncementReceipts> {
    return this.announcements.receipts(actor, id, query);
  }
}
