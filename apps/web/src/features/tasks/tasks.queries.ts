import {
  infiniteQueryOptions,
  keepPreviousData,
  type QueryKey,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  CreateTask,
  CreateTaskChecklistItem,
  CreateTaskLink,
  RevisionDecisionInput,
  TaskCommentInput,
  TaskDependenciesInput,
  TaskStatusChange,
  UpdateTask,
  UpdateTaskChecklistItem,
} from '@vertex-hub/contracts';
import { api, call } from '../../lib/api/client';
import type { paths } from '../../lib/api/schema.gen';

/** The list endpoint's query string as the API reads it: flags are `'true'` or `'false'`. */
export type TaskListFilters = NonNullable<paths['/api/tasks']['get']['parameters']['query']>;

export type TaskBoardFilters = NonNullable<paths['/api/tasks/board']['get']['parameters']['query']>;

export type TaskWorkloadFilters = NonNullable<
  paths['/api/tasks/workload']['get']['parameters']['query']
>;

export const tasksKeys = {
  all: ['tasks'] as const,
  list: (filters: TaskListFilters) => ['tasks', 'list', filters] as const,
  detail: (id: string) => ['tasks', 'detail', id] as const,
  comments: (id: string) => ['tasks', 'comments', id] as const,
  summary: ['tasks', 'summary'] as const,
  board: (filters: TaskBoardFilters) => ['tasks', 'board', filters] as const,
  workload: (filters: TaskWorkloadFilters) => ['tasks', 'workload', filters] as const,
};

