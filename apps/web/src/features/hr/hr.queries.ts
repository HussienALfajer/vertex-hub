import { keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ArchiveSalaryChange,
  AttendanceItemListQuery,
  CancelHrRequest,
  CreateAttendanceKiosk,
  CreateHoliday,
  CreateHrOpinion,
  CreateHrRequest,
  CreateLeaveAdjustment,
  CreateSalaryChange,
  CreateWorkSchedule,
  DecideHrRequest,
  DecideItemInput,
  EmployeeListQuery,
  EndService,
  HrRequestListQuery,
  HrSettings,
  JustifyItem,
  MonthSheetQuery,
  Payout,
  PunchInput,
  PunchOptionsInput,
  RegisterPasskey,
  RejectPunch,
  ReopenMonth,
  RevokePasskey,
  TodayBoardQuery,
  UpdateEmployeeFile,
  UpdateHoliday,
  UpdateWorkScheduleInput,
} from '@vertex-hub/contracts';
import { api, call } from '../../lib/api/client';
import { calendarKeys } from '../calendar/calendar.queries';

export type EmployeeListFilters = Partial<EmployeeListQuery>;

export const hrKeys = {
  all: ['hr'] as const,
  employees: ['hr', 'employees'] as const,
  employeeList: (filters: EmployeeListFilters) => ['hr', 'employees', 'list', filters] as const,
  employee: (userId: string) => ['hr', 'employees', 'detail', userId] as const,
  salaries: (userId: string) => ['hr', 'employees', 'salaries', userId] as const,
  schedules: ['hr', 'schedules'] as const,
  holidays: ['hr', 'holidays'] as const,
  holidayYear: (year: number) => ['hr', 'holidays', year] as const,
  settings: ['hr', 'settings'] as const,
  balances: ['hr', 'balances'] as const,
  balance: (userId: string, year: number) => ['hr', 'balances', userId, year] as const,
  requests: ['hr', 'requests'] as const,
  requestList: (filters: HrRequestListFilters) => ['hr', 'requests', 'list', filters] as const,
  request: (id: string) => ['hr', 'requests', 'detail', id] as const,
  attendance: ['hr', 'attendance'] as const,
  myToday: ['hr', 'attendance', 'me', 'today'] as const,
  days: (userId: string, month: string) => ['hr', 'attendance', 'days', userId, month] as const,
  board: (filters: TodayBoardQuery) => ['hr', 'attendance', 'board', filters] as const,
  passkeys: ['hr', 'passkeys'] as const,
  passkeysOf: (userId: string) => ['hr', 'passkeys', userId] as const,
  kiosks: ['hr', 'kiosks'] as const,
  items: ['hr', 'items'] as const,
  itemList: (filters: AttendanceItemListFilters) => ['hr', 'items', 'list', filters] as const,
  item: (id: string) => ['hr', 'items', 'detail', id] as const,
  months: ['hr', 'months'] as const,
  month: (month: string, filters: MonthSheetQuery) => ['hr', 'months', month, filters] as const,
};

export type AttendanceItemListFilters = Partial<AttendanceItemListQuery>;

export type HrRequestListFilters = Partial<HrRequestListQuery>;

export const employeeListQuery = (filters: EmployeeListFilters) =>
  queryOptions({
    queryKey: hrKeys.employeeList(filters),
    queryFn: () => call(api.GET('/api/hr/employees', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

export const employeeQuery = (userId: string) =>
  queryOptions({
    queryKey: hrKeys.employee(userId),
    queryFn: () => call(api.GET('/api/hr/employees/{userId}', { params: { path: { userId } } })),
  });

export const salaryChangesQuery = (userId: string) =>
  queryOptions({
    queryKey: hrKeys.salaries(userId),
    queryFn: () =>
      call(api.GET('/api/hr/employees/{userId}/salaries', { params: { path: { userId } } })),
  });

/**
 * A file change shows in People and on the file; ending a service also changes the member's
 * account (F01), so the team lists refresh too.
 */
function useInvalidateEmployees() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: hrKeys.employees }),
      queryClient.invalidateQueries({ queryKey: ['users'] }),
    ]);
}

