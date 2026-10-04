// Public surface of the leads module. Code outside this folder imports from here only.
export {
  type LeadClosedHook,
  LeadClosedHooks,
  type LeadConversion,
  type LeadLoss,
  type LeadQuoteCheck,
  LeadQuoteChecks,
  type LeadRef,
} from './lead-closed-hooks.js';
export type { ConversionResult } from './lead-conversion.service.js';
export { LeadDirectory, type LeadSummary } from './lead-directory.js';
export { LeadPipeline } from './lead-pipeline.js';
export { LeadsModule } from './leads.module.js';
