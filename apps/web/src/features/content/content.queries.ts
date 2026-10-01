import {
  keepPreviousData,
  type QueryKey,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  CreatePost,
  CreatePostTask,
  DuplicatePost,
  MedicalReview,
  PostStatusChange,
  ReturnPostTask,
  UpdatePost,
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

export const contentKeys = {
  all: ['content'] as const,
  calendar: (filters: ContentCalendarFilters) => ['content', 'calendar', filters] as const,
  list: (filters: PostListFilters) => ['content', 'list', filters] as const,
  detail: (id: string) => ['content', 'detail', id] as const,
  summary: ['content', 'summary'] as const,
  linkable: (id: string, filters: LinkableTaskFilters) =>
    ['content', 'linkable', id, filters] as const,
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

export const useCreatePost = () =>
  useContentMutation((input: CreatePost) => call(api.POST('/api/content/posts', { body: input })));

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

export const useDuplicatePost = (id: string) =>
  useContentMutation((input: DuplicatePost) =>
    call(api.POST('/api/content/posts/{id}/duplicate', { ...path(id), body: input })),
  );

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