export function useUpdateEmployeeFile(userId: string) {
  const invalidate = useInvalidateEmployees();
  return useMutation({
    mutationFn: (input: UpdateEmployeeFile) =>
      call(api.PATCH('/api/hr/employees/{userId}', { params: { path: { userId } }, body: input })),
    onSuccess: invalidate,
  });
}

export function useSetPayout(userId: string) {
  const invalidate = useInvalidateEmployees();
  return useMutation({
    mutationFn: (input: Payout) =>
      call(
        api.PUT('/api/hr/employees/{userId}/payout', {
          params: { path: { userId } },
          body: input,
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useEndService(userId: string) {
  const invalidate = useInvalidateEmployees();
  return useMutation({
    mutationFn: (input: EndService) =>
      call(
        api.POST('/api/hr/employees/{userId}/end', { params: { path: { userId } }, body: input }),
      ),
    onSuccess: invalidate,
  });
}

export function useClearEnd(userId: string) {
  const invalidate = useInvalidateEmployees();
  return useMutation({
    mutationFn: () =>
      call(api.DELETE('/api/hr/employees/{userId}/end', { params: { path: { userId } } })),
    onSuccess: invalidate,
  });
}

/** A salary change moves the current salary on the file and in People. */
export function useAddSalaryChange(userId: string) {
  const invalidate = useInvalidateEmployees();
  return useMutation({
    mutationFn: (input: CreateSalaryChange) =>
      call(
        api.POST('/api/hr/employees/{userId}/salaries', {
          params: { path: { userId } },
          body: input,
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useArchiveSalaryChange() {
  const invalidate = useInvalidateEmployees();
  return useMutation({
    mutationFn: ({ id, ...input }: ArchiveSalaryChange & { id: string }) =>
      call(api.POST('/api/hr/salaries/{id}/archive', { params: { path: { id } }, body: input })),
    onSuccess: invalidate,
  });
}

// Part B: work schedules, public holidays and the HR settings.

export const workSchedulesQuery = queryOptions({
  queryKey: hrKeys.schedules,
  queryFn: () => call(api.GET('/api/hr/schedules')),
});

export const holidaysQuery = (year: number) =>
  queryOptions({
    queryKey: hrKeys.holidayYear(year),
    queryFn: () => call(api.GET('/api/hr/holidays', { params: { query: { year } } })),
    placeholderData: keepPreviousData,
  });

export const hrSettingsQuery = queryOptions({
  queryKey: hrKeys.settings,
  queryFn: () => call(api.GET('/api/hr/settings')),
});

/** A schedule's name and default show on the files and in People too. */
function useInvalidateSchedules() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: hrKeys.schedules }),
      queryClient.invalidateQueries({ queryKey: hrKeys.employees }),
    ]);
}

export function useCreateWorkSchedule() {
  const invalidate = useInvalidateSchedules();
  return useMutation({
    mutationFn: (input: CreateWorkSchedule) => call(api.POST('/api/hr/schedules', { body: input })),
    onSuccess: invalidate,
  });
}

export function useUpdateWorkSchedule() {
  const invalidate = useInvalidateSchedules();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateWorkScheduleInput & { id: string }) =>
      call(api.PATCH('/api/hr/schedules/{id}', { params: { path: { id } }, body: input })),
    onSuccess: invalidate,
  });
}

export function useArchiveWorkSchedule() {
  const invalidate = useInvalidateSchedules();
  return useMutation({
    mutationFn: (id: string) =>
      call(api.POST('/api/hr/schedules/{id}/archive', { params: { path: { id } } })),
    onSuccess: invalidate,
  });
}

/** Holidays show on the calendar as key dates (rule B16). */
function useInvalidateHolidays() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: hrKeys.holidays }),
      queryClient.invalidateQueries({ queryKey: calendarKeys.all }),
    ]);
}

