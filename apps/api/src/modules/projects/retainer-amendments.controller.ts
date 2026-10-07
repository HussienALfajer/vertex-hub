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
  type Amendment,
  type AmendmentListQuery,
  type AmendmentPage,
  type AmendmentPreview,
  type ApproveAmendment,
  amendmentListQuerySchema,
  amendmentPageSchema,
  amendmentPreviewSchema,
  amendmentSchema,
  approveAmendmentSchema,
  type CreateAmendment,
  createAmendmentSchema,
  type RejectAmendment,
  type RescheduleTerm,
  rejectAmendmentSchema,
  rescheduleTermSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { RetainerAmendmentsService } from './retainer-amendments.service.js';

/**
 * Amendments of a retainer (spec F05B A1–A9): changes need client scope and money access;
 * reductions wait for `retainers.approve_reduction`.
 */
@ApiTags('retainers')
@Controller('retainers/:retainerId')
export class RetainerAmendmentsController {
  constructor(private readonly amendments: RetainerAmendmentsService) {}

  @Get('amendments')
  @RequirePermissions('projects.read')
  @SerializeOptions({ schema: amendmentPageSchema })
  @ApiOkResponse({
    description: 'The retainer’s amendments, newest first; amounts only with money access',
    standardSchema: amendmentPageSchema,
  })
  list(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('retainerId', ParseUUIDPipe) retainerId: string,
    @Query({ schema: amendmentListQuerySchema }) query: AmendmentListQuery,
  ): Promise<AmendmentPage> {
    return this.amendments.list(actor, retainerId, query);
  }

  @Post('amendments')
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: amendmentSchema })
  @ApiCreatedResponse({
    description:
      'The new amendment: applied at once in the current month, scheduled for a later one, or ' +
      'pending approval when it reduces agreed amounts',
    standardSchema: amendmentSchema,
  })
  create(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('retainerId', ParseUUIDPipe) retainerId: string,
    @Body({ schema: createAmendmentSchema }) input: CreateAmendment,
  ): Promise<Amendment> {
    return this.amendments.create(actor, retainerId, input);
  }

  @Post('amendments/preview')
  @HttpCode(200)
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: amendmentPreviewSchema })
  @ApiOkResponse({
    description: 'What saving the amendment would do, per month; nothing is saved',
    standardSchema: amendmentPreviewSchema,
  })
  preview(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('retainerId', ParseUUIDPipe) retainerId: string,
    @Body({ schema: createAmendmentSchema }) input: CreateAmendment,
  ): Promise<AmendmentPreview> {
    return this.amendments.preview(actor, retainerId, input);
  }

  @Post('amendments/:amendmentId/approve')
  @HttpCode(200)
  @RequirePermissions('retainers.approve_reduction')
  @SerializeOptions({ schema: amendmentSchema })
  @ApiOkResponse({
    description: 'The approved amendment, checked again and applied or scheduled',
    standardSchema: amendmentSchema,
  })
  approve(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('retainerId', ParseUUIDPipe) retainerId: string,
    @Param('amendmentId', ParseUUIDPipe) amendmentId: string,
    @Body({ schema: approveAmendmentSchema }) input: ApproveAmendment,
  ): Promise<Amendment> {
    return this.amendments.approve(actor, retainerId, amendmentId, input);
  }

  @Post('amendments/:amendmentId/reject')
  @HttpCode(200)
  @RequirePermissions('retainers.approve_reduction')
  @SerializeOptions({ schema: amendmentSchema })
  @ApiOkResponse({ description: 'The rejected amendment', standardSchema: amendmentSchema })
  reject(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('retainerId', ParseUUIDPipe) retainerId: string,
    @Param('amendmentId', ParseUUIDPipe) amendmentId: string,
    @Body({ schema: rejectAmendmentSchema }) input: RejectAmendment,
  ): Promise<Amendment> {
    return this.amendments.reject(actor, retainerId, amendmentId, input);
  }

  @Post('amendments/:amendmentId/withdraw')
  @HttpCode(200)
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: amendmentSchema })
  @ApiOkResponse({
    description: 'The withdrawn amendment (its creator or a manager of the retainer)',
    standardSchema: amendmentSchema,
  })
  withdraw(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('retainerId', ParseUUIDPipe) retainerId: string,
    @Param('amendmentId', ParseUUIDPipe) amendmentId: string,
  ): Promise<Amendment> {
    return this.amendments.withdraw(actor, retainerId, amendmentId);
  }

  @Post('terms/:termId/reschedule')
  @HttpCode(200)
  @RequirePermissions('projects.manage')
  @SerializeOptions({ schema: amendmentSchema })
  @ApiOkResponse({
    description: 'The reschedule, applied at once: unbilled months of the term, same total',
    standardSchema: amendmentSchema,
  })
  reschedule(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('retainerId', ParseUUIDPipe) retainerId: string,
    @Param('termId', ParseUUIDPipe) termId: string,
    @Body({ schema: rescheduleTermSchema }) input: RescheduleTerm,
  ): Promise<Amendment> {
    return this.amendments.reschedule(actor, retainerId, termId, input);
  }
}
