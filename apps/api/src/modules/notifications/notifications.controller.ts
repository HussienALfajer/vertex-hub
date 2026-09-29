import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  SerializeOptions,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  NOTIFICATION_STREAM_LIFETIME_MS,
  NOTIFICATION_STREAM_PING_MS,
  type NotificationListQuery,
  type NotificationPage,
  type NotificationSettings,
  notificationListQuerySchema,
  notificationPageSchema,
  notificationSettingsSchema,
  type ReadAllResult,
  readAllResultSchema,
  type UnreadCount,
  type UpdateNotificationSettings,
  unreadCountSchema,
  updateNotificationSettingsSchema,
} from '@vertex-hub/contracts';
import { RequireSession } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { NotificationStream } from './notification-stream.js';
import { NotificationsService } from './notifications.service.js';

/** The caller's own notifications and settings (spec F14); another user's id answers 404. */
@ApiTags('notifications')
@RequireSession()
@ApiUnauthorizedResponse({ description: 'No valid session' })
@Controller('me')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly stream: NotificationStream,
  ) {}

  @Get('notifications')
  @SerializeOptions({ schema: notificationPageSchema })
  @ApiOkResponse({ description: 'Newest first', standardSchema: notificationPageSchema })
  list(
    @CurrentUser() current: CurrentUserInfo,
    @Query({ schema: notificationListQuerySchema }) query: NotificationListQuery,
  ): Promise<NotificationPage> {
    return this.notifications.list(current.id, query);
  }

  @Get('notifications/unread-count')
  @SerializeOptions({ schema: unreadCountSchema })
  @ApiOkResponse({ description: 'Unread notifications', standardSchema: unreadCountSchema })
  async unreadCount(@CurrentUser() current: CurrentUserInfo): Promise<UnreadCount> {
    return { count: await this.notifications.unreadCount(current.id) };
  }

  /**
   * Server-Sent Events (rule 4, ADR 0018): a `notification` event (`NotificationStreamEvent`)
   * per notification committed for the caller, a `: ping` comment every 25 s, closed after 15
   * minutes so the client reconnects and the session is checked again.
   */
  @Get('notifications/stream')
  @ApiProduces('text/event-stream')
  @ApiOkResponse({
    description: '`notification` events carrying a NotificationStreamEvent',
    content: { 'text/event-stream': { schema: { type: 'string' } } },
  })
  async openStream(
    @CurrentUser() current: CurrentUserInfo,
    @Req() request: IncomingMessage,
    @Res() response: ServerResponse,
  ): Promise<void> {
    // Before any header: if the listener cannot connect, the client gets an error status.
    await this.stream.connect();
    if (request.destroyed) return;
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Tells nginx not to buffer this response (ADR 0018).
      'x-accel-buffering': 'no',
    });
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(ping);
      clearTimeout(lifetime);
      unsubscribe();
      response.end();
    };
    const unsubscribe = this.stream.subscribe(current.id, {
      send: (event) => response.write(`event: notification\ndata: ${JSON.stringify(event)}\n\n`),
      close,
    });
    const ping = setInterval(() => response.write(': ping\n\n'), NOTIFICATION_STREAM_PING_MS);
    const lifetime = setTimeout(close, NOTIFICATION_STREAM_LIFETIME_MS);
    request.on('close', close);
    response.write(': connected\n\n');
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  @SerializeOptions({ schema: readAllResultSchema })
  @ApiOkResponse({ description: 'How many were marked read', standardSchema: readAllResultSchema })
  readAll(@CurrentUser() current: CurrentUserInfo): Promise<ReadAllResult> {
    return this.notifications.markAllRead(current.id);
  }

  @Post('notifications/:id/read')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Marked read' })
  @ApiNotFoundResponse({ description: 'Not one of the caller’s notifications' })
  markRead(
    @CurrentUser() current: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.notifications.markRead(current.id, id);
  }

  @Post('notifications/:id/unread')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Marked unread' })
  @ApiNotFoundResponse({ description: 'Not one of the caller’s notifications' })
  markUnread(
    @CurrentUser() current: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.notifications.markUnread(current.id, id);
  }

  @Get('notification-settings')
  @SerializeOptions({ schema: notificationSettingsSchema })
  @ApiOkResponse({
    description: 'Every type and whether it is muted',
    standardSchema: notificationSettingsSchema,
  })
  settings(@CurrentUser() current: CurrentUserInfo): Promise<NotificationSettings> {
    return this.notifications.settings(current.id);
  }

  @Put('notification-settings')
  @SerializeOptions({ schema: notificationSettingsSchema })
  @ApiOkResponse({
    description: 'The settings after the change',
    standardSchema: notificationSettingsSchema,
  })
  @ApiBadRequestResponse({ description: '`NOT_MUTABLE`: a type that requires action' })
  updateSettings(
    @CurrentUser() current: CurrentUserInfo,
    @Body({ schema: updateNotificationSettingsSchema }) input: UpdateNotificationSettings,
  ): Promise<NotificationSettings> {
    return this.notifications.updateSettings(current.id, input);
  }
}
