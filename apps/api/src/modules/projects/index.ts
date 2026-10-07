// Public surface of the projects module. Code outside this folder imports from here only.
export { type BillingLockSource, BillingLocks } from './billing-locks.js';
export {
  type BillableWork,
  type BillingEngagement,
  type BillingMilestone,
  type BillingSource,
  BillingSources,
  cycleMonthName,
  type RetainerChargeRow,
  type RetainerWork,
  sourceKey,
} from './billing-sources.js';
export {
  type ChargeInvoice,
  type ChargeInvoiceSource,
  ChargeInvoices,
} from './charge-invoices.js';
export { type CycleOpened, CycleOpenedHooks } from './cycle-opened-hooks.js';
export {
  type CycleLineLink,
  type CycleLink,
  EngagementDirectory,
  type ExtraWorkLink,
  type KeyDateLink,
  type MilestoneLink,
  type ProjectLink,
  type RetainerLink,
} from './engagement-directory.js';
export {
  EngagementFactory,
  type RenewableRetainer,
  type RetainerRenewal,
} from './engagement-factory.js';
export {
  EngagementReports,
  type RetainerProgress,
} from './engagement-reports.js';
export { type MilestoneDone, MilestoneDoneHooks } from './milestone-done-hooks.js';
export { ProjectsModule } from './projects.module.js';
export { type RetainerChargeDue, RetainerChargeDueHooks } from './retainer-charge-due-hooks.js';
/** F05B C5, C9: credits taken off drafts and settled outside, for `invoices`. */
export { RetainerCharges } from './retainer-charges.js';
/** For the `retainers:run-daily` development script. */
export { RetainerCyclesService } from './retainer-cycles.service.js';
export { type CycleLineCounts, WorkProgress, type WorkProgressSource } from './work-progress.js';