export function useCreateHoliday() {
  const invalidate = useInvalidateHolidays();
  return useMutation({
    mutationFn: (input: CreateHoliday) => call(api.POST('/api/hr/holidays', { body: input })),
    onSuccess: invalidate,
  });
}

export function useUpdateHoliday() {
  const invalidate = useInvalidateHolidays();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateHoliday & { id: string }) =>
      call(api.PATCH('/api/hr/holidays/{id}', { params: { path: { id } }, body: input })),
    onSuccess: invalidate,
  });
}

export function useArchiveHoliday() {
  const invalidate = useInvalidateHolidays();
  return useMutation({
    mutationFn: (id: string) =>
      call(api.POST('/api/hr/holidays/{id}/archive', { params: { path: { id } } })),
    onSuccess: invalidate,
  });
}

/** "Repeat last year" (rule B3): the copies made, none when every one is already there. */
export function useRepeatHolidays() {
  const invalidate = useInvalidateHolidays();
  return useMutation({
    mutationFn: (year: number) => call(api.POST('/api/hr/holidays/repeat', { body: { year } })),
    onSuccess: invalidate,
  });
}

export function useUpdateHrSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: HrSettings) => call(api.PUT('/api/hr/settings', { body: input })),
    onSuccess: (settings) => queryClient.setQueryData(hrKeys.settings, settings),
  });
}

// Part B: leave balances, requests and their decisions.

export const leaveBalanceQuery = (userId: string, year: number) =>
  queryOptions({
    queryKey: hrKeys.balance(userId, year),
    queryFn: () =>
      call(
        api.GET('/api/hr/balances/{userId}', {
          params: { path: { userId }, query: { year } },
        }),
      ),
    placeholderData: keepPreviousData,
  });

export const hrRequestListQuery = (filters: HrRequestListFilters) =>
  queryOptions({
    queryKey: hrKeys.requestList(filters),
    queryFn: () => call(api.GET('/api/hr/requests', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

export const hrRequestQuery = (id: string) =>
  queryOptions({
    queryKey: hrKeys.request(id),
    queryFn: () => call(api.GET('/api/hr/requests/{id}', { params: { path: { id } } })),
  });

/** What a request would be (rules B9, B12, B13), asked again as the form changes. */
export const hrRequestPreviewQuery = (input: CreateHrRequest | null) =>
  queryOptions({
    queryKey: ['hr', 'requests', 'preview', input] as const,
    queryFn: () => call(api.POST('/api/hr/requests/preview', { body: input as CreateHrRequest })),
    enabled: !!input,
    placeholderData: keepPreviousData,
    retry: false,
  });

/**
 * A request change moves the balances (pending and taken days) and the calendar's leave entries
 * (rule B16).
 */
function useInvalidateRequests() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: hrKeys.requests }),
      queryClient.invalidateQueries({ queryKey: hrKeys.balances }),
      queryClient.invalidateQueries({ queryKey: calendarKeys.all }),
    ]);
}

export function useCreateHrRequest() {
  const invalidate = useInvalidateRequests();
  return useMutation({
    mutationFn: (input: CreateHrRequest) => call(api.POST('/api/hr/requests', { body: input })),
    onSuccess: invalidate,
  });
}

/** Refreshes also on failure: `NOT_PENDING` means someone else decided it meanwhile. */
export function useDecideHrRequest(id: string) {
  const invalidate = useInvalidateRequests();
  return useMutation({
    mutationFn: (input: DecideHrRequest) =>
      call(api.POST('/api/hr/requests/{id}/decision', { params: { path: { id } }, body: input })),
    onSettled: invalidate,
  });
}

export function useCancelHrRequest(id: string) {
  const invalidate = useInvalidateRequests();
  return useMutation({
    mutationFn: (input: CancelHrRequest) =>
      call(api.POST('/api/hr/requests/{id}/cancel', { params: { path: { id } }, body: input })),
    onSettled: invalidate,
  });
}

