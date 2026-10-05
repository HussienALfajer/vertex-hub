import type { ClientEmailKind, EmailData } from '@vertex-hub/contracts';
import type { EmailContent } from './emails.js';
import {
  formatCalendarDate,
  formatDateTime,
  formatMoney,
  formatMonth,
  formatNumber,
} from './format.js';
import { fill } from './text.js';

/*
 * The client emails of F14 email (rules 16–23): the subject and message a person starts from in
 * the "Send by email" dialog, and the email the worker renders around the message they sent.
 */

/** What each kind is called in the history, the email log and the failure notice. */
export const CLIENT_EMAIL_KIND_NAMES: Record<ClientEmailKind, string> = {
  client_quote: 'عرض السعر',
  client_quote_reminder: 'تذكير بعرض السعر',
  client_approval_link: 'رابط الاعتماد',
  client_approval_reminder: 'تذكير بالاعتماد',
  client_invoice: 'الفاتورة',
  client_invoice_reminder: 'تذكير بفاتورة متأخرة',
  client_receipt: 'إيصال الدفع',
  client_statement: 'كشف الحساب',
  client_report: 'التقرير الشهري',
  client_ad_receipt: 'إيصال إيداع الإعلانات',
  client_ad_budget_low: 'تنبيه انخفاض رصيد الإعلانات',
};

/** A client email's kind with its template data. */
export type ClientEmailData = {
  [Kind in ClientEmailKind]: { kind: Kind; data: EmailData<Kind> };
}[ClientEmailKind];

const GREETING = 'مرحبًا،';

const QUOTE_AMOUNTS = {
  oneOff: '{{amount}} لمرة واحدة',
  monthly: '{{amount}} شهريًا',
  both: '{{oneOff}} و{{monthly}}',
};

const SUBJECTS: Record<ClientEmailKind, string> = {
  client_quote: 'عرض السعر {{number}}: {{title}}',
  client_quote_reminder: 'تذكير: عرض السعر {{number}} صالح حتى {{validUntil}}',
  client_approval_link: 'أعمال بانتظار اعتمادكم من Vertex Media',
  client_approval_reminder: 'تذكير: أعمال ما زالت بانتظار اعتمادكم',
  client_invoice: 'الفاتورة {{number}} من Vertex Media',
  client_invoice_reminder: 'تذكير: الفاتورة {{number}} متأخرة السداد',
  client_receipt: 'إيصال الدفع {{number}}',
  client_statement: 'كشف حساب {{client}} من {{from}} إلى {{to}}',
  client_report: 'التقرير الشهري لـ{{client}}: {{month}}',
  client_ad_receipt: 'إيصال إيداع رصيد الإعلانات {{number}}',
  client_ad_budget_low: 'رصيد إعلانات {{client}} منخفض',
};

/** The prefilled messages (rule 17); approval emails carry the request's message instead (rule 19). */
const MESSAGES: Record<Exclude<ClientEmailKind, `client_approval_${string}`>, string> = {
  client_quote:
    'يسعدنا أن نرسل إليكم عرض السعر {{number}} «{{title}}» بقيمة {{total}}، وهو صالح حتى {{validUntil}}. تجدون نسخته في المرفق.\n\nيسعدنا الإجابة عن أي سؤال.',
  client_quote_reminder:
    'نذكّركم بعرض السعر {{number}} «{{title}}» بقيمة {{total}}، وهو صالح حتى {{validUntil}}. تجدون نسخته في المرفق.\n\nنتطلع إلى ردكم.',
  client_invoice:
    'نرسل إليكم الفاتورة {{number}} بقيمة {{total}}، المستحقة في {{dueOn}}. تجدون نسختها في المرفق.',
  client_invoice_reminder:
    'نذكّركم بأن الفاتورة {{number}} المستحقة في {{dueOn}} لم تُسدَّد بالكامل بعد، والمبلغ المتبقي {{balance}}. تجدون نسختها في المرفق.\n\nإن كنتم قد سددتم المبلغ، فنرجو تجاهل هذا التذكير.',
  client_receipt:
    'نؤكد استلام دفعتكم بقيمة {{amount}} بتاريخ {{paidOn}} عن الفاتورة {{invoiceNumber}}. تجدون الإيصال {{number}} في المرفق.\n\nشكرًا لكم.',
  client_statement:
    'نرسل إليكم كشف حسابكم بعملة {{currency}} للفترة من {{from}} إلى {{to}}. تجدون الكشف في المرفق.',
  client_report: 'نرسل إليكم التقرير الشهري لأعمالنا معكم عن {{month}}. تجدون التقرير في المرفق.',
  client_ad_receipt:
    'نؤكد استلام إيداعكم في رصيد الإعلانات بقيمة {{amount}} بتاريخ {{occurredOn}}. تجدون الإيصال {{number}} في المرفق.\n\nشكرًا لكم.',
  client_ad_budget_low:
    'نود إعلامكم بأن رصيد حملاتكم الإعلانية أصبح {{balance}}، وهو أقل من حد التنبيه {{threshold}}. لتستمر الحملات دون توقف، نرجو إيداع رصيد جديد.',
};

