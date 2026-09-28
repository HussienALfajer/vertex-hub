import { Body, Controller, Get, Patch, SerializeOptions } from '@nestjs/common';
import { ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import {
  grantedPermissions,
  type MeResponse,
  meResponseSchema,
  type UpdateOwnProfile,
  type UserResponse,
  updateOwnProfileSchema,
  userResponseSchema,
} from '@vertex-hub/contracts';
import { AllowPendingTwoFactor, RequireSession } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from './current-user.decorator.js';
import { UsersService } from './users.service.js';

@ApiTags('auth')
@RequireSession()
@Controller('me')
export class MeController {
  constructor(private readonly users: UsersService) {}

  @Get()
  // The web app reads `twoFactor` here to send users who must set up 2FA to the setup page.
  @AllowPendingTwoFactor()
  @SerializeOptions({ schema: meResponseSchema })
  @ApiOkResponse({ description: 'The signed-in user', standardSchema: meResponseSchema })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  me(@Session() session: UserSession, @CurrentUser() current: CurrentUserInfo): MeResponse {
    const { id, name, email, image } = session.user;
    return {
      user: { id, name, email, image: image ?? null },
      roles: [...current.access.roles],
      departments: current.departments,
      permissions: grantedPermissions(current.access),
      twoFactor: current.twoFactor,
    };
  }

  /** Every user edits their own phone and skills; the rest is set by user managers. */
  @Patch('profile')
  @SerializeOptions({ schema: userResponseSchema })
  @ApiOkResponse({ description: 'The user after the change', standardSchema: userResponseSchema })
  updateProfile(
    @CurrentUser() current: CurrentUserInfo,
    @Body({ schema: updateOwnProfileSchema }) input: UpdateOwnProfile,
  ): Promise<UserResponse> {
    return this.users.updateOwnProfile(current, input);
  }
}
