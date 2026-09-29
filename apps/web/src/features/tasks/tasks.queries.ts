import { keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
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

/** Every comment of a task, oldest first (a task holds far fewer than the page maximum). */
export const taskCommentsQuery = (id: string) =>
  queryOptions({
    queryKey: tasksKeys.comments(id),
    queryFn: () =>
      call(
        api.GET('/api/tasks/{id}/comments', {
          params: { path: { id }, query: { pageSize: 100 } },
        }),
      ),
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
 * A mutation on task data. Every one refreshes the whole `tasks` cache, also on failure: a 403
 * after the task changed hands (edge case 15) reloads the page without the lost actions. Task
 * counts show on projects and retainers (F05), so those refresh too.
 */
function useTasksMutation<Input, Output>(mutationFn: (input: Input) => Promise<Output>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: tasksKeys.all }),
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
        queryClient.invalidateQueries({ queryKey: ['retainers'] }),
      ]),
  });
}

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
  useTasksMutation((input: CreateTaskChecklistItem) =>
    call(api.POST('/api/tasks/{id}/checklist', { ...path(id), body: input })),
  );

export const useUpdateChecklistItem = (id: string) =>
  useTasksMutation(({ itemId, ...input }: UpdateTaskChecklistItem & { itemId: string }) =>
    call(api.PATCH('/api/tasks/{id}/checklist/{itemId}', { ...itemPath(id, itemId), body: input })),
  );

export const useReorderChecklist = (id: string) =>
  useTasksMutation((ids: string[]) =>
    call(api.PUT('/api/tasks/{id}/checklist/order', { ...path(id), body: { ids } })),
  );

export const useArchiveChecklistItem = (id: string) =>
  useTasksMutation((itemId: string) =>
    call(api.POST('/api/tasks/{id}/checklist/{itemId}/archive', itemPath(id, itemId))),
  );

export const useAddTaskLink = (id: string) =>
  useTasksMutation((input: CreateTaskLink) =>
    call(api.POST('/api/tasks/{id}/links', { ...path(id), body: input })),
  );

export const useArchiveTaskLink = (id: string) =>
  useTasksMutation((linkId: string) =>
    call(api.POST('/api/tasks/{id}/links/{linkId}/archive', { params: { path: { id, linkId } } })),
  );

// Comments

const commentPath = (id: string, commentId: string) => ({
  params: { path: { id, commentId } },
});

export const useAddComment = (id: string) =>
  useTasksMutation((input: TaskCommentInput) =>
    call(api.POST('/api/tasks/{id}/comments', { ...path(id), body: input })),
  );

export const useEditComment = (id: string) =>
  useTasksMutation(({ commentId, ...input }: TaskCommentInput & { commentId: string }) =>
    call(
      api.PATCH('/api/tasks/{id}/comments/{commentId}', {
        ...commentPath(id, commentId),
        body: input,
      }),
    ),
  );

export const useRemoveComment = (id: string) =>
  useTasksMutation((commentId: string) =>
    call(api.POST('/api/tasks/{id}/comments/{commentId}/archive', commentPath(id, commentId))),
  );
