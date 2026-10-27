import {
  keepPreviousData,
  type QueryKey,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  ConfirmOccasionDate,
  ContentPillarOrder,
  CreateContentIdea,
  CreateContentOccasion,
  CreateContentPillar,
  CreateContentSnippet,
  CreatePost,
  CreatePostTask,
  DropContentIdea,
  DuplicatePost,
  MedicalReview,
  MovePost,
  OccasionSkip,
  PostStatusChange,
  ReturnPostTask,
  UpdateClientContentSettingsInput,
  UpdateContentAgencySettings,
  UpdateContentIdea,
  UpdateContentOccasion,
  UpdateContentPillar,
  UpdateContentSnippet,
  UpdatePost,
  UpdatePostLayout,
} from '@vertex-hub/contracts';
import { api, call } from '../../lib/api/client';
import type { paths } from '../../lib/api/schema.gen';

/** The calendar endpoint's query string as the API reads it. */
export type ContentCalendarFilters = paths['/api/content/calendar']['get']['parameters']['query'];

export type PostListFilters = NonNullable<
  paths['/api/content/posts']['get']['parameters']['query']
>;

export type LinkableTaskFilters = NonNullable<
  paths['/api/content/posts/{id}/linkable-tasks']['get']['parameters']['query']
>;

export type SnippetFilters = NonNullable<
  paths['/api/content/snippets']['get']['parameters']['query']
>;

export type OccasionFilters = paths['/api/content/occasions']['get']['parameters']['query'];

export type IdeaFilters = NonNullable<paths['/api/content/ideas']['get']['parameters']['query']>;

export type PlanningFilters = paths['/api/content/planning']['get']['parameters']['query'];

export type GridFilters = paths['/api/content/grid']['get']['parameters']['query'];

export const contentKeys = {
  all: ['content'] as const,
  calendar: (filters: ContentCalendarFilters) => ['content', 'calendar', filters] as const,
  list: (filters: PostListFilters) => ['content', 'list', filters] as const,
  detail: (id: string) => ['content', 'detail', id] as const,
  summary: ['content', 'summary'] as const,
  linkable: (id: string, filters: LinkableTaskFilters) =>
    ['content', 'linkable', id, filters] as const,
  pillars: ['content', 'pillars'] as const,
  agencySettings: ['content', 'settings'] as const,
  clientSettings: (clientId: string) => ['content', 'settings', clientId] as const,
  snippets: (filters: SnippetFilters) => ['content', 'snippets', filters] as const,
  occasions: (filters: OccasionFilters) => ['content', 'occasions', filters] as const,
  ideas: (filters: IdeaFilters) => ['content', 'ideas', filters] as const,
  planning: (filters: PlanningFilters) => ['content', 'planning', filters] as const,
  grid: (filters: GridFilters) => ['content', 'grid', filters] as const,
  movePreview: (id: string, publishDate: string) =>
    ['content', 'move-preview', id, publishDate] as const,
};

