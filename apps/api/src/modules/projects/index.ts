// Public surface of the projects module. Code outside this folder imports from here only.
export { type BillingLockSource, BillingLocks } from './billing-locks.js';
export {
  type BillableWork,
  type BillingEngagement,
  type BillingMilestone,
  type BillingSource,
  BillingSources,
  cycleMonthName,
  type RetainerWork,
  sourceKey,
} from './billing-sources.js';
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
export { type CycleLineCounts, WorkProgress, type WorkProgressSource } from './work-progress.js';
