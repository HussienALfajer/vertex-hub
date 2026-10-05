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

export interface EmailLink {
  label: string;
  url: string;
}

/** One line of a list: its text, a quieter detail line, and a link. */
export interface EmailListItem {
  text: string;
  detail: string | null;
  link: EmailLink | null;
}

/** A titled list, cut short with a link to the rest. */
export interface EmailSection {
  title: string;
  items: EmailListItem[];
  more: EmailLink | null;
}

/** The content of one email, laid out by the worker's template. */
export interface EmailContent {
  subject: string;
  heading: string;
  paragraphs: string[];
  /** Lists under the paragraphs (notifications, tasks). */
  sections?: EmailSection[];
  /** Client emails (rule 17): the document's key facts, a fixed block under the message. */
  facts?: { label: string; value: string }[];
  /** A button under the paragraphs and lists. */
  action?: EmailLink;
  /** Client emails (rule 17): the sender's name, title, phone and address, one per line. */
  signature?: string[];
  /** A last quiet line above the footer, with its link (the notification settings). */
  footnote?: { text: string; link: EmailLink };
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
