// Public surface of the email module. Code outside this folder imports from here only.
export { EmailModule } from './email.module.js';
export {
  type EmailFailureHandler,
  type EmailHistoryFilter,
  type EmailQueuedHandler,
  type EmailRecord,
  type EmailSentHandler,
  type FailedEmail,
  Mailer,
  type QueuedEmail,
  type QueuedEmailEvent,
  type SentEmail,
} from './mailer.js';
