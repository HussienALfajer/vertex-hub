import type { AdObjective, AdPlatform } from './campaigns.js';
import type { PostPlatform } from './post-values.js';
import type { ProjectStatus } from './projects.js';
import { type AgingBucket, responseTime } from './reports.js';
import type { CycleStatus, DeliverableKind } from './retainers.js';

/*
 * The Arabic names of the values that server-rendered report files print (F15 rule 24): the
 * API's Excel workbooks and the worker's monthly client report PDF. They match the web app's
 * `ar.json` strings for the same values; the web app keeps using i18next.
 */

export const REPORT_VALUE_LABELS: {
  deliverableKinds: Record<DeliverableKind, string>;
  cycleStatuses: Record<CycleStatus, string>;
  projectStatuses: Record<ProjectStatus, string>;
  postPlatforms: Record<PostPlatform, string>;
  adPlatforms: Record<AdPlatform, string>;
  adObjectives: Record<AdObjective, string>;
  agingBuckets: Record<AgingBucket, string>;
} = {
  deliverableKinds: {
    design: 'تصاميم',
    reel: 'ريلز',
    story: 'ستوري',
    post: 'منشورات',
    video: 'فيديو',
    photo_shoot: 'جلسات تصوير',
    ad_campaign: 'حملات إعلانية',
    monthly_report: 'تقرير شهري',
    other: 'أخرى',
  },
  cycleStatuses: { open: 'جارية', closed: 'مغلقة' },
  projectStatuses: {
    planned: 'مخطّط',
    active: 'جارٍ',
    on_hold: 'معلّق',
    completed: 'مكتمل',
    cancelled: 'ملغى',
  },
  postPlatforms: {
    instagram: 'إنستغرام',
    facebook: 'فيسبوك',
    tiktok: 'تيك توك',
    x: 'إكس',
    linkedin: 'لينكدإن',
    youtube: 'يوتيوب',
    snapchat: 'سناب شات',
    google_business: 'ملف غوغل التجاري',
  },
  adPlatforms: {
    meta: 'ميتا',
    google: 'غوغل',
    tiktok: 'تيك توك',
    snapchat: 'سناب شات',
    linkedin: 'لينكدإن',
    x: 'إكس',
    other: 'منصة أخرى',
  },
  adObjectives: {
    awareness: 'الوعي بالعلامة',
    traffic: 'الزيارات',
    engagement: 'التفاعل',
    messages: 'الرسائل',
    leads: 'العملاء المحتملون',
    sales: 'المبيعات',
    video_views: 'مشاهدات الفيديو',
    app_installs: 'تثبيت التطبيق',
    other: 'هدف آخر',
  },
  agingBuckets: {
    '1_30': '1–30 يومًا',
    '31_60': '31–60 يومًا',
    '61_90': '61–90 يومًا',
    over_90: 'أكثر من 90 يومًا',
  },
};

/** The monthly client report's titles and columns, shared by its Excel workbook and its PDF. */
export const CLIENT_REPORT_LABELS = {
  title: 'التقرير الشهري',
  preliminary: 'تقرير أولي: الشهر لم ينتهِ بعد',
  noActivity: 'لا نشاط مسجّل لهذا الشهر.',
  summary: 'ملخص الشهر',
  retainers: 'العقود الشهرية',
  kind: 'البند',
  committed: 'المتفق عليه',
  delivered: 'المسلَّم',
  percent: 'النسبة',
  completion: 'الإنجاز الكلي',
  projects: 'المشاريع',
  project: 'المشروع',
  status: 'الحالة',
  progress: 'المهام المسلّمة',
  milestonesDone: 'المراحل المنجزة هذا الشهر',
  deliveredWork: 'الأعمال المسلّمة',
  work: 'العمل',
  department: 'القسم',
  date: 'التاريخ',
  posts: 'المنشورات المنشورة',
  platforms: 'المنصات',
  postTitle: 'المنشور',
  links: 'الروابط',
  shoots: 'جلسات التصوير',
  shoot: 'الجلسة',
  location: 'المكان',
  approvals: 'الموافقات',
  approved: 'اعتُمد',
  changesRequested: 'طُلبت تعديلات',
  averageResponse: 'متوسط وقت الرد',
  campaigns: 'الحملات الإعلانية',
  platform: 'المنصة',
  campaign: 'الحملة',
  objective: 'الهدف',
  spend: 'الإنفاق (دولار)',
  reach: 'الوصول',
  clicks: 'النقرات',
  results: 'النتائج',
  costPerResult: 'تكلفة النتيجة (دولار)',
  total: 'الإجمالي',
  adBudget: 'الميزانية الإعلانية (دولار)',
  opening: 'الرصيد في بداية الشهر',
  deposits: 'الإيداعات',
  refunds: 'المبالغ المستردة',
  walletSpend: 'الإنفاق من الرصيد',
  closing: 'الرصيد في نهاية الشهر',
  nextMonth: 'الشهر القادم',
  plannedPosts: 'منشورات مجدولة',
  bookedShoots: 'جلسات تصوير محجوزة',
} as const;

const pluralRules = new Intl.PluralRules('ar');

/** Arabic forms by plural category; `{n}` is the number. Matches `reports.client.hours_*`. */
const RESPONSE_TIME_FORMS: Record<'hours' | 'days', Record<Intl.LDMLPluralRule, string>> = {
  hours: {
    zero: 'أقل من ساعة',
    one: 'ساعة واحدة',
    two: 'ساعتان',
    few: '{n} ساعات',
    many: '{n} ساعة',
    other: '{n} ساعة',
  },
  days: {
    zero: '{n} يوم',
    one: 'يوم واحد',
    two: 'يومان',
    few: '{n} أيام',
    many: '{n} يومًا',
    other: '{n} يوم',
  },
};

/** Rule 18.7's average response time as the report files print it, with Arabic plurals. */
export function responseTimeText(hours: number): string {
  const { unit, value } = responseTime(hours);
  return RESPONSE_TIME_FORMS[unit][pluralRules.select(value)].replace('{n}', String(value));
}
