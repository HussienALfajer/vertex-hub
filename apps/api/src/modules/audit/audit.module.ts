import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';
import { AuditActorPhotos } from './audit-actor-photos.js';

/**
 * The audit log (ADR 0013): every module writes its entries with `recordAudit` inside the
 * transaction of the change; holders of `audit.read` read them here. Exports `AuditService` for
 * the entries another module shows (F17: the refused punches on the Today board).
 */
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditActorPhotos],
  exports: [AuditService, AuditActorPhotos],
})
export class AuditModule {}