const APPROVAL_TEXT = {
  greeting: 'مرحبًا {{contact}}،',
  link: 'أعددنا لكم أعمالًا بانتظار مراجعتكم واعتمادكم. افتحوا الرابط أدناه لمراجعة كل عمل والموافقة عليه أو طلب التعديل.',
  reminder:
    'نذكّركم بأن أعمالًا أرسلناها إليكم ما زالت بانتظار اعتمادكم. تجدون الرابط في رسالتنا السابقة، وهو صالح حتى {{expiresAt}}.',
  items: 'الأعمال المطلوب اعتمادها',
  action: 'مراجعة الأعمال واعتمادها',
};

const LABELS = {
  quoteNumber: 'رقم العرض',
  title: 'العنوان',
  total: 'الإجمالي',
  validUntil: 'صالح حتى',
  invoiceNumber: 'رقم الفاتورة',
  issuedOn: 'تاريخ الإصدار',
  dueOn: 'تاريخ الاستحقاق',
  balance: 'المتبقي',
  daysOverdue: 'أيام التأخير',
  receiptNumber: 'رقم الإيصال',
  invoice: 'الفاتورة',
  paidOn: 'تاريخ الدفع',
  amount: 'المبلغ',
  currency: 'العملة',
  period: 'الفترة',
  outstanding: 'الرصيد المستحق',
  month: 'الشهر',
  date: 'التاريخ',
  walletBalance: 'الرصيد الحالي',
  threshold: 'حد التنبيه',
  expiresAt: 'الرابط صالح حتى',
};

/** A quote's one-off and monthly nets, as the message names them. */
function quoteAmount(quote: EmailData<'client_quote'>['quote']): string {
  const oneOff =
    quote.oneOffMinor === null
      ? null
      : fill(QUOTE_AMOUNTS.oneOff, { amount: formatMoney(quote.oneOffMinor, quote.currency) });
  const monthly =
    quote.monthlyMinor === null
      ? null
      : fill(QUOTE_AMOUNTS.monthly, { amount: formatMoney(quote.monthlyMinor, quote.currency) });
  if (oneOff && monthly) return fill(QUOTE_AMOUNTS.both, { oneOff, monthly });
  return oneOff ?? monthly ?? formatMoney(0, quote.currency);
}

/** The values the subject and the message fill in, formatted. */
function values(email: ClientEmailData): Record<string, string> {
  const client = { client: email.data.client };
  switch (email.kind) {
    case 'client_quote':
    case 'client_quote_reminder': {
      const { quote } = email.data;
      return {
        ...client,
        number: quote.number,
        title: quote.title,
        total: quoteAmount(quote),
        validUntil: formatCalendarDate(quote.validUntil),
      };
    }
    case 'client_approval_link':
    case 'client_approval_reminder':
      return {
        ...client,
        contact: email.data.contact,
        expiresAt: formatDateTime(email.data.expiresAt),
      };
    case 'client_invoice':
    case 'client_invoice_reminder': {
      const { invoice } = email.data;
      return {
        ...client,
        number: invoice.number,
        total: formatMoney(invoice.total.amountMinor, invoice.total.currency),
        balance: formatMoney(invoice.balance.amountMinor, invoice.balance.currency),
        dueOn: formatCalendarDate(invoice.dueOn),
      };
    }
    case 'client_receipt': {
      const { receipt } = email.data;
      return {
        ...client,
        number: receipt.number,
        invoiceNumber: receipt.invoiceNumber,
        amount: formatMoney(receipt.amount.amountMinor, receipt.amount.currency),
        paidOn: formatCalendarDate(receipt.paidOn),
      };
    }
    case 'client_statement': {
      const { statement } = email.data;
      return {
        ...client,
        currency: statement.currency,
        from: formatCalendarDate(statement.from),
        to: formatCalendarDate(statement.to),
      };
    }
    case 'client_report':
      return { ...client, month: formatMonth(email.data.month) };
    case 'client_ad_receipt': {
      const { receipt } = email.data;
      return {
        ...client,
        number: receipt.number,
        amount: formatMoney(receipt.amount.amountMinor, receipt.amount.currency),
        occurredOn: formatCalendarDate(receipt.occurredOn),
      };
    }
    case 'client_ad_budget_low': {
      const { balanceMinor, thresholdMinor } = email.data;
      return {
        ...client,
        balance: formatMoney(balanceMinor, 'USD'),
        threshold: formatMoney(thresholdMinor, 'USD'),
      };
    }
  }
}

