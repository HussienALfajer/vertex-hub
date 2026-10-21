import type { IncomingMessage } from 'node:http';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  SerializeOptions,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type AttendanceDayList,
  type AttendanceDayListQuery,
  type AttendanceKiosk,
  type AttendanceKioskList,
  type AttendanceKioskPairing,
  type AttendancePasskey,
  type AttendancePasskeyList,
  type AttendancePasskeyListQuery,
  attendanceDayListQuerySchema,
  attendanceDayListSchema,
  attendanceKioskListSchema,
  attendanceKioskPairingSchema,
  attendanceKioskSchema,
  attendancePasskeyListQuerySchema,
  attendancePasskeyListSchema,
  attendancePasskeySchema,
  type CreateAttendanceKiosk,
  createAttendanceKioskSchema,
  type MyAttendanceToday,
  myAttendanceTodaySchema,
  type PunchInput,
  type PunchOptionsInput,
  type PunchResult,
  punchInputSchema,
  punchOptionsInputSchema,
  punchResultSchema,
  type RegisterPasskey,
  type RevokePasskey,
  registerPasskeySchema,
  revokePasskeySchema,
  type WebAuthnChallenge,
  webAuthnChallengeSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions, RequireSession } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo, clientIpOf } from '../auth/index.js';
import { AttendanceService } from './attendance.service.js';
import { AttendanceKiosksService } from './attendance-kiosks.service.js';
import { AttendancePasskeysService } from './attendance-passkeys.service.js';

const addressOf = (request: IncomingMessage) =>
  clientIpOf(request.headers['x-forwarded-for'], request.socket.remoteAddress);

/**
 * F17 part C attendance: my day, punches (rules C5–C13), the month's days, the attendance passkeys
 * (rules C3, C9) and the entrance screens (rule C4).
 */
