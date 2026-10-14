import {
  type AnnexSnapshot,
  type CONTRACT_AGENCY_FIELDS,
  type CONTRACT_CLIENT_FIELDS,
  type ContractSnapshot,
  REPORT_VALUE_LABELS,
  type TermEndAction,
} from '@vertex-hub/contracts';
import { formatCalendarDate, formatMoney, formatNumber, formatPeriod } from './format.js';
import { fill } from './text.js';

/*
 * F05C K11: the texts of the contract and annex PDFs outside the editable articles (headings,
 * labels, preamble, block captions, end-action clauses, annex wording), shared by the worker's
 * templates and any API check that names them.
 */

export const CONTRACT_TEXT = {
  title: 'عقد تقديم خدمات',
  number: 'رقم العقد',
  date: 'تاريخ العقد',
  draft: 'مسودة',
  firstParty: 'الطرف الأول',
  secondParty: 'الطرف الثاني',
  preamble:
    'ويشار إلى الطرف الأول بـ«الوكالة» وإلى الطرف الثاني بـ«العميل»، وإليهما مجتمعين بـ«الطرفين».',
  article: 'المادة {{number}} — {{title}}',
  agencyFields: {
    legalName: 'الاسم القانوني',
    tradeName: 'الاسم التجاري',
    companyType: 'الشكل القانوني',
    registrationNumber: 'رقم السجل التجاري',
    address: 'العنوان',
    phone: 'الهاتف',
    email: 'البريد الإلكتروني',
    website: 'الموقع الإلكتروني',
    representativeName: 'الممثل القانوني',
    representativeTitle: 'الصفة',
  } satisfies Record<(typeof CONTRACT_AGENCY_FIELDS)[number], string>,
  clientFields: {
    signatoryName: 'الاسم الكامل',
    fatherName: 'اسم الأب',
    tradeName: 'الاسم التجاري',
    nationalId: 'الرقم الوطني',
    registrationNumber: 'رقم السجل التجاري',
    phone: 'الهاتف',
    email: 'البريد الإلكتروني',
    address: 'العنوان',
    title: 'الصفة',
  } satisfies Record<(typeof CONTRACT_CLIENT_FIELDS)[number], string>,
  signatures: {
    name: 'الاسم',
    title: 'الصفة',
    signature: 'التوقيع',
    stamp: 'الختم',
  },
  page: 'صفحة {{page}} من {{pages}}',
  services: {
    quote: 'وفق عرض السعر رقم {{number}}:',
    service: 'الخدمة',
    quantity: 'الكمية',
    deliverables: 'الكميات في كل دورة:',
    item: 'البند',
    perCycle: 'الكمية في كل دورة',
    revisions: 'جولات التعديل',
    none: 'لا توجد بنود محددة.',
  },
  term: {
    start: 'تاريخ البدء: {{date}}',
    cycles: 'عدد الدورات: {{cycles}}',
    end: 'تاريخ الانتهاء: {{date}}',
    cycleDay: 'تبدأ كل دورة في اليوم {{day}} من الشهر.',
    cycleDayClamped:
      'تبدأ كل دورة في اليوم {{day}} من الشهر، أو في آخر يوم منه إذا لم يوجد فيه هذا اليوم.',
    openEnded: 'يسري هذا العقد دون مدة محددة، دورةً بدورة، إلى أن ينهيه أحد الطرفين وفق أحكامه.',
  },
  endActions: {
    renew: 'يتجدد هذا العقد عند انتهاء مدته لمدة مماثلة بعقد جديد، ما لم يتفق الطرفان على غير ذلك.',
    end: 'ينتهي هذا العقد بانتهاء مدته.',
    continue:
      'عند انتهاء مدته تستمر الخدمة دورةً بدورة وفق أحكام هذا العقد، إلى أن ينهيها أحد الطرفين وفق أحكامه.',
  } satisfies Record<TermEndAction, string>,
  fees: {
    total: 'إجمالي الأتعاب المتفق عليها: {{amount}}',
    perCycle: 'أتعاب كل دورة: {{amount}}',
    cycle: 'الدورة',
    period: 'الفترة',
    amount: 'المبلغ',
  },
  annex: {
    title: 'ملحق رقم {{annex}} للعقد رقم {{contract}}',
    date: 'تاريخ الملحق',
    parties: 'بين {{agency}} («الوكالة») و{{client}} («العميل»).',
    intro: 'يُعد هذا الملحق جزءاً لا يتجزأ من العقد المذكور، وقد اتفق الطرفان على التعديل الآتي:',
    closing: 'تبقى سائر أحكام العقد سارية دون تعديل.',
    cycleOnly: 'للدورة {{cycle}} وحدها ({{period}}).',
    onward: 'ابتداءً من الدورة {{cycle}} ({{period}}).',
    reschedule: 'إعادة جدولة الأتعاب ابتداءً من الدورة {{cycle}} ({{period}}):',
    amountChange: 'تتغير أتعاب الدورة بمقدار {{amount}}.',
    reason: 'السبب: {{reason}}',
  },
} as const;

