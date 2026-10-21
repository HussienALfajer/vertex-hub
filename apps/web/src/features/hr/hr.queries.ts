import { keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ArchiveSalaryChange,
  CancelHrRequest,
  CreateHoliday,
  CreateHrOpinion,
  CreateHrRequest,
  CreateLeaveAdjustment,
  CreateSalaryChange,
  CreateWorkSchedule,
  DecideHrRequest,
  EmployeeListQuery,
  EndService,
  HrRequestListQuery,
  HrSettings,
  Payout,
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
};

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
      queryClient.invalidateQueries({ queryKey: hrKeys.request(input.requestId) }),
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