@ApiTags('hr')
@Controller('hr')
export class HrAttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly passkeys: AttendancePasskeysService,
    private readonly kiosks: AttendanceKiosksService,
  ) {}

  @Get('attendance/me/today')
  @RequireSession()
  @SerializeOptions({ schema: myAttendanceTodaySchema })
  @ApiOkResponse({
    description: 'My day: expectations, punches, the next direction and the methods offered now',
    standardSchema: myAttendanceTodaySchema,
  })
  today(@CurrentUser() actor: CurrentUserInfo): Promise<MyAttendanceToday> {
    return this.attendance.today(actor);
  }

  @Get('attendance/days')
  @RequireSession()
  @SerializeOptions({ schema: attendanceDayListSchema })
  @ApiOkResponse({
    description: "A month's days with their punches: one's own, or `hr.read` in scope; 404",
    standardSchema: attendanceDayListSchema,
  })
  days(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: attendanceDayListQuerySchema }) query: AttendanceDayListQuery,
  ): Promise<AttendanceDayList> {
    return this.attendance.month(actor, query);
  }

  @Post('attendance/punch/options')
  @HttpCode(200)
  @RequireSession()
  @SerializeOptions({ schema: webAuthnChallengeSchema })
  @ApiOkResponse({
    description: 'The place checked; the passkey challenge in a ticket valid 60 seconds',
    standardSchema: webAuthnChallengeSchema,
  })
  punchOptions(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: punchOptionsInputSchema }) input: PunchOptionsInput,
    @Req() request: IncomingMessage,
  ): Promise<WebAuthnChallenge> {
    return this.attendance.options(actor, input, addressOf(request));
  }

  @Post('attendance/punch')
  @RequireSession()
  @SerializeOptions({ schema: punchResultSchema })
  @ApiCreatedResponse({
    description: 'The punch, the recomputed day and the greeting',
    standardSchema: punchResultSchema,
  })
  punch(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: punchInputSchema }) input: PunchInput,
    @Req() request: IncomingMessage,
  ): Promise<PunchResult> {
    return this.attendance.punch(actor, input, addressOf(request));
  }

  @Post('passkeys/options')
  @HttpCode(200)
  @RequireSession()
  @SerializeOptions({ schema: webAuthnChallengeSchema })
  @ApiOkResponse({
    description: 'The registration challenge in a ticket valid 60 seconds',
    standardSchema: webAuthnChallengeSchema,
  })
  passkeyOptions(@CurrentUser() actor: CurrentUserInfo): Promise<WebAuthnChallenge> {
    return this.passkeys.options(actor);
  }

  @Post('passkeys')
  @RequireSession()
  @SerializeOptions({ schema: attendancePasskeySchema })
  @ApiCreatedResponse({
    description: 'The passkey: active, or pending the General Manager when one is active',
    standardSchema: attendancePasskeySchema,
  })
  registerPasskey(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: registerPasskeySchema }) input: RegisterPasskey,
    @Req() request: IncomingMessage,
  ): Promise<AttendancePasskey> {
    return this.passkeys.register(actor, input, request.headers['user-agent']);
  }

  @Get('passkeys/me')
  @RequireSession()
  @SerializeOptions({ schema: attendancePasskeyListSchema })
  @ApiOkResponse({
    description: 'My passkeys, newest first',
    standardSchema: attendancePasskeyListSchema,
  })
  myPasskeys(@CurrentUser() actor: CurrentUserInfo): Promise<AttendancePasskeyList> {
    return this.passkeys.mine(actor);
  }

  @Get('passkeys')
  @RequirePermissions('hr.read')
  @SerializeOptions({ schema: attendancePasskeyListSchema })
  @ApiOkResponse({
    description: "A person's passkeys, newest first; empty outside the scope",
    standardSchema: attendancePasskeyListSchema,
  })
  passkeysOf(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: attendancePasskeyListQuerySchema }) query: AttendancePasskeyListQuery,
  ): Promise<AttendancePasskeyList> {
    return this.passkeys.list(actor, query.userId);
  }

  @Post('passkeys/:id/revoke')
  @HttpCode(200)
  @RequirePermissions('hr.approve')
  @SerializeOptions({ schema: attendancePasskeySchema })
  @ApiOkResponse({ description: 'The revoked passkey', standardSchema: attendancePasskeySchema })
  revokePasskey(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: revokePasskeySchema }) input: RevokePasskey,
  ): Promise<AttendancePasskey> {
    return this.passkeys.revoke(actor, id, input);
  }

  @Get('kiosks')
  @RequirePermissions('hr.manage')
  @SerializeOptions({ schema: attendanceKioskListSchema })
  @ApiOkResponse({ description: 'The entrance screens', standardSchema: attendanceKioskListSchema })
  listKiosks(): Promise<AttendanceKioskList> {
    return this.kiosks.list();
  }

  @Post('kiosks')
  @RequirePermissions('hr.manage')
  @SerializeOptions({ schema: attendanceKioskPairingSchema })
  @ApiCreatedResponse({
    description: 'The new screen with its pairing code, shown once (15 minutes)',
    standardSchema: attendanceKioskPairingSchema,
  })
  createKiosk(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: createAttendanceKioskSchema }) input: CreateAttendanceKiosk,
  ): Promise<AttendanceKioskPairing> {
    return this.kiosks.create(actor, input);
  }

  @Post('kiosks/:id/pairing-code')
  @HttpCode(200)
  @RequirePermissions('hr.manage')
  @SerializeOptions({ schema: attendanceKioskPairingSchema })
  @ApiOkResponse({
    description: 'A new pairing code; the screen is unpaired until it is used',
    standardSchema: attendanceKioskPairingSchema,
  })
  kioskPairingCode(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AttendanceKioskPairing> {
    return this.kiosks.pairingCode(actor, id);
  }

  @Post('kiosks/:id/archive')
  @HttpCode(200)
  @RequirePermissions('hr.manage')
  @SerializeOptions({ schema: attendanceKioskSchema })
  @ApiOkResponse({ description: 'The screen, unpaired', standardSchema: attendanceKioskSchema })
  archiveKiosk(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AttendanceKiosk> {
    return this.kiosks.archive(actor, id);
  }
}