/** "المادة 3 — مدة العقد ودورات الخدمة". */
export function contractArticleHeading(article: { number: number; title: string }): string {
  return fill(CONTRACT_TEXT.article, {
    number: formatNumber(article.number),
    title: article.title,
  });
}

/** A deliverable line as the contract names it: its kind, or its label for `other`. */
export function contractDeliverableName(line: {
  kind: keyof typeof REPORT_VALUE_LABELS.deliverableKinds;
  label: string | null;
}): string {
  return line.label ?? REPORT_VALUE_LABELS.deliverableKinds[line.kind];
}

/** The `{term}` block's lines (K7): dates and cycles, the cycle day, the end action's clause. */
export function contractTermLines(term: ContractSnapshot['term']): string[] {
  const day = formatNumber(term.cycleDay);
  const cycleDay = fill(
    term.cycleDay > 28 ? CONTRACT_TEXT.term.cycleDayClamped : CONTRACT_TEXT.term.cycleDay,
    { day },
  );
  const start = fill(CONTRACT_TEXT.term.start, { date: formatCalendarDate(term.startDate) });
  if (term.kind === 'open_ended' || !term.cycles || !term.endDate || !term.endAction) {
    return [start, cycleDay, CONTRACT_TEXT.term.openEnded];
  }
  return [
    start,
    fill(CONTRACT_TEXT.term.cycles, { cycles: formatNumber(term.cycles) }),
    fill(CONTRACT_TEXT.term.end, { date: formatCalendarDate(term.endDate) }),
    cycleDay,
    CONTRACT_TEXT.endActions[term.endAction],
  ];
}

/** The `{fees}` block's caption: the agreed total of a term, or the fee per cycle. */
export function contractFeesCaption(fees: ContractSnapshot['fees']): string {
  if (fees.agreedTotalMinor !== null) {
    return fill(CONTRACT_TEXT.fees.total, {
      amount: formatMoney(fees.agreedTotalMinor, fees.currency),
    });
  }
  return fill(CONTRACT_TEXT.fees.perCycle, {
    amount: fees.feeMinor === null ? '' : formatMoney(fees.feeMinor, fees.currency),
  });
}

/** K10: the amendment an annex records, as sentences; a reschedule's table follows them. */
export function annexAmendmentLines(amendment: AnnexSnapshot['amendment']): string[] {
  const values = {
    cycle: formatNumber(amendment.effectiveCycle),
    period: formatPeriod(amendment.periodStart, amendment.periodEnd),
  };
  const lines: string[] = [];
  if (amendment.kind === 'reschedule') {
    lines.push(fill(CONTRACT_TEXT.annex.reschedule, values));
  } else {
    lines.push(
      fill(
        amendment.scope === 'cycle' ? CONTRACT_TEXT.annex.cycleOnly : CONTRACT_TEXT.annex.onward,
        values,
      ),
    );
    for (const line of amendment.lines) {
      const sign = line.quantityDelta > 0 ? '+' : '';
      lines.push(`${sign}${formatNumber(line.quantityDelta)} ${contractDeliverableName(line)}`);
    }
    if (amendment.amountDeltaMinor !== 0) {
      const sign = amendment.amountDeltaMinor > 0 ? '+' : '';
      lines.push(
        fill(CONTRACT_TEXT.annex.amountChange, {
          amount: `${sign}${formatMoney(amendment.amountDeltaMinor, amendment.currency)}`,
        }),
      );
    }
  }
  lines.push(fill(CONTRACT_TEXT.annex.reason, { reason: amendment.reason }));
  return lines;
}
