import { Body, Controller, Get, Param, Put, SerializeOptions } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  type NotificationPolicy,
  type NotificationPolicyList,
  notificationPolicyListSchema,
  notificationPolicySchema,
  type UpdateNotificationPolicy,
  updateNotificationPolicySchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { NotificationPolicies } from './notification-policies.service.js';

/** F16 rules B1–B2: the channel policy per notification type, set by management. */
@ApiTags('notifications')
@RequirePermissions('notifications.policy')
@ApiUnauthorizedResponse({ description: 'No valid session' })
@ApiForbiddenResponse({ description: 'Without `notifications.policy`' })
@Controller('notification-policies')
export class NotificationPoliciesController {
  constructor(private readonly policies: NotificationPolicies) {}

  @Get()
  @SerializeOptions({ schema: notificationPolicyListSchema })
  @ApiOkResponse({
    description: 'Every type with its default and current push and email modes',
    standardSchema: notificationPolicyListSchema,
  })
  list(): Promise<NotificationPolicyList> {
    return this.policies.list();
  }

  @Put(':type')
  @SerializeOptions({ schema: notificationPolicySchema })
  @ApiOkResponse({ description: 'The type’s policy', standardSchema: notificationPolicySchema })
  @ApiBadRequestResponse({ description: 'Both modes, or `{ reset: true }`' })
  @ApiNotFoundResponse({ description: 'No such notification type' })
  update(
    @CurrentUser() current: CurrentUserInfo,
    @Param('type') type: string,
    @Body({ schema: updateNotificationPolicySchema }) input: UpdateNotificationPolicy,
  ): Promise<NotificationPolicy> {
    return this.policies.update(current, type, input);
  }
}
