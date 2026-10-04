import { render } from '@react-email/render';
import { EMAIL_DATA_SCHEMAS, type EmailSendJob, emailAudienceOf } from '@vertex-hub/contracts';
import { type EmailContent, testEmail } from '@vertex-hub/messages';
import { EmailLayout } from './email-layout.js';

/** The content of a job's kind, from its data (validated again: the job crossed a queue). */
export function emailContent(job: Pick<EmailSendJob, 'kind' | 'data'>): EmailContent {
  switch (job.kind) {
    case 'test':
      return testEmail(EMAIL_DATA_SCHEMAS.test.parse(job.data));
    default:
      throw new Error(`No template for email kind ${job.kind}`);
  }
}

/** The HTML and plain-text bodies of an email. The subject is the job's, as queued. */
export async function renderEmail(
  job: Pick<EmailSendJob, 'kind' | 'data'>,
): Promise<{ html: string; text: string }> {
  const element = <EmailLayout audience={emailAudienceOf(job.kind)} content={emailContent(job)} />;
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { html, text };
}
