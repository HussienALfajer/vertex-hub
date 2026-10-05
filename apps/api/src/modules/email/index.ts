// Public surface of the email module. Code outside this folder imports from here only.
export { EmailModule } from './email.module.js';
export {
  type EmailFailureHandler,
  type EmailHistoryFilter,
  type EmailRecord,
  type FailedEmail,
  Mailer,
  type QueuedEmail,
} from './mailer.js';
