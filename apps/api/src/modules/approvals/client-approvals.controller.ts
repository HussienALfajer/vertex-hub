import { Controller, Get, Param, ParseUUIDPipe, Query, SerializeOptions } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type ClientApprovals,
  clientApprovalsSchema,
  type PageQuery,
  pageQuerySchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { ApprovalsService } from './approvals.service.js';

/** The Approvals tab of a client profile (spec F09, screen 7). */
@ApiTags('approvals')
@Controller('clients/:id/approvals')
export class ClientApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get()
  @RequirePermissions('tasks.read')
  @SerializeOptions({ schema: clientApprovalsSchema })
  @ApiOkResponse({
    description: 'The client’s approval requests and its responses, both newest first',
    standardSchema: clientApprovalsSchema,
  })
  @ApiNotFoundResponse({ description: 'No such client' })
  list(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) clientId: string,
    @Query({ schema: pageQuerySchema }) query: PageQuery,
  ): Promise<ClientApprovals> {
    return this.approvals.clientApprovals(actor, clientId, query);
  }
}
