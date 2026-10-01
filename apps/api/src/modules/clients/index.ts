// Public surface of the clients module. Code outside this folder imports from here only.

export {
  ClientDirectory,
  type ClientSummary,
  type ContactDetail,
  type ContactSummary,
} from './client-directory.js';
export {
  type ClientFlagHook,
  ClientFlagHooks,
  type HealthcareChange,
} from './client-flag-hooks.js';
export { ClientsModule } from './clients.module.js';
