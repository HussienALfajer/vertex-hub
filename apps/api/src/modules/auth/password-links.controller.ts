import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBadRequestResponse, ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { errorResponseSchema, type RedeemLink, redeemLinkSchema } from '@vertex-hub/contracts';
import { UserLinksService } from './user-links.service.js';

@ApiTags('auth')
@Controller('password-links')
export class PasswordLinksController {
  constructor(private readonly links: UserLinksService) {}

  /** The activation page sends the token from the link with the new password. */
  @Post('redeem')
  @HttpCode(204)
  @AllowAnonymous()
  @ApiNoContentResponse({ description: 'Password set; the user can sign in' })
  @ApiBadRequestResponse({
    description: 'LINK_INVALID: unknown, used, expired or replaced link',
    standardSchema: errorResponseSchema,
  })
  redeem(@Body({ schema: redeemLinkSchema }) input: RedeemLink): Promise<void> {
    return this.links.redeem(input);
  }
}
