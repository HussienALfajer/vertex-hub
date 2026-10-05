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
import {
  ApiAcceptedResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  type ApprovalReady,
  type ApprovalReadyQuery,
  type ApprovalRequestDetail,
  type ApprovalRequestListQuery,
  type ApprovalRequestPage,
  approvalReadyQuerySchema,
  approvalReadySchema,
  approvalRequestDetailSchema,
  approvalRequestListQuerySchema,
  approvalRequestPageSchema,
  type CreateApprovalRequest,
  createApprovalRequestSchema,
  type EmailHistory,
  type EmailSummary,
  emailHistorySchema,
  emailSummarySchema,
  type IssuedApprovalRequest,
  issuedApprovalRequestSchema,
  type ReissueApprovalRequest,
  reissueApprovalRequestSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { ApprovalsService } from './approvals.service.js';

/** Approval requests (spec F09): sending needs client scope, which the service checks. */
@ApiTags('approvals')
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get('ready')
  @RequirePermissions('tasks.manage')
  @SerializeOptions({ schema: approvalReadySchema })
  @ApiOkResponse({
    description:
      'Tasks and posts ready to send under the caller’s client scope, grouped by client; `month` keeps the posts of one publish month',
    standardSchema: approvalReadySchema,
  })
  ready(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: approvalReadyQuerySchema }) query: ApprovalReadyQuery,
  ): Promise<ApprovalReady> {
    return this.approvals.ready(actor, query);
  }

  @Get('requests')
  @RequirePermissions('tasks.read')
  @SerializeOptions({ schema: approvalRequestPageSchema })
  @ApiOkResponse({
    description: 'Approval requests, newest first; open and expired unless `state` says otherwise',
    standardSchema: approvalRequestPageSchema,
  })
  list(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: approvalRequestListQuerySchema }) query: ApprovalRequestListQuery,
  ): Promise<ApprovalRequestPage> {
    return this.approvals.list(actor, query);
  }

  @Get('requests/:id')
  @RequirePermissions('tasks.read')
  @SerializeOptions({ schema: approvalRequestDetailSchema })
  @ApiOkResponse({
    description: 'A request with its items and the snapshots they sent',
    standardSchema: approvalRequestDetailSchema,
  })
  @ApiNotFoundResponse({ description: 'No such request' })
  detail(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApprovalRequestDetail> {
    return this.approvals.detail(actor, id);
  }

  @Post('requests')
  @RequirePermissions('tasks.manage')
  @SerializeOptions({ schema: issuedApprovalRequestSchema })
  @ApiCreatedResponse({
    description: 'The new request with its link, shown only now',
    standardSchema: issuedApprovalRequestSchema,
  })
  @ApiConflictResponse({
    description:
      '`CLIENT_ARCHIVED`, `CONTACT_NOT_APPROVER`, `TASK_NOT_READY`, `POST_NOT_READY`, `MEDICAL_REVIEW_REQUIRED`, `LIMIT_REACHED`, `CONTACT_NO_EMAIL`',
  })
  create(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: createApprovalRequestSchema }) input: CreateApprovalRequest,
  ): Promise<IssuedApprovalRequest> {
    return this.approvals.create(actor, input);
  }

  @Post('requests/:id/reissue')
  @HttpCode(200)
  @RequirePermissions('tasks.manage')
  @SerializeOptions({ schema: issuedApprovalRequestSchema })
  @ApiOkResponse({
    description: 'The request with a new link valid 7 days, shown only now; the old one stops',
    standardSchema: issuedApprovalRequestSchema,
  })
  @ApiConflictResponse({
    description: '`REQUEST_CLOSED`, `CONTACT_NOT_APPROVER`, `CLIENT_ARCHIVED`, `CONTACT_NO_EMAIL`',
  })
  reissue(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: reissueApprovalRequestSchema }) input: ReissueApprovalRequest,
  ): Promise<IssuedApprovalRequest> {
    return this.approvals.reissue(actor, id, input);
  }

  @Post('requests/:id/email-reminder')
  @HttpCode(202)
  @RequirePermissions('tasks.manage')
  @SerializeOptions({ schema: emailSummarySchema })
  @ApiAcceptedResponse({
    description: 'A reminder by email to the contact, without the link (F14 email rule 19)',
    standardSchema: emailSummarySchema,
  })
  @ApiConflictResponse({
    description:
      '`REQUEST_CLOSED`, `REMINDER_NOT_DUE`, `CONTACT_NO_EMAIL`, `CLIENT_ARCHIVED`, `INVALID_RECIPIENT`',
  })
  emailReminder(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EmailSummary> {
    return this.approvals.emailReminder(actor, id);
  }

  @Get('requests/:id/emails')
  @RequirePermissions('tasks.read')
  @SerializeOptions({ schema: emailHistorySchema })
  @ApiOkResponse({
    description: "The request's emails, newest first (F14 email screen 5)",
    standardSchema: emailHistorySchema,
  })
  @ApiNotFoundResponse({ description: 'No such request' })
  emails(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EmailHistory> {
    return this.approvals.emails(actor, id);
  }

  @Post('requests/:id/revoke')
  @HttpCode(200)
  @RequirePermissions('tasks.manage')
  @SerializeOptions({ schema: approvalRequestDetailSchema })
  @ApiOkResponse({
    description:
      'The revoked request: its pending items are withdrawn, the tasks and posts ready again',
    standardSchema: approvalRequestDetailSchema,
  })
  @ApiConflictResponse({ description: '`REQUEST_CLOSED`' })
  revoke(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApprovalRequestDetail> {
    return this.approvals.revoke(actor, id);
  }
}