export const contentCalendarQuery = (filters: ContentCalendarFilters) =>
  queryOptions({
    queryKey: contentKeys.calendar(filters),
    queryFn: () => call(api.GET('/api/content/calendar', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

export const postListQuery = (filters: PostListFilters) =>
  queryOptions({
    queryKey: contentKeys.list(filters),
    queryFn: () => call(api.GET('/api/content/posts', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

export const postQuery = (id: string) =>
  queryOptions({
    queryKey: contentKeys.detail(id),
    queryFn: () => call(api.GET('/api/content/posts/{id}', { params: { path: { id } } })),
  });

export const myContentSummaryQuery = queryOptions({
  queryKey: contentKeys.summary,
  queryFn: () => call(api.GET('/api/me/content/summary')),
});

/** The client's open unlinked tasks the post may link (rule 6). */
export const linkableTasksQuery = (id: string, filters: LinkableTaskFilters) =>
  queryOptions({
    queryKey: contentKeys.linkable(id, filters),
    queryFn: () =>
      call(
        api.GET('/api/content/posts/{id}/linkable-tasks', {
          params: { path: { id }, query: filters },
        }),
      ),
    placeholderData: keepPreviousData,
  });

// F08B planning data, read by the wizard and the caption editor

export const contentPillarsQuery = queryOptions({
  queryKey: contentKeys.pillars,
  queryFn: () => call(api.GET('/api/content/pillars')),
});

export const agencyContentSettingsQuery = queryOptions({
  queryKey: contentKeys.agencySettings,
  queryFn: () => call(api.GET('/api/content/settings')),
});

/** The client's settings with the agency's defaults resolved (best times, X long posts). */
export const clientContentSettingsQuery = (clientId: string) =>
  queryOptions({
    queryKey: contentKeys.clientSettings(clientId),
    queryFn: () =>
      call(api.GET('/api/content/clients/{clientId}/settings', { params: { path: { clientId } } })),
  });

/** The client's snippets and the agency's (rule A10). */
export const contentSnippetsQuery = (filters: SnippetFilters) =>
  queryOptions({
    queryKey: contentKeys.snippets(filters),
    queryFn: () => call(api.GET('/api/content/snippets', { params: { query: filters } })),
  });

export const contentOccasionsQuery = (filters: OccasionFilters) =>
  queryOptions({
    queryKey: contentKeys.occasions(filters),
    queryFn: () => call(api.GET('/api/content/occasions', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

export const contentIdeasQuery = (filters: IdeaFilters) =>
  queryOptions({
    queryKey: contentKeys.ideas(filters),
    queryFn: () => call(api.GET('/api/content/ideas', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

/** Rule C10: per client, the period's issues, the month's pillar balance and commitments. */
export const contentPlanningQuery = (filters: PlanningFilters) =>
  queryOptions({
    queryKey: contentKeys.planning(filters),
    queryFn: () => call(api.GET('/api/content/planning', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

/** Rule C11: a client's Instagram grid up to the end of a month. */
export const contentGridQuery = (filters: GridFilters) =>
  queryOptions({
    queryKey: contentKeys.grid(filters),
    queryFn: () => call(api.GET('/api/content/grid', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

/** Rule B7: the linked tasks' due dates before and after a move. */
export const movePreviewQuery = (id: string, publishDate: string) =>
  queryOptions({
    queryKey: contentKeys.movePreview(id, publishDate),
    queryFn: () =>
      call(
        api.GET('/api/content/posts/{id}/move-preview', {
          params: { path: { id }, query: { publishDate } },
        }),
      ),
  });

/** Rule A11: the publishing pack, streamed by the API as a zip. */
export const postPackUrl = (id: string) => `/api/content/posts/${id}/pack`;

/**
 * A change to posts, refreshing also on failure: a refusal after the post moved (edge case 1)
 * reloads the page with its current actions. Every change refreshes the whole `content` cache;
 * the ones that touch linked tasks, the retainer counters (rule 16) or the client's approval link
 * (rule 25) refresh those too.
 */
function useContentMutation<Input, Output>(
  mutationFn: (input: Input) => Promise<Output>,
  refreshes: readonly QueryKey[] = [contentKeys.all],
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () =>
      Promise.all(refreshes.map((queryKey) => queryClient.invalidateQueries({ queryKey }))),
  });
}

/** What a move, a link or an archive may change beside the post. */
const WITH_WORK: readonly QueryKey[] = [contentKeys.all, ['tasks'], ['retainers'], ['approvals']];

const path = (id: string) => ({ params: { path: { id } } });

const taskPath = (id: string, taskId: string) => ({ params: { path: { id, taskId } } });

/** The wizard's save: the post, its files, captions and tasks in one request (rule B2). */
export const useCreatePost = () =>
  useContentMutation(
    (input: CreatePost) => call(api.POST('/api/content/posts', { body: input })),
    WITH_WORK,
  );

/** Rule A6: the slide order and captions. */
export const useUpdatePostLayout = (id: string) =>
  useContentMutation((input: UpdatePostLayout) =>
    call(api.PUT('/api/content/posts/{id}/layout', { ...path(id), body: input })),
  );

/** Rules B6–B9: the move, shifting the linked tasks when asked. */
export const useMovePost = (id: string) =>
  useContentMutation(
    (input: MovePost) =>
      call(api.POST('/api/content/posts/{id}/move', { ...path(id), body: input })),
    WITH_WORK,
  );

export const useUpdatePost = (id: string) =>
  useContentMutation(
    (input: UpdatePost) => call(api.PATCH('/api/content/posts/{id}', { ...path(id), body: input })),
    // The counting line shows on the retainer's cycle.
    [contentKeys.all, ['retainers']],
  );

export const useChangePostStatus = (id: string) =>
  useContentMutation(
    (input: PostStatusChange) =>
      call(api.POST('/api/content/posts/{id}/status', { ...path(id), body: input })),
    WITH_WORK,
  );

/** The medical reviewer's answer on a post in the medical stage (rule 13). */
export const useMedicalReviewPost = (id: string) =>
  useContentMutation(
    (input: MedicalReview) =>
      call(api.POST('/api/content/posts/{id}/medical-review', { ...path(id), body: input })),
    WITH_WORK,
  );

/** The copy goes into the cache, so its page shows at once after the move to it. */
export const useDuplicatePost = (id: string) => {
  const queryClient = useQueryClient();
  return useContentMutation(async (input: DuplicatePost) => {
    const copy = await call(
      api.POST('/api/content/posts/{id}/duplicate', { ...path(id), body: input }),
    );
    queryClient.setQueryData(contentKeys.detail(copy.id), copy);
    return copy;
  });
};

export const useArchivePost = (id: string) =>
  useContentMutation(() => call(api.POST('/api/content/posts/{id}/archive', path(id))), WITH_WORK);

export const useRestorePost = (id: string) =>
  useContentMutation(() => call(api.POST('/api/content/posts/{id}/restore', path(id))), WITH_WORK);

// Linked tasks (rules 6–9, 12)

export const useLinkPostTask = (id: string) =>
  useContentMutation(
    (taskId: string) =>
      call(api.PUT('/api/content/posts/{id}/tasks/{taskId}', taskPath(id, taskId))),
    WITH_WORK,
  );

export const useUnlinkPostTask = (id: string) =>
  useContentMutation(
    (taskId: string) =>
      call(api.DELETE('/api/content/posts/{id}/tasks/{taskId}', taskPath(id, taskId))),
    WITH_WORK,
  );

export const useRequestPostTask = (id: string) =>
  useContentMutation(
    (input: CreatePostTask) =>
      call(api.POST('/api/content/posts/{id}/tasks', { ...path(id), body: input })),
    WITH_WORK,
  );

export const useReturnPostTask = (id: string) =>
  useContentMutation(
    ({ taskId, ...input }: ReturnPostTask & { taskId: string }) =>
      call(
        api.POST('/api/content/posts/{id}/tasks/{taskId}/return', {
          ...taskPath(id, taskId),
          body: input,
        }),
      ),
    WITH_WORK,
  );

// F08B settings: pillars, best times, client settings, occasions and snippets (screens 3 and 6)

export const useCreatePillar = () =>
  useContentMutation((input: CreateContentPillar) =>
    call(api.POST('/api/content/pillars', { body: input })),
  );

export const useUpdatePillar = () =>
  useContentMutation(({ id, ...input }: UpdateContentPillar & { id: string }) =>
    call(api.PATCH('/api/content/pillars/{id}', { ...path(id), body: input })),
  );

export const useOrderPillars = () =>
  useContentMutation((input: ContentPillarOrder) =>
    call(api.PUT('/api/content/pillars/order', { body: input })),
  );

export const useArchivePillar = () =>
  useContentMutation((id: string) => call(api.POST('/api/content/pillars/{id}/archive', path(id))));

export const useRestorePillar = () =>
  useContentMutation((id: string) => call(api.POST('/api/content/pillars/{id}/restore', path(id))));

export const useUpdateAgencySettings = () =>
  useContentMutation((input: UpdateContentAgencySettings) =>
    call(api.PUT('/api/content/settings', { body: input })),
  );

export const useUpdateClientSettings = (clientId: string) =>
  useContentMutation((input: UpdateClientContentSettingsInput) =>
    call(
      api.PUT('/api/content/clients/{clientId}/settings', {
        params: { path: { clientId } },
        body: input,
      }),
    ),
  );

/** Rule C6: "No post this year" for an occasion, and its undo. */
export const useSkipOccasion = (clientId: string) =>
  useContentMutation((input: OccasionSkip) =>
    call(
      api.POST('/api/content/clients/{clientId}/occasion-skips', {
        params: { path: { clientId } },
        body: input,
      }),
    ),
  );

export const useUnskipOccasion = (clientId: string) =>
  useContentMutation(({ occasionId, year }: OccasionSkip) =>
    call(
      api.DELETE('/api/content/clients/{clientId}/occasion-skips/{occasionId}/{year}', {
        params: { path: { clientId, occasionId, year } },
      }),
    ),
  );

export const useCreateOccasion = () =>
  useContentMutation((input: CreateContentOccasion) =>
    call(api.POST('/api/content/occasions', { body: input })),
  );

export const useUpdateOccasion = () =>
  useContentMutation(({ id, ...input }: UpdateContentOccasion & { id: string }) =>
    call(api.PATCH('/api/content/occasions/{id}', { ...path(id), body: input })),
  );

export const useArchiveOccasion = () =>
  useContentMutation((id: string) =>
    call(api.POST('/api/content/occasions/{id}/archive', path(id))),
  );

export const useRestoreOccasion = () =>
  useContentMutation((id: string) =>
    call(api.POST('/api/content/occasions/{id}/restore', path(id))),
  );

/** Rule C5: a manager's start for one year (a Hijri date after the moon sighting), or back to the computed one. */
export const useConfirmOccasionDate = () =>
  useContentMutation(({ id, year, ...input }: ConfirmOccasionDate & { id: string; year: number }) =>
    call(
      api.PUT('/api/content/occasions/{id}/dates/{year}', {
        params: { path: { id, year } },
        body: input,
      }),
    ),
  );

export const useClearOccasionDate = () =>
  useContentMutation(({ id, year }: { id: string; year: number }) =>
    call(
      api.DELETE('/api/content/occasions/{id}/dates/{year}', { params: { path: { id, year } } }),
    ),
  );

export const useCreateSnippet = () =>
  useContentMutation((input: CreateContentSnippet) =>
    call(api.POST('/api/content/snippets', { body: input })),
  );

export const useUpdateSnippet = () =>
  useContentMutation(({ id, ...input }: UpdateContentSnippet & { id: string }) =>
    call(api.PATCH('/api/content/snippets/{id}', { ...path(id), body: input })),
  );

export const useArchiveSnippet = () =>
  useContentMutation((id: string) =>
    call(api.POST('/api/content/snippets/{id}/archive', path(id))),
  );

// Ideas (rule C12)

export const useCreateIdea = () =>
  useContentMutation((input: CreateContentIdea) =>
    call(api.POST('/api/content/ideas', { body: input })),
  );

export const useUpdateIdea = () =>
  useContentMutation(({ id, ...input }: UpdateContentIdea & { id: string }) =>
    call(api.PATCH('/api/content/ideas/{id}', { ...path(id), body: input })),
  );

export const useDropIdea = () =>
  useContentMutation(({ id, ...input }: DropContentIdea & { id: string }) =>
    call(api.POST('/api/content/ideas/{id}/drop', { ...path(id), body: input })),
  );

export const useRestoreIdea = () =>
  useContentMutation((id: string) => call(api.POST('/api/content/ideas/{id}/restore', path(id))));
