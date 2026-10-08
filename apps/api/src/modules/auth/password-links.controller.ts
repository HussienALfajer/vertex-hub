import { Body, Controller, HttpCode, Post, SerializeOptions } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import {
  type CheckLink,
  checkLinkSchema,
  errorResponseSchema,
  type LinkInfoResponse,
  linkInfoResponseSchema,
  type RedeemLink,
  type RequestPasswordLink,
  redeemLinkSchema,
  requestPasswordLinkSchema,
} from '@vertex-hub/contracts';
import { UserLinksService } from './user-links.service.js';

@ApiTags('auth')
@Controller('password-links')
export class PasswordLinksController {
  constructor(private readonly links: UserLinksService) {}

  /** The activation page checks the link on opening, so a dead link shows before any typing. */
  @Post('check')
  @HttpCode(200)
  @AllowAnonymous()
  @SerializeOptions({ schema: linkInfoResponseSchema })
  @ApiOkResponse({ description: 'The link works', standardSchema: linkInfoResponseSchema })
  @ApiBadRequestResponse({
    description: 'LINK_INVALID: unknown, used, expired or replaced link',
    standardSchema: errorResponseSchema,
  })
  check(@Body({ schema: checkLinkSchema }) input: CheckLink): Promise<LinkInfoResponse> {
    return this.links.check(input);
  }

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

  /**
   * F14 email rule 13, "forgot password": the same answer whether the address belongs to an
   * account or not. An active user gets a reset link valid for 1 hour, at most 3 an hour.
   */
  @Post('request')
  @HttpCode(204)
  @AllowAnonymous()
  @ApiNoContentResponse({ description: 'Always, whether or not a link was emailed' })
  @ApiBadRequestResponse({
    description: 'Not an email address',
    standardSchema: errorResponseSchema,
  })
  request(@Body({ schema: requestPasswordLinkSchema }) input: RequestPasswordLink): void {
    this.links.request(input);
  }
}
