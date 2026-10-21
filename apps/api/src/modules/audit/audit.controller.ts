import { Controller, Get, Query, Req, SerializeOptions } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type AuditListQuery,
  type AuditPage,
  auditListQuerySchema,
  auditPageSchema,
  hasPermission,
  type UserAccess,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { AuditService } from './audit.service.js';

@ApiTags('audit')
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('audit.read')
  @SerializeOptions({ schema: auditPageSchema })
  @ApiOkResponse({ description: 'Audit entries, newest first', standardSchema: auditPageSchema })
  list(
    @Query({ schema: auditListQuerySchema }) query: AuditListQuery,
    // The permissions guard's user; `audit` does not depend on `auth` (docs/architecture.md).
    @Req() request: { currentUser?: { access: UserAccess } },
  ): Promise<AuditPage> {
    // F17: salary amounts and payout details are for `salaries.read` holders only.
    const access = request.currentUser?.access;
    return this.audit.list(query, { showsPay: !!access && hasPermission(access, 'salaries.read') });
  }
}
