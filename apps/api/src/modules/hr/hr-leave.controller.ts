import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type CancelHrRequest,
  type CreateHrOpinion,
  type CreateHrRequest,
  type CreateLeaveAdjustment,
  cancelHrRequestSchema,
  createHrOpinionSchema,
  createHrRequestSchema,
  createLeaveAdjustmentSchema,
  type DecideHrRequest,
  decideHrRequestSchema,
  type HrOpinion,
  type HrRequest,
  type HrRequestDetail,
  type HrRequestListQuery,
  type HrRequestPage,
  type HrRequestPreview,
  hrOpinionSchema,
  hrRequestDetailSchema,
  hrRequestListQuerySchema,
  hrRequestPageSchema,
  hrRequestPreviewSchema,
  hrRequestSchema,
  type LeaveBalance,
  type LeaveBalanceQuery,
  leaveBalanceQuerySchema,
  leaveBalanceSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions, RequireSession } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { HrRequestsService } from './hr-requests.service.js';
import { LeaveBalancesService } from './leave-balances.service.js';

/** F17 part B leave: balances (rules B4–B7), requests (rules B8–B15) and opinions. */
@ApiTags('hr')
@Controller('hr')
export class HrLeaveController {
  constructor(
    private readonly balances: LeaveBalancesService,
    private readonly requests: HrRequestsService,
  ) {}

  @Get('balances/:userId')
  @RequireSession()
  @SerializeOptions({ schema: leaveBalanceSchema })
  @ApiOkResponse({
    description: "A year's leave balances and ledger: one's own, or `hr.read` in scope; 404",
    standardSchema: leaveBalanceSchema,
  })
  balance(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query({ schema: leaveBalanceQuerySchema }) query: LeaveBalanceQuery,
  ): Promise<LeaveBalance> {
    return this.balances.get(actor, userId, query.year);
  }

  @Post('balances/:userId/adjustments')
  @RequirePermissions('hr.approve')
  @SerializeOptions({ schema: leaveBalanceSchema })
  @ApiCreatedResponse({
    description: 'An opening balance or a signed adjustment; the balances of its year',
    standardSchema: leaveBalanceSchema,
  })
  adjust(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body({ schema: createLeaveAdjustmentSchema }) input: CreateLeaveAdjustment,
  ): Promise<LeaveBalance> {
    return this.balances.adjust(actor, userId, input);
  }

  @Post('requests/preview')
  @HttpCode(200)
  @RequireSession()
  @SerializeOptions({ schema: hrRequestPreviewSchema })
  @ApiOkResponse({
    description:
      'The days, split and notice of a request before it is submitted; the same errors as submitting',
    standardSchema: hrRequestPreviewSchema,
  })
  preview(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: createHrRequestSchema }) input: CreateHrRequest,
  ): Promise<HrRequestPreview> {
    return this.requests.preview(actor, input);
  }

  @Post('requests')
  @RequireSession()
  @SerializeOptions({ schema: hrRequestSchema })
  @ApiCreatedResponse({
    description:
      'A leave or permission request; `userId` (`hr.approve`) records one for someone, approved at once. `REQUEST_OVERLAP`, `INSUFFICIENT_BALANCE`, `ON_PROBATION`, `PERMISSION_LIMIT`, `TOO_LATE`, `NOT_A_WORK_DAY`',
    standardSchema: hrRequestSchema,
  })
  create(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: createHrRequestSchema }) input: CreateHrRequest,
  ): Promise<HrRequest> {
    return this.requests.create(actor, input);
  }

  @Get('requests')
  @RequireSession()
  @SerializeOptions({ schema: hrRequestPageSchema })
  @ApiOkResponse({
    description: "One's own requests, and those `hr.read` covers",
    standardSchema: hrRequestPageSchema,
  })
  list(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: hrRequestListQuerySchema }) query: HrRequestListQuery,
  ): Promise<HrRequestPage> {
    return this.requests.list(actor, query);
  }

  @Get('requests/:id')
  @RequireSession()
  @SerializeOptions({ schema: hrRequestDetailSchema })
  @ApiOkResponse({
    description:
      "A request with its opinions, and the employee's work in its days for `hr.approve`",
    standardSchema: hrRequestDetailSchema,
  })
  detail(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<HrRequestDetail> {
    return this.requests.detail(actor, id);
  }

  @Post('requests/:id/decision')
  @HttpCode(200)
  @RequirePermissions('hr.approve')
  @SerializeOptions({ schema: hrRequestSchema })
  @ApiOkResponse({
    description: 'Approve or reject a pending request. `NOT_PENDING`, `CERTIFICATE_MISSING`',
    standardSchema: hrRequestSchema,
  })
  decide(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: decideHrRequestSchema }) input: DecideHrRequest,
  ): Promise<HrRequest> {
    return this.requests.decide(actor, id, input);
  }

  @Post('requests/:id/cancel')
  @HttpCode(200)
  @RequireSession()
  @SerializeOptions({ schema: hrRequestSchema })
  @ApiOkResponse({
    description: 'Cancel a request: the owner or `hr.approve` (rule B15). `NOT_CANCELLABLE`',
    standardSchema: hrRequestSchema,
  })
  cancel(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: cancelHrRequestSchema }) input: CancelHrRequest,
  ): Promise<HrRequest> {
    return this.requests.cancel(actor, id, input);
  }

  @Post('opinions')
  @RequirePermissions('hr.read')
  @SerializeOptions({ schema: hrOpinionSchema })
  @ApiCreatedResponse({
    description: "An opinion on someone's pending request, in `hr.read` scope. `NOT_PENDING`",
    standardSchema: hrOpinionSchema,
  })
  opine(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: createHrOpinionSchema }) input: CreateHrOpinion,
  ): Promise<HrOpinion> {
    return this.requests.opine(actor, input);
  }
}
