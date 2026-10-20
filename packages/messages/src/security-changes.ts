import type { SecurityChange } from '@vertex-hub/contracts';

/**
 * F14 email rule 14: what changed on an account, for the security email's subject and its text;
 * the in-app copy (F16 `security_notice`) shows `what` too.
 */
export const SECURITY_CHANGE_TEXT: Record<SecurityChange, { subject: string; what: string }> = {
  password_changed: { subject: 'تغيّرت كلمة مرورك', what: 'تغيّرت كلمة مرور حسابك' },
  two_factor_enabled: {
    subject: 'فُعّل التحقق بخطوتين',
    what: 'فُعّل التحقق بخطوتين لحسابك',
  },
  two_factor_disabled: {
    subject: 'أُوقف التحقق بخطوتين',
    what: 'أُوقف التحقق بخطوتين لحسابك',
  },
  two_factor_reset: {
    subject: 'أُعيد ضبط التحقق بخطوتين',
    what: 'أُعيد ضبط التحقق بخطوتين لحسابك',
  },
  backup_codes_regenerated: {
    subject: 'أُنشئت رموز احتياطية جديدة',
    what: 'أُنشئت رموز احتياطية جديدة لحسابك وأُلغيت السابقة',
  },
  roles_changed: { subject: 'تغيّرت أدوارك', what: 'تغيّرت الأدوار المسندة إليك' },
  archived: { subject: 'أُرشف حسابك', what: 'أُرشف حسابك ولم يعد بإمكانك الدخول' },
  device_signed_out: {
    subject: 'سُجّل الخروج من أحد أجهزتك',
    what: 'سُجّل خروج حسابك من أحد الأجهزة',
  },
  all_devices_signed_out: {
    subject: 'سُجّل الخروج من أجهزتك',
    what: 'سُجّل خروج حسابك من كل أجهزتك',
  },
};
