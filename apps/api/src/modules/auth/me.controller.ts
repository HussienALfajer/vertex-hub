import { Controller, Get, SerializeOptions, UnauthorizedException } from '@nestjs/common';
import { ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { grantedPermissions, type MeResponse, meResponseSchema } from '@vertex-hub/contracts';
import { AllowPendingTwoFactor, RequireSession } from '../../core/access/index.js';
import { AccessService } from './access.service.js';

@ApiTags('auth')
@RequireSession()
@Controller('me')
export class MeController {
  constructor(private readonly access: AccessService) {}

  @Get()
  // The web app reads `twoFactor` here to send users who must set up 2FA to the setup page.
  @AllowPendingTwoFactor()
  @SerializeOptions({ schema: meResponseSchema })
  @ApiOkResponse({ description: 'The signed-in user', standardSchema: meResponseSchema })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  async me(@Session() session: UserSession): Promise<MeResponse> {
    const { id, name, email, image } = session.user;
    const resolved = await this.access.resolve(id);
    if (!resolved) throw new UnauthorizedException();
    return {
      user: { id, name, email, image: image ?? null },
      roles: [...resolved.access.roles],
      departments: resolved.departments,
      permissions: grantedPermissions(resolved.access),
      twoFactor: resolved.twoFactor,
    };
  }
}
