import type { EmailAudience, EmailData } from '@vertex-hub/contracts';

/** The display name each audience sees in the sender (ADR 0028). */
export const EMAIL_SENDER_NAMES: Record<EmailAudience, string> = {
  staff: 'Vertex Hub',
  client: 'Vertex Media',
};

/** What every email shows around its content. */
export interface EmailLayoutText {
  /** The company line of the footer. */
  footer: string;
  /** Why the reader got the email. */
  reason: string;
}

export const EMAIL_LAYOUT_TEXT: Record<EmailAudience, EmailLayoutText> = {
  staff: {
    footer: 'Vertex Media · نظام Vertex Hub الداخلي',
    reason: 'وصلتك هذه الرسالة لأن لديك حسابًا في Vertex Hub.',
  },
  client: {
    footer: 'Vertex Media · شركة إعلام وتسويق متكاملة',
    reason: 'للرد على هذه الرسالة، استخدم الرد العادي في بريدك.',
  },
};

/** The content of one email, laid out by the worker's template. */
export interface EmailContent {
  subject: string;
  heading: string;
  paragraphs: string[];
  /** A button under the paragraphs. */
  action?: { label: string; url: string };
}

/** Rule 26: the email an administrator sends themselves to check the configuration. */
export function testEmail(data: EmailData<'test'>): EmailContent {
  return {
    subject: 'رسالة تجريبية من Vertex Hub',
    heading: 'إعدادات البريد تعمل',
    paragraphs: [
      `طلب ${data.requestedBy} إرسال هذه الرسالة للتأكد من إعدادات البريد.`,
      'إن وصلتك، فالنظام قادر على إرسال الرسائل.',
    ],
  };
}
