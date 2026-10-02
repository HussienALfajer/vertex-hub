import {
  keepPreviousData,
  type QueryKey,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  CancelMeeting,
  CancelShoot,
  CloseShoot,
  CreateMeeting,
  CreateShoot,
  ReopenShoot,
  ShotListInput,
  UpdateMeeting,
  UpdateShoot,
} from '@vertex-hub/contracts';
import { api, call } from '../../lib/api/client';
import type { paths } from '../../lib/api/schema.gen';

/** The calendar endpoint's query string as the API reads it. */
export type CalendarFilters = paths['/api/calendar']['get']['parameters']['query'];

export type ConflictFilters = paths['/api/calendar/conflicts']['get']['parameters']['query'];

export type ShootListFilters = NonNullable<paths['/api/shoots']['get']['parameters']['query']>;

export const calendarKeys = {
  all: ['calendar'] as const,
  range: (filters: CalendarFilters) => ['calendar', 'range', filters] as const,
  conflicts: (filters: ConflictFilters) => ['calendar', 'conflicts', filters] as const,
  shoots: (filters: ShootListFilters) => ['calendar', 'shoots', filters] as const,
  shoot: (id: string) => ['calendar', 'shoot', id] as const,
  meeting: (id: string) => ['calendar', 'meeting', id] as const,
};

export const calendarQuery = (filters: CalendarFilters) =>
  queryOptions({
    queryKey: calendarKeys.range(filters),
    queryFn: () => call(api.GET('/api/calendar', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

/** Rule 5 before saving: who of `userIds` is booked elsewhere in the time range. */
export const conflictsQuery = (filters: ConflictFilters) =>
  queryOptions({
    queryKey: calendarKeys.conflicts(filters),
    queryFn: () => call(api.GET('/api/calendar/conflicts', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

export const shootListQuery = (filters: ShootListFilters) =>
  queryOptions({
    queryKey: calendarKeys.shoots(filters),
    queryFn: () => call(api.GET('/api/shoots', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

export const shootQuery = (id: string) =>
  queryOptions({
    queryKey: calendarKeys.shoot(id),
    queryFn: () => call(api.GET('/api/shoots/{id}', { params: { path: { id } } })),
  });

export const meetingQuery = (id: string) =>
  queryOptions({
    queryKey: calendarKeys.meeting(id),
    queryFn: () => call(api.GET('/api/meetings/{id}', { params: { path: { id } } })),
  });

const WITH_TASKS: readonly QueryKey[] = [calendarKeys.all, ['tasks'], ['projects'], ['retainers']];

/**
 * A change to shoots or meetings, refreshing also on failure: a refusal after the shoot moved (edge cases 2
 * and 10) reloads the page with its current actions. Every change refreshes the whole `calendar`
 * cache; the ones that touch the shoot task (its due date, its delivery, the editing task) and
 * the retainer counter it feeds (rule 11) refresh those too.
 */
function useCalendarMutation<Input, Output>(
  mutationFn: (input: Input) => Promise<Output>,
  refreshes: readonly QueryKey[] = WITH_TASKS,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () =>
      Promise.all(refreshes.map((queryKey) => queryClient.invalidateQueries({ queryKey }))),
  });
}

const path = (id: string) => ({ params: { path: { id } } });

export const useCreateShoot = () =>
  useCalendarMutation((input: CreateShoot) => call(api.POST('/api/shoots', { body: input })));

export const useUpdateShoot = (id: string) =>
  useCalendarMutation((input: UpdateShoot) =>
    call(api.PATCH('/api/shoots/{id}', { ...path(id), body: input })),
  );

/** Rule 7: the whole shot list in its new order. */
export const useSaveShots = (id: string) =>
  useCalendarMutation(
    (input: ShotListInput) => call(api.PUT('/api/shoots/{id}/shots', { ...path(id), body: input })),
    [calendarKeys.shoot(id)],
  );

export const useTickShot = (id: string) =>
  useCalendarMutation(
    ({ shotId, done }: { shotId: string; done: boolean }) =>
      call(
        api.POST('/api/shoots/{id}/shots/{shotId}/done', {
          params: { path: { id, shotId } },
          body: { done },
        }),
      ),
    [calendarKeys.shoot(id)],
  );

export const useCloseShoot = (id: string) =>
  useCalendarMutation((input: CloseShoot) =>
    call(api.POST('/api/shoots/{id}/close', { ...path(id), body: input })),
  );

export const useCancelShoot = (id: string) =>
  useCalendarMutation((input: CancelShoot) =>
    call(api.POST('/api/shoots/{id}/cancel', { ...path(id), body: input })),
  );

export const useReopenShoot = (id: string) =>
  useCalendarMutation((input: ReopenShoot) =>
    call(api.POST('/api/shoots/{id}/reopen', { ...path(id), body: input })),
  );

export const useArchiveShoot = (id: string) =>
  useCalendarMutation(() => call(api.POST('/api/shoots/{id}/archive', path(id))));

export const useRestoreShoot = (id: string) =>
  useCalendarMutation(() => call(api.POST('/api/shoots/{id}/restore', path(id))));

/** A meeting touches no task: the `calendar` cache is all it refreshes. */
const CALENDAR_ONLY: readonly QueryKey[] = [calendarKeys.all];

export const useCreateMeeting = () =>
  useCalendarMutation(
    (input: CreateMeeting) => call(api.POST('/api/meetings', { body: input })),
    CALENDAR_ONLY,
  );

export const useUpdateMeeting = (id: string) =>
  useCalendarMutation(
    (input: UpdateMeeting) => call(api.PATCH('/api/meetings/{id}', { ...path(id), body: input })),
    CALENDAR_ONLY,
  );

export const useCancelMeeting = (id: string) =>
  useCalendarMutation(
    (input: CancelMeeting) =>
      call(api.POST('/api/meetings/{id}/cancel', { ...path(id), body: input })),
    CALENDAR_ONLY,
  );

export const useArchiveMeeting = (id: string) =>
  useCalendarMutation(() => call(api.POST('/api/meetings/{id}/archive', path(id))), CALENDAR_ONLY);

export const useRestoreMeeting = (id: string) =>
  useCalendarMutation(() => call(api.POST('/api/meetings/{id}/restore', path(id))), CALENDAR_ONLY);