export function useAddHrOpinion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateHrOpinion) => call(api.POST('/api/hr/opinions', { body: input })),
    onSettled: (_opinion, _error, input) =>
      input.requestId
        ? queryClient.invalidateQueries({ queryKey: hrKeys.request(input.requestId) })
        : input.itemId
          ? queryClient.invalidateQueries({ queryKey: hrKeys.item(input.itemId) })
          : undefined,
  });
}

export function useAdjustLeaveBalance(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateLeaveAdjustment) =>
      call(
        api.POST('/api/hr/balances/{userId}/adjustments', {
          params: { path: { userId } },
          body: input,
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: hrKeys.balances }),
  });
}

// Part C: attendance passkeys, entrance screens, punches, days and items.

export const myAttendanceTodayQuery = queryOptions({
  queryKey: hrKeys.myToday,
  queryFn: () => call(api.GET('/api/hr/attendance/me/today')),
  // The methods change with the time of day (a shoot opens, the day ends).
  refetchInterval: 60_000,
});

export const attendanceDaysQuery = (userId: string, month: string) =>
  queryOptions({
    queryKey: hrKeys.days(userId, month),
    queryFn: () =>
      call(api.GET('/api/hr/attendance/days', { params: { query: { userId, month } } })),
    placeholderData: keepPreviousData,
  });

export const todayBoardQuery = (filters: TodayBoardQuery) =>
  queryOptions({
    queryKey: hrKeys.board(filters),
    queryFn: () => call(api.GET('/api/hr/attendance/today', { params: { query: filters } })),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

export const myPasskeysQuery = queryOptions({
  queryKey: hrKeys.passkeysOf('me'),
  queryFn: () => call(api.GET('/api/hr/passkeys/me')),
});

export const passkeysQuery = (userId: string) =>
  queryOptions({
    queryKey: hrKeys.passkeysOf(userId),
    queryFn: () => call(api.GET('/api/hr/passkeys', { params: { query: { userId } } })),
  });

export const kiosksQuery = queryOptions({
  queryKey: hrKeys.kiosks,
  queryFn: () => call(api.GET('/api/hr/kiosks')),
  // "Last seen" moves while the page is open.
  refetchInterval: 30_000,
});

export const attendanceItemListQuery = (filters: AttendanceItemListFilters) =>
  queryOptions({
    queryKey: hrKeys.itemList(filters),
    queryFn: () => call(api.GET('/api/hr/items', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

export const attendanceItemQuery = (id: string) =>
  queryOptions({
    queryKey: hrKeys.item(id),
    queryFn: () => call(api.GET('/api/hr/items/{id}', { params: { path: { id } } })),
  });

/** A punch, a rejection or a decision moves the days, the items and the Today board. */
function useInvalidateAttendance() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: hrKeys.attendance }),
      queryClient.invalidateQueries({ queryKey: hrKeys.items }),
    ]);
}

/** A passkey change shows on My attendance, the file, People and the requests (rule C9). */
function useInvalidatePasskeys() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: hrKeys.passkeys }),
      queryClient.invalidateQueries({ queryKey: hrKeys.myToday }),
      queryClient.invalidateQueries({ queryKey: hrKeys.employees }),
      queryClient.invalidateQueries({ queryKey: hrKeys.requests }),
    ]);
}

export function usePasskeyOptions() {
  return useMutation({ mutationFn: () => call(api.POST('/api/hr/passkeys/options')) });
}

export function useRegisterPasskey() {
  const invalidate = useInvalidatePasskeys();
  return useMutation({
    mutationFn: (input: RegisterPasskey) => call(api.POST('/api/hr/passkeys', { body: input })),
    onSuccess: invalidate,
  });
}

export function useRevokePasskey() {
  const invalidate = useInvalidatePasskeys();
  return useMutation({
    mutationFn: ({ id, ...input }: RevokePasskey & { id: string }) =>
      call(api.POST('/api/hr/passkeys/{id}/revoke', { params: { path: { id } }, body: input })),
    onSuccess: invalidate,
  });
}

