import { Controller, Get, Query, SerializeOptions } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type AuditListQuery,
  type AuditPage,
  auditListQuerySchema,
  auditPageSchema,
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
  list(@Query({ schema: auditListQuerySchema }) query: AuditListQuery): Promise<AuditPage> {
    return this.audit.list(query);
  }
}
