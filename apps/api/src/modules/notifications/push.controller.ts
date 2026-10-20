import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  type PushConfig,
  type PushDeliveryListQuery,
  type PushDeliveryPage,
  type PushSubscriptionInput,
  pushConfigSchema,
  pushDeliveryListQuerySchema,
  pushDeliveryPageSchema,
  pushSubscriptionInputSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions, RequireSession } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { PushService } from './push.service.js';

/** F16 part A (ADR 0036): push on the caller's current device, and the delivery log. */
@ApiTags('notifications')
@ApiUnauthorizedResponse({ description: 'No valid session' })
@Controller()
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('me/push/config')
  @RequireSession()
  @SerializeOptions({ schema: pushConfigSchema })
  @ApiOkResponse({
    description: 'Whether push is available, and the VAPID public key to subscribe with',
    standardSchema: pushConfigSchema,
  })
  config(): PushConfig {
    return this.push.config();
  }

  @Put('me/push/subscription')
  @RequireSession()
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Stored on the current session, replacing its earlier one' })
  @ApiBadRequestResponse({ description: 'Not a valid https push subscription' })
  @ApiConflictResponse({ description: '`PUSH_UNAVAILABLE`: no VAPID keys on this server' })
  subscribe(
    @CurrentUser() current: CurrentUserInfo,
    @Body({ schema: pushSubscriptionInputSchema }) input: PushSubscriptionInput,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<void> {
    return this.push.subscribe(current, input, userAgent);
  }

  @Delete('me/push/subscription')
  @RequireSession()
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Push turned off on the current device' })
  unsubscribe(@CurrentUser() current: CurrentUserInfo): Promise<void> {
    return this.push.unsubscribe(current);
  }

  @Post('me/push/test')
  @RequireSession()
  @HttpCode(202)
  @ApiAcceptedResponse({ description: 'A test push is queued for the current device' })
  @ApiConflictResponse({ description: '`NO_SUBSCRIPTION`: push is not on for this device' })
  @ApiTooManyRequestsResponse({ description: 'One test push a minute' })
  test(@CurrentUser() current: CurrentUserInfo): Promise<void> {
    return this.push.test(current);
  }

  @Post('me/push/deliveries/:id/click')
  @RequireSession()
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Recorded; the notification is marked read' })
  @ApiNotFoundResponse({ description: 'Not one of the caller’s pushes' })
  click(
    @CurrentUser() current: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.push.click(current, id);
  }

  @Get('push-deliveries')
  @RequirePermissions('notifications.policy')
  @SerializeOptions({ schema: pushDeliveryPageSchema })
  @ApiOkResponse({ description: 'The delivery log', standardSchema: pushDeliveryPageSchema })
  @ApiForbiddenResponse({ description: 'Without `notifications.policy`' })
  deliveries(
    @Query({ schema: pushDeliveryListQuerySchema }) query: PushDeliveryListQuery,
  ): Promise<PushDeliveryPage> {
    return this.push.list(query);
  }
}
