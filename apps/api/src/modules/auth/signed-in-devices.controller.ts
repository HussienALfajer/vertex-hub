import type { ServerResponse } from 'node:http';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Res,
  SerializeOptions,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from '@thallesp/nestjs-better-auth';
import {
  type HardwareSignals,
  hardwareSignalsSchema,
  type SignedInDeviceList,
  type SignOutAllDevices,
  type SignOutAllDevicesResponse,
  signedInDeviceListSchema,
  signOutAllDevicesResponseSchema,
  signOutAllDevicesSchema,
} from '@vertex-hub/contracts';
import { RequireSession } from '../../core/access/index.js';
import type { Auth } from './auth.config.js';
import { CurrentUser, type CurrentUserInfo } from './current-user.decorator.js';
import { SignedInDevicesService } from './signed-in-devices.service.js';

/** F01B: the signed-in user's own sessions. */
@ApiTags('auth')
@RequireSession()
@Controller('me/sessions')
export class SignedInDevicesController {
  constructor(
    private readonly devices: SignedInDevicesService,
    @Inject(AuthService) private readonly auth: AuthService<Auth>,
  ) {}

  @Get()
  @SerializeOptions({ schema: signedInDeviceListSchema })
  @ApiOkResponse({
    description: 'Open sessions: the current one first, then by last activity',
    standardSchema: signedInDeviceListSchema,
  })
  list(@CurrentUser() actor: CurrentUserInfo): Promise<SignedInDeviceList> {
    return this.devices.list(actor);
  }

  @Put('current/hardware')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Stored on the current session, unless already reported' })
  reportHardware(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: hardwareSignalsSchema }) signals: HardwareSignals,
  ): Promise<void> {
    return this.devices.reportHardware(actor, signals);
  }

  @Post('sign-out-all')
  @HttpCode(200)
  @SerializeOptions({ schema: signOutAllDevicesResponseSchema })
  @ApiOkResponse({
    description: 'Sessions signed out; clears the session cookie when this one is included',
    standardSchema: signOutAllDevicesResponseSchema,
  })
  async signOutAll(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: signOutAllDevicesSchema }) input: SignOutAllDevices,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<SignOutAllDevicesResponse> {
    const result = await this.devices.signOutAll(actor, input.includeCurrent);
    if (input.includeCurrent) {
      // Rule 11: the session cookies go; the `vh_device` cookie stays.
      const { authCookies } = await this.auth.instance.$context;
      const cleared = [authCookies.sessionToken, authCookies.sessionData].map(
        ({ name, attributes }) =>
          [
            `${name}=`,
            `Path=${attributes.path ?? '/'}`,
            'Max-Age=0',
            ...(attributes.httpOnly ? ['HttpOnly'] : []),
            ...(attributes.secure ? ['Secure'] : []),
            ...(attributes.sameSite ? [`SameSite=${attributes.sameSite}`] : []),
          ].join('; '),
      );
      response.appendHeader('set-cookie', cleared);
    }
    return result;
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'The device is signed out' })
  @ApiNotFoundResponse({ description: 'Not one of your open sessions' })
  @ApiBadRequestResponse({ description: '`CURRENT_SESSION`: this device signs out on its own' })
  signOut(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.devices.signOut(actor, id);
  }
}