export const taskListQuery = (filters: TaskListFilters) =>
  queryOptions({
    queryKey: tasksKeys.list(filters),
    queryFn: () => call(api.GET('/api/tasks', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

export const taskQuery = (id: string) =>
  queryOptions({
    queryKey: tasksKeys.detail(id),
    queryFn: () => call(api.GET('/api/tasks/{id}', { params: { path: { id } } })),
  });

const COMMENTS_PAGE_SIZE = 50;

/** The page param of the newest page, before the total is known. */
const NEWEST_COMMENTS = 0;

/**
 * A task's comments, shown oldest first: the newest page loads first, older pages on request
 * ("Show older"), so a long conversation always shows its latest comments. The API pages oldest
 * first, so the newest page is found from the total.
 */
export const taskCommentsQuery = (id: string) =>
  infiniteQueryOptions({
    queryKey: tasksKeys.comments(id),
    queryFn: async ({ pageParam }) => {
      const page = (number: number) =>
        call(
          api.GET('/api/tasks/{id}/comments', {
            params: { path: { id }, query: { page: number, pageSize: COMMENTS_PAGE_SIZE } },
          }),
        );
      if (pageParam !== NEWEST_COMMENTS) return page(pageParam);
      const first = await page(1);
      const last = Math.max(1, Math.ceil(first.total / first.pageSize));
      return last === 1 ? first : page(last);
    },
    initialPageParam: NEWEST_COMMENTS,
    getNextPageParam: () => undefined,
    getPreviousPageParam: (oldest) => (oldest.page > 1 ? oldest.page - 1 : undefined),
  });

export const myTaskSummaryQuery = queryOptions({
  queryKey: tasksKeys.summary,
  queryFn: () => call(api.GET('/api/me/tasks/summary')),
});

export const taskBoardQuery = (filters: TaskBoardFilters) =>
  queryOptions({
    queryKey: tasksKeys.board(filters),
    queryFn: () => call(api.GET('/api/tasks/board', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

export const taskWorkloadQuery = (filters: TaskWorkloadFilters) =>
  queryOptions({
    queryKey: tasksKeys.workload(filters),
    queryFn: () => call(api.GET('/api/tasks/workload', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

/**
 * A mutation on task data, refreshing `refreshes` also on failure: a 403 after the task changed
 * hands (edge case 15) reloads the page without the lost actions. By default the whole `tasks`
 * cache, and projects, retainers and monthly templates, which show task counts (F05, F07).
 * Parts that change no count refresh less: the checklist only task views (its progress shows in
 * lists), links and comments only their task.
 */
function useTasksMutation<Input, Output>(
  mutationFn: (input: Input) => Promise<Output>,
  refreshes: readonly QueryKey[] = [
    tasksKeys.all,
    ['projects'],
    ['retainers'],
    ['templates', 'retainer'],
  ],
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () =>
      Promise.all(refreshes.map((queryKey) => queryClient.invalidateQueries({ queryKey }))),
  });
}

/** What a link or comment change refreshes: the task and its conversation. */
const ownTask = (id: string): QueryKey[] => [tasksKeys.detail(id), tasksKeys.comments(id)];

const path = (id: string) => ({ params: { path: { id } } });

export const useCreateTask = () =>
  useTasksMutation((input: CreateTask) => call(api.POST('/api/tasks', { body: input })));

export const useUpdateTask = (id: string) =>
  useTasksMutation((input: UpdateTask) =>
    call(api.PATCH('/api/tasks/{id}', { ...path(id), body: input })),
  );

export const useChangeTaskStatus = (id: string) =>
  useTasksMutation((input: TaskStatusChange) =>
    call(api.POST('/api/tasks/{id}/status', { ...path(id), body: input })),
  );

/** A status change on any task: the board moves many cards through one mutation. */
export const useMoveTask = () =>
  useTasksMutation(({ id, ...input }: TaskStatusChange & { id: string }) =>
    call(api.POST('/api/tasks/{id}/status', { ...path(id), body: input })),
  );

export const useSetTaskDependencies = (id: string) =>
  useTasksMutation((input: TaskDependenciesInput) =>
    call(api.PUT('/api/tasks/{id}/dependencies', { ...path(id), body: input })),
  );

export const useDecideRevision = (id: string) =>
  useTasksMutation(({ revisionId, ...input }: RevisionDecisionInput & { revisionId: string }) =>
    call(
      api.POST('/api/tasks/{id}/revisions/{revisionId}/decision', {
        params: { path: { id, revisionId } },
        body: input,
      }),
    ),
  );

export const useArchiveTask = (id: string) =>
  useTasksMutation(() => call(api.POST('/api/tasks/{id}/archive', path(id))));

export const useRestoreTask = (id: string) =>
  useTasksMutation(() => call(api.POST('/api/tasks/{id}/restore', path(id))));

// Checklist and links

const itemPath = (id: string, itemId: string) => ({ params: { path: { id, itemId } } });

export const useAddChecklistItem = (id: string) =>
  useTasksMutation(
    (input: CreateTaskChecklistItem) =>
      call(api.POST('/api/tasks/{id}/checklist', { ...path(id), body: input })),
    [tasksKeys.all],
  );

export const useUpdateChecklistItem = (id: string) =>
  useTasksMutation(
    ({ itemId, ...input }: UpdateTaskChecklistItem & { itemId: string }) =>
      call(
        api.PATCH('/api/tasks/{id}/checklist/{itemId}', { ...itemPath(id, itemId), body: input }),
      ),
    [tasksKeys.all],
  );

export const useReorderChecklist = (id: string) =>
  useTasksMutation(
    (ids: string[]) =>
      call(api.PUT('/api/tasks/{id}/checklist/order', { ...path(id), body: { ids } })),
    [tasksKeys.all],
  );

export const useArchiveChecklistItem = (id: string) =>
  useTasksMutation(
    (itemId: string) =>
      call(api.POST('/api/tasks/{id}/checklist/{itemId}/archive', itemPath(id, itemId))),
    [tasksKeys.all],
  );

export const useAddTaskLink = (id: string) =>
  useTasksMutation(
    (input: CreateTaskLink) =>
      call(api.POST('/api/tasks/{id}/links', { ...path(id), body: input })),
    ownTask(id),
  );

export const useArchiveTaskLink = (id: string) =>
  useTasksMutation(
    (linkId: string) =>
      call(
        api.POST('/api/tasks/{id}/links/{linkId}/archive', { params: { path: { id, linkId } } }),
      ),
    ownTask(id),
  );

// Comments

const commentPath = (id: string, commentId: string) => ({
  params: { path: { id, commentId } },
});

export const useAddComment = (id: string) =>
  useTasksMutation(
    (input: TaskCommentInput) =>
      call(api.POST('/api/tasks/{id}/comments', { ...path(id), body: input })),
    ownTask(id),
  );

export const useEditComment = (id: string) =>
  useTasksMutation(
    ({ commentId, ...input }: TaskCommentInput & { commentId: string }) =>
      call(
        api.PATCH('/api/tasks/{id}/comments/{commentId}', {
          ...commentPath(id, commentId),
          body: input,
        }),
      ),
    ownTask(id),
  );

export const useRemoveComment = (id: string) =>
  useTasksMutation(
    (commentId: string) =>
      call(api.POST('/api/tasks/{id}/comments/{commentId}/archive', commentPath(id, commentId))),
    ownTask(id),
  );
