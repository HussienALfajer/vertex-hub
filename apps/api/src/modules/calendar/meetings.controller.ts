import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  SerializeOptions,
} from '@nestjs/common';
import { ApiConflictResponse, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type CancelMeeting,
  type CreateMeeting,
  cancelMeetingSchema,
  createMeetingSchema,
  type MeetingDetail,
  meetingDetailSchema,
  type UpdateMeeting,
  updateMeetingSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { MeetingsService } from './meetings.service.js';

@ApiTags('calendar')
@Controller('meetings')
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  @Post()
  @RequirePermissions('meetings.manage')
  @SerializeOptions({ schema: meetingDetailSchema })
  @ApiCreatedResponse({
    description: 'The created meeting; the caller is its organizer',
    standardSchema: meetingDetailSchema,
  })
  @ApiConflictResponse({
    description: '`SCHEDULE_CONFLICT` (details: the conflicts), `CLIENT_ARCHIVED`',
  })
  create(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: createMeetingSchema }) input: CreateMeeting,
  ): Promise<MeetingDetail> {
    return this.meetings.create(actor, input);
  }

  @Get(':id')
  @RequirePermissions('calendar.read')
  @SerializeOptions({ schema: meetingDetailSchema })
  @ApiOkResponse({
    description: 'A meeting with its attendees, contacts and what the caller may do',
    standardSchema: meetingDetailSchema,
  })
  detail(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MeetingDetail> {
    return this.meetings.detail(actor, id);
  }

  @Patch(':id')
  @RequirePermissions('meetings.manage')
  @SerializeOptions({ schema: meetingDetailSchema })
  @ApiOkResponse({
    description: 'The edited meeting (meeting scope: the organizer, the account manager, or all)',
    standardSchema: meetingDetailSchema,
  })
  @ApiConflictResponse({
    description:
      '`MEETING_NOT_SCHEDULED`, `MEETING_ARCHIVED`, `SCHEDULE_CONFLICT`, `CLIENT_ARCHIVED`',
  })
  update(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateMeetingSchema }) input: UpdateMeeting,
  ): Promise<MeetingDetail> {
    return this.meetings.update(actor, id, input);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('meetings.manage')
  @SerializeOptions({ schema: meetingDetailSchema })
  @ApiOkResponse({ description: 'The cancelled meeting', standardSchema: meetingDetailSchema })
  @ApiConflictResponse({ description: '`MEETING_NOT_SCHEDULED`, `MEETING_ARCHIVED`' })
  cancel(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: cancelMeetingSchema }) input: CancelMeeting,
  ): Promise<MeetingDetail> {
    return this.meetings.cancel(actor, id, input);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions('meetings.manage')
  @SerializeOptions({ schema: meetingDetailSchema })
  @ApiOkResponse({
    description: 'The archived meeting (`meetings.manage` over all meetings)',
    standardSchema: meetingDetailSchema,
  })
  @ApiConflictResponse({ description: '`MEETING_ARCHIVED`' })
  archive(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MeetingDetail> {
    return this.meetings.archive(actor, id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermissions('meetings.manage')
  @SerializeOptions({ schema: meetingDetailSchema })
  @ApiOkResponse({
    description: 'The restored meeting (`meetings.manage` over all meetings)',
    standardSchema: meetingDetailSchema,
  })
  @ApiConflictResponse({ description: '`MEETING_NOT_ARCHIVED`' })
  restore(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MeetingDetail> {
    return this.meetings.restore(actor, id);
  }
}
