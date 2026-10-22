import type { ServerResponse } from 'node:http';
import {
  type AttendanceDay,
  type AttendanceDayKind,
  type AttendanceDayStatus,
  type AttendanceItemKind,
  type AttendanceItemStatus,
  type AttendancePlace,
  businessTimeOfDay,
  type DayLeave,
  type MonthSheet,
  type PunchDirection,
  type PunchMethod,
} from '@vertex-hub/contracts';
import ExcelJS from 'exceljs';
import { contentDisposition } from '../files/index.js';

/*
 * The Excel files of an attendance month (rule D5, as the F15 reports): right-to-left sheets,
 * Arabic headers, dates as dates, durations in hours.
 */

export const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const LABELS = {
  month: {
    sheet: 'الشهر',
    employee: 'الموظف',
    workDays: 'أيام العمل',
    presentDays: 'أيام الحضور',
    remoteDays: 'عن بُعد',
    fieldDays: 'ميداني',
    absentDays: 'أيام الغياب',
    annual: 'إجازة سنوية',
    sick: 'إجازة مرضية',
    emergency: 'إجازة طارئة',
    unpaid: 'إجازة بلا راتب',
    unpaidLeaveDays: 'أيام إجازة غير مدفوعة',
    holidayDays: 'عطل رسمية',
    lateCount: 'مرات التأخير',
    deductedDays: 'الأيام المخصومة',
    overtimePaid: 'عمل إضافي مدفوع (ساعة)',
    overtimeTimeOff: 'عمل إضافي رصيد إجازة (ساعة)',
    worked: 'ساعات العمل',
    pendingRequests: 'طلبات معلّقة',
    pendingItems: 'بنود معلّقة',
  },
  employee: {
    sheet: 'الأيام',
    date: 'التاريخ',
    kind: 'نوع اليوم',
    status: 'الحالة',
    place: 'المكان',
    leave: 'الإجازة',
    firstIn: 'أول حضور',
    lastOut: 'آخر انصراف',
    worked: 'ساعات العمل',
    late: 'التأخير (دقيقة)',
    early: 'الخروج المبكر (دقيقة)',
    overtime: 'العمل الإضافي (دقيقة)',
    punches: 'الحركات',
    items: 'البنود',
  },
  kinds: { work: 'يوم عمل', off: 'يوم عطلة', holiday: 'عطلة رسمية' },
  statuses: {
    upcoming: 'قادم',
    in_progress: 'جارٍ',
    present: 'حاضر',
    partial: 'ناقص',
    absent: 'غائب',
    leave: 'إجازة',
    holiday: 'عطلة رسمية',
    off: 'عطلة',
    trial: 'تجريبي',
  },
  places: { office: 'المكتب', remote: 'عن بُعد' },
  leaves: { none: null, full: 'يوم كامل', first_half: 'النصف الأول', second_half: 'النصف الثاني' },
  directions: { in: 'حضور', out: 'انصراف' },
  methods: {
    office: 'المكتب',
    remote: 'عن بُعد',
    field: 'ميداني',
    shoot: 'تصوير',
    correction: 'تصحيح',
  },
  rejected: 'مرفوض',
  itemKinds: {
    lateness: 'تأخير',
    early_leave: 'خروج مبكر',
    absence: 'غياب',
    missing_out: 'انصراف غير مسجّل',
    overtime: 'عمل إضافي',
  },
  itemStatuses: {
    pending: 'بانتظار القرار',
    deducted: 'خُصم',
    waived: 'عُفي',
    warned: 'إنذار',
    paid: 'يُدفع',
    time_off: 'رصيد إجازة',
    rejected: 'مرفوض',
    void: 'ملغى',
  },
} satisfies {
  kinds: Record<AttendanceDayKind, string>;
  statuses: Record<AttendanceDayStatus, string>;
  places: Record<AttendancePlace, string>;
  leaves: Record<DayLeave, string | null>;
  directions: Record<PunchDirection, string>;
  methods: Record<PunchMethod, string>;
  itemKinds: Record<AttendanceItemKind, string>;
  itemStatuses: Record<AttendanceItemStatus, string>;
  [key: string]: unknown;
};

type Cell = string | number | Date | null;

interface Column {
  header: string;
  width?: number;
  format?: 'date' | 'hours' | 'days';
}

const FORMATS = { date: 'yyyy-mm-dd', hours: '0.00', days: '0.0#' } as const;

/** A calendar date as an Excel date (midnight UTC, so the day never shifts). */
const day = (date: string) => new Date(`${date}T00:00:00Z`);

const hours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

const time = (at: string | null) => (at ? businessTimeOfDay(new Date(at)) : null);