export function usePunchOptions() {
  return useMutation({
    mutationFn: (input: PunchOptionsInput) =>
      call(api.POST('/api/hr/attendance/punch/options', { body: input })),
  });
}

export function usePunch() {
  const invalidate = useInvalidateAttendance();
  return useMutation({
    mutationFn: (input: PunchInput) => call(api.POST('/api/hr/attendance/punch', { body: input })),
    onSuccess: invalidate,
  });
}

export function useRejectPunch() {
  const invalidate = useInvalidateAttendance();
  return useMutation({
    mutationFn: ({ id, ...input }: RejectPunch & { id: string }) =>
      call(
        api.POST('/api/hr/attendance/punches/{id}/reject', {
          params: { path: { id } },
          body: input,
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useJustifyItem(id: string) {
  const invalidate = useInvalidateAttendance();
  return useMutation({
    mutationFn: (input: JustifyItem) =>
      call(api.POST('/api/hr/items/{id}/justification', { params: { path: { id } }, body: input })),
    onSettled: invalidate,
  });
}

/**
 * Refreshes also on failure: the item may have been decided or voided meanwhile. A time-off
 * decision moves the annual balance (rule C18).
 */
export function useDecideItem() {
  const invalidate = useInvalidateAttendance();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: DecideItemInput & { id: string }) =>
      call(api.POST('/api/hr/items/{id}/decision', { params: { path: { id } }, body: input })),
    onSettled: () =>
      Promise.all([invalidate(), queryClient.invalidateQueries({ queryKey: hrKeys.balances })]),
  });
}

export function useCreateKiosk() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAttendanceKiosk) => call(api.POST('/api/hr/kiosks', { body: input })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: hrKeys.kiosks }),
  });
}

export function useKioskPairingCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      call(api.POST('/api/hr/kiosks/{id}/pairing-code', { params: { path: { id } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: hrKeys.kiosks }),
  });
}

export function useArchiveKiosk() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      call(api.POST('/api/hr/kiosks/{id}/archive', { params: { path: { id } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: hrKeys.kiosks }),
  });
}

// Part D: attendance months.

export const monthSheetQuery = (month: string, filters: MonthSheetQuery) =>
  queryOptions({
    queryKey: hrKeys.month(month, filters),
    queryFn: () =>
      call(api.GET('/api/hr/months/{month}', { params: { path: { month }, query: filters } })),
    placeholderData: keepPreviousData,
  });

/** Rule D5: the workbooks, built by the API on request and served as downloads. */
export const monthExportUrls = {
  sheet: (month: string, { departmentId }: MonthSheetQuery) =>
    `/api/hr/months/${month}/export${departmentId ? `?departmentId=${departmentId}` : ''}`,
  employee: (userId: string, month: string) => `/api/hr/employees/${userId}/months/${month}/export`,
};

/**
 * Closing and reopening lock or free the month's punches, requests and decisions (rule D2), so
 * the days, items and requests refresh with the sheet.
 */
function useInvalidateMonths() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: hrKeys.months }),
      queryClient.invalidateQueries({ queryKey: hrKeys.attendance }),
      queryClient.invalidateQueries({ queryKey: hrKeys.items }),
      queryClient.invalidateQueries({ queryKey: hrKeys.requests }),
    ]);
}

/** Refreshes also on failure: an item raised by the closing's recompute holds the month (D2). */
export function useCloseMonth() {
  const invalidate = useInvalidateMonths();
  return useMutation({
    mutationFn: (month: string) =>
      call(api.POST('/api/hr/months/{month}/close', { params: { path: { month } } })),
    onSettled: invalidate,
  });
}

export function useReopenMonth() {
  const invalidate = useInvalidateMonths();
  return useMutation({
    mutationFn: ({ month, ...input }: ReopenMonth & { month: string }) =>
      call(api.POST('/api/hr/months/{month}/reopen', { params: { path: { month } }, body: input })),
    onSuccess: invalidate,
  });
}
