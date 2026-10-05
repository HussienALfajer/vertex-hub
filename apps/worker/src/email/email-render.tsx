import { render } from '@react-email/render';
import {
  type ClientEmailKind,
  clientEmailKindSchema,
  EMAIL_DATA_SCHEMAS,
  type EmailSendJob,
  emailAudienceOf,
} from '@vertex-hub/contracts';
import {
  accountActivationEmail,
  type ClientEmailData,
  clientEmailContent,
  digestEmail,
  type EmailContent,
  newDeviceEmail,
  notificationBatchEmail,
  passwordResetEmail,
  securityNoticeEmail,
  testEmail,
} from '@vertex-hub/messages';
import { EmailLayout } from './email-layout.js';

type RenderedJob = Pick<EmailSendJob, 'kind' | 'data'> & Partial<Pick<EmailSendJob, 'message'>>;

const isClientKind = (kind: EmailSendJob['kind']): kind is ClientEmailKind =>
  clientEmailKindSchema.safeParse(kind).success;

/**
 * The content of a job's kind, from its data (validated again: the job crossed a queue), with
 * links into the web app at `appUrl`.
 */
export function emailContent(job: RenderedJob, appUrl: string): EmailContent {
  if (isClientKind(job.kind)) {
    const email = { kind: job.kind, data: EMAIL_DATA_SCHEMAS[job.kind].parse(job.data) };
    return clientEmailContent(email as ClientEmailData, job.message ?? null);
  }
  switch (job.kind) {
    case 'test':
      return testEmail(EMAIL_DATA_SCHEMAS.test.parse(job.data));
    case 'notification_batch':
      return notificationBatchEmail(EMAIL_DATA_SCHEMAS.notification_batch.parse(job.data), appUrl);
    case 'digest':
      return digestEmail(EMAIL_DATA_SCHEMAS.digest.parse(job.data), appUrl);
    case 'account_activation':
      return accountActivationEmail(EMAIL_DATA_SCHEMAS.account_activation.parse(job.data));
    case 'password_reset':
      return passwordResetEmail(EMAIL_DATA_SCHEMAS.password_reset.parse(job.data));
    case 'security_notice':
      return securityNoticeEmail(EMAIL_DATA_SCHEMAS.security_notice.parse(job.data));
    case 'new_device':
      return newDeviceEmail(EMAIL_DATA_SCHEMAS.new_device.parse(job.data));
    default:
      throw new Error(`No template for email kind ${job.kind}`);
  }
}

/** The HTML and plain-text bodies of an email. The subject is the job's, as queued. */
export async function renderEmail(
  job: RenderedJob,
  appUrl: string,
): Promise<{ html: string; text: string }> {
  const element = (
    <EmailLayout audience={emailAudienceOf(job.kind)} content={emailContent(job, appUrl)} />
  );
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { html, text };
}
