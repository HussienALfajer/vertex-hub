import { Controller, Get, SerializeOptions } from '@nestjs/common';
import { ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { grantedPermissions, type MeResponse, meResponseSchema } from '@vertex-hub/contracts';
import { RolesService } from './roles.service.js';

@ApiTags('auth')
@Controller('me')
export class MeController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @SerializeOptions({ schema: meResponseSchema })
  @ApiOkResponse({ description: 'The signed-in user', standardSchema: meResponseSchema })
  @ApiUnauthorizedResponse({ description: 'No valid session' })
  async me(@Session() session: UserSession): Promise<MeResponse> {
    const { id, name, email, image } = session.user;
    const roles = await this.roles.rolesOf(id);
    return {
      user: { id, name, email, image: image ?? null },
      roles,
      permissions: grantedPermissions(roles),
    };
  }
}