function addSheet(workbook: ExcelJS.Workbook, name: string, columns: Column[], rows: Cell[][]) {
  const sheet = workbook.addWorksheet(name, {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = columns.map((column) => ({
    header: column.header,
    width: column.width ?? 14,
    style: column.format ? { numFmt: FORMATS[column.format] } : {},
  }));
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) sheet.addRow(row);
}

async function build(fill: (workbook: ExcelJS.Workbook) => void): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Vertex Hub';
  fill(workbook);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Rule D5: one row per employee with the month's totals. */
export function monthWorkbook(sheet: MonthSheet): Promise<Buffer> {
  const L = LABELS.month;
  return build((workbook) =>
    addSheet(
      workbook,
      `${L.sheet} ${sheet.month.month}`,
      [
        { header: L.employee, width: 24 },
        { header: L.workDays },
        { header: L.presentDays },
        { header: L.remoteDays },
        { header: L.fieldDays },
        { header: L.absentDays, format: 'days' },
        { header: L.annual, format: 'days' },
        { header: L.sick, format: 'days' },
        { header: L.emergency, format: 'days' },
        { header: L.unpaid, format: 'days' },
        { header: L.unpaidLeaveDays, width: 20, format: 'days' },
        { header: L.holidayDays },
        { header: L.lateCount },
        { header: L.deductedDays, width: 16, format: 'days' },
        { header: L.overtimePaid, width: 22, format: 'hours' },
        { header: L.overtimeTimeOff, width: 26, format: 'hours' },
        { header: L.worked, format: 'hours' },
        { header: L.pendingRequests },
        { header: L.pendingItems },
      ],
      sheet.rows.map((row) => {
        const t = row.totals;
        return [
          row.user.name,
          t.workDays,
          t.presentDays,
          t.remoteDays,
          t.fieldDays,
          t.absentDays,
          t.leaveDays.annual ?? 0,
          t.leaveDays.sick ?? 0,
          t.leaveDays.emergency ?? 0,
          t.leaveDays.unpaid ?? 0,
          t.unpaidLeaveDays,
          t.holidayDays,
          t.lateCount,
          t.deductedDays,
          hours(t.overtimePaidMinutes),
          hours(t.overtimeTimeOffMinutes),
          hours(t.workedMinutes),
          row.pendingRequests,
          row.pendingItems,
        ];
      }),
    ),
  );
}

export interface WorkbookItem {
  date: string;
  kind: AttendanceItemKind;
  status: AttendanceItemStatus;
}

/** Rule D5: an employee's month, one row per day with its punches and items. */
export function employeeMonthWorkbook(
  days: readonly AttendanceDay[],
  items: readonly WorkbookItem[],
): Promise<Buffer> {
  const L = LABELS.employee;
  return build((workbook) =>
    addSheet(
      workbook,
      L.sheet,
      [
        { header: L.date, width: 12, format: 'date' },
        { header: L.kind, width: 12 },
        { header: L.status, width: 12 },
        { header: L.place, width: 10 },
        { header: L.leave, width: 12 },
        { header: L.firstIn, width: 10 },
        { header: L.lastOut, width: 10 },
        { header: L.worked, width: 12, format: 'hours' },
        { header: L.late, width: 14 },
        { header: L.early, width: 18 },
        { header: L.overtime, width: 18 },
        { header: L.punches, width: 48 },
        { header: L.items, width: 36 },
      ],
      days.map((row) => [
        day(row.date),
        LABELS.kinds[row.kind],
        LABELS.statuses[row.status],
        row.place ? LABELS.places[row.place] : null,
        LABELS.leaves[row.leave],
        time(row.firstInAt),
        time(row.lastOutAt),
        hours(row.workedMinutes),
        row.lateMinutes,
        row.earlyMinutes,
        row.overtimeMinutes,
        row.punches
          .map((punch) =>
            [
              LABELS.directions[punch.direction],
              time(punch.at),
              LABELS.methods[punch.method],
              punch.archivedAt ? `(${LABELS.rejected})` : null,
            ]
              .filter(Boolean)
              .join(' '),
          )
          .join('، ') || null,
        items
          .filter((item) => item.date === row.date)
          .map((item) => `${LABELS.itemKinds[item.kind]}: ${LABELS.itemStatuses[item.status]}`)
          .join('، ') || null,
      ]),
    ),
  );
}

/** Sends an Excel file built on request as a download; never cached. */
export function sendWorkbook(response: ServerResponse, name: string, file: Buffer): void {
  response.statusCode = 200;
  response.setHeader('Content-Type', XLSX_MIME_TYPE);
  response.setHeader('Content-Length', file.length);
  response.setHeader('Content-Disposition', contentDisposition(false, name));
  response.setHeader('Cache-Control', 'no-store');
  response.end(file);
}