/**
 * Rule 17: the subject and message the dialog starts from, with the client, the document's
 * number, its amounts and dates filled in. Approval emails have no editable message (rule 19):
 * theirs is empty.
 */
export function clientEmailDraft(email: ClientEmailData): { subject: string; message: string } {
  const filled = values(email);
  const subject = fill(SUBJECTS[email.kind], filled);
  if (email.kind === 'client_approval_link' || email.kind === 'client_approval_reminder') {
    return { subject, message: '' };
  }
  return { subject, message: `${GREETING}\n\n${fill(MESSAGES[email.kind], filled)}` };
}

/** The document's key facts, the fixed block under the message (rule 17). */
function facts(email: ClientEmailData): { label: string; value: string }[] {
  const filled = values(email);
  switch (email.kind) {
    case 'client_quote':
    case 'client_quote_reminder':
      return [
        { label: LABELS.quoteNumber, value: filled.number ?? '' },
        { label: LABELS.title, value: filled.title ?? '' },
        { label: LABELS.total, value: filled.total ?? '' },
        { label: LABELS.validUntil, value: filled.validUntil ?? '' },
      ];
    case 'client_approval_link':
    case 'client_approval_reminder':
      return [{ label: LABELS.expiresAt, value: filled.expiresAt ?? '' }];
    case 'client_invoice':
    case 'client_invoice_reminder': {
      const rows = [
        { label: LABELS.invoiceNumber, value: filled.number ?? '' },
        { label: LABELS.issuedOn, value: formatCalendarDate(email.data.invoice.issuedOn) },
        { label: LABELS.dueOn, value: filled.dueOn ?? '' },
        { label: LABELS.total, value: filled.total ?? '' },
        { label: LABELS.balance, value: filled.balance ?? '' },
      ];
      return email.kind === 'client_invoice_reminder'
        ? [...rows, { label: LABELS.daysOverdue, value: formatNumber(email.data.daysOverdue) }]
        : rows;
    }
    case 'client_receipt':
      return [
        { label: LABELS.receiptNumber, value: filled.number ?? '' },
        { label: LABELS.invoice, value: filled.invoiceNumber ?? '' },
        { label: LABELS.paidOn, value: filled.paidOn ?? '' },
        { label: LABELS.amount, value: filled.amount ?? '' },
      ];
    case 'client_statement': {
      const { statement } = email.data;
      return [
        { label: LABELS.currency, value: statement.currency },
        { label: LABELS.period, value: `${filled.from} – ${filled.to}` },
        {
          label: LABELS.outstanding,
          value: formatMoney(statement.outstandingMinor, statement.currency),
        },
      ];
    }
    case 'client_report':
      return [{ label: LABELS.month, value: filled.month ?? '' }];
    case 'client_ad_receipt':
      return [
        { label: LABELS.receiptNumber, value: filled.number ?? '' },
        { label: LABELS.date, value: filled.occurredOn ?? '' },
        { label: LABELS.amount, value: filled.amount ?? '' },
      ];
    case 'client_ad_budget_low':
      return [
        { label: LABELS.walletBalance, value: filled.balance ?? '' },
        { label: LABELS.threshold, value: filled.threshold ?? '' },
      ];
  }
}

/** Plain text with line breaks as paragraphs; blank lines are dropped. */
const paragraphs = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

/**
 * The email the worker renders (rule 17): the message as sent, the document's facts, the approval
 * link's button, then the sender's signature. `message` is the dialog's text, or the approval
 * request's message (null when it has none).
 */
export function clientEmailContent(email: ClientEmailData, message: string | null): EmailContent {
  const filled = values(email);
  const { signature } = email.data;
  const content: EmailContent = {
    subject: fill(SUBJECTS[email.kind], filled),
    heading: CLIENT_EMAIL_KIND_NAMES[email.kind],
    paragraphs: paragraphs(message ?? ''),
    facts: facts(email),
    signature: [signature.name, signature.title, signature.phone, signature.email].filter(
      (line): line is string => !!line,
    ),
  };
  if (email.kind === 'client_approval_link' || email.kind === 'client_approval_reminder') {
    const intro =
      email.kind === 'client_approval_link' ? APPROVAL_TEXT.link : APPROVAL_TEXT.reminder;
    content.paragraphs = [
      fill(APPROVAL_TEXT.greeting, filled),
      fill(intro, filled),
      ...content.paragraphs,
    ];
    content.sections = [
      {
        title: APPROVAL_TEXT.items,
        items: email.data.items.map((item) => ({ text: item, detail: null, link: null })),
        more: null,
      },
    ];
  }
  if (email.kind === 'client_approval_link') {
    content.action = { label: APPROVAL_TEXT.action, url: email.data.link };
  }
  return content;
}
