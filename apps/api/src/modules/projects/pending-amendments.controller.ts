import { Controller, Get, Query, SerializeOptions } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type PendingAmendmentListQuery,
  pendingAmendmentListQuerySchema,
  type RetainerAmendmentPage,
  retainerAmendmentPageSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { RetainerAmendmentsService } from './retainer-amendments.service.js';

/** Amendments waiting for the General Manager across retainers (spec F05B A4). */
@ApiTags('retainers')
@Controller('retainer-amendments')
export class PendingAmendmentsController {
  constructor(private readonly amendments: RetainerAmendmentsService) {}

  @Get()
  @RequirePermissions('retainers.approve_reduction')
  @SerializeOptions({ schema: retainerAmendmentPageSchema })
  @ApiOkResponse({
    description: 'Amendments pending approval with their retainer and client, oldest first',
    standardSchema: retainerAmendmentPageSchema,
  })
  list(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: pendingAmendmentListQuerySchema }) query: PendingAmendmentListQuery,
  ): Promise<RetainerAmendmentPage> {
    return this.amendments.pending(actor, query);
  }
}
