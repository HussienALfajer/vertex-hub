import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';

/**
 * The audit log (ADR 0013): every module writes its entries with `recordAudit` inside the
 * transaction of the change; holders of `audit.read` read them here.
 */
@Module({
  controllers: [AuditController],
  providers: [AuditService],
})
export class AuditModule {}
