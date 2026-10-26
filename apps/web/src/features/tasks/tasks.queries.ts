import {
  infiniteQueryOptions,
  keepPreviousData,
  type QueryKey,
  queryOptions,
  skipToken,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  CreateSubtask,
  CreateTask,
  CreateTaskChecklistItem,
  CreateTaskLink,
  CreateTaskStage,
  HandoverNoteInput,
  MedicalReview,
  QuestionStatus,
  ReopenSubtasks,
  RevisionDecisionInput,
  SubtaskOrder,
  SubtaskRunMode,
  TaskClientTextInput,
  TaskCommentInput,
  TaskCommentKind,
  TaskCommentUpdate,
  TaskDependenciesInput,
  TaskQuestionInput,
  TaskReadinessInput,
  TaskStatusChange,
  UpdateTask,
  UpdateTaskChecklistItem,
  UpdateTaskStage,
} from '@vertex-hub/contracts';
import { api, call } from '../../lib/api/client';
import type { paths } from '../../lib/api/schema.gen';

/** The list endpoint's query string as the API reads it: flags are `'true'` or `'false'`. */
export type TaskListFilters = NonNullable<paths['/api/tasks']['get']['parameters']['query']>;

export type TaskBoardFilters = NonNullable<paths['/api/tasks/board']['get']['parameters']['query']>;

export type TaskWorkloadFilters = NonNullable<
  paths['/api/tasks/workload']['get']['parameters']['query']
>;

export type TaskTreeFilters = NonNullable<paths['/api/tasks/tree']['get']['parameters']['query']>;

export const tasksKeys = {
  all: ['tasks'] as const,
  list: (filters: TaskListFilters) => ['tasks', 'list', filters] as const,
  detail: (id: string) => ['tasks', 'detail', id] as const,
  comments: (id: string, filter?: TaskThreadFilter) =>
    filter ? (['tasks', 'comments', id, filter] as const) : (['tasks', 'comments', id] as const),
  myQuestions: (status: QuestionStatus) => ['tasks', 'my-questions', status] as const,
  summary: ['tasks', 'summary'] as const,
  board: (filters: TaskBoardFilters) => ['tasks', 'board', filters] as const,
  workload: (filters: TaskWorkloadFilters) => ['tasks', 'workload', filters] as const,
  tree: (filters: TaskTreeFilters) => ['tasks', 'tree', filters] as const,
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

/** The thread's filter (F06B screen 2): everything, or the open questions only. */
export type TaskThreadFilter = 'all' | 'open_questions';

const threadQuery = (
  filter: TaskThreadFilter,
): { kind?: TaskCommentKind; status?: QuestionStatus } =>
  filter === 'open_questions' ? { kind: 'question', status: 'open' } : {};

const COMMENTS_PAGE_SIZE = 50;

/** The page param of the newest page, before the total is known. */
const NEWEST_COMMENTS = 0;

/**
 * A task's comments, shown oldest first: the newest page loads first, older pages on request
 * ("Show older"), so a long conversation always shows its latest comments. The API pages oldest
 * first, so the newest page is found from the total.
 */
export const taskCommentsQuery = (id: string, filter: TaskThreadFilter = 'all') =>
  infiniteQueryOptions({
    queryKey: tasksKeys.comments(id, filter),
    queryFn: async ({ pageParam }) => {
      const page = (number: number) =>
        call(
          api.GET('/api/tasks/{id}/comments', {
            params: {
              path: { id },
              query: { page: number, pageSize: COMMENTS_PAGE_SIZE, ...threadQuery(filter) },
            },
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

/** Rule B7: the open questions waiting for the caller's answer, oldest asked first. */
export const myQuestionsQuery = (status: QuestionStatus = 'open') =>
  queryOptions({
    queryKey: tasksKeys.myQuestions(status),
    queryFn: () =>
      call(api.GET('/api/me/questions', { params: { query: { status, pageSize: 50 } } })),
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

/** F06B rule D4: a project's or a retainer cycle's tasks as a tree, with the bottleneck. */
export const taskTreeQuery = (filters: TaskTreeFilters) =>
  queryOptions({
    queryKey: tasksKeys.tree(filters),
    queryFn: () => call(api.GET('/api/tasks/tree', { params: { query: filters } })),
  });

/** F06B rule C5: the readiness warnings of a draft (none until it has one); they never block. */
export const taskReadinessQuery = (input: TaskReadinessInput | null) =>
  queryOptions({
    queryKey: ['tasks', 'readiness', input] as const,
    queryFn: input ? () => call(api.POST('/api/tasks/readiness', { body: input })) : skipToken,
    placeholderData: keepPreviousData,
    retry: false,
  });

/**
 * A mutation on task data, refreshing `refreshes` also on failure: a 403 after the task changed
 * hands (edge case 15) reloads the page without the lost actions. By default the whole `tasks`
 * cache, and projects, retainers and monthly templates, which show task counts (F05, F07), and
 * approvals, which list the tasks ready to send (F09), and content: a post shows its linked tasks
 * and their final files (F08), and the calendar: a shoot shows its tasks (F11), and files: a
 * delivered or cancelled task's files turn read-only and an approval marks finals (F10 rules 5, 9).
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
    ['approvals'],
    ['content'],
    ['calendar'],
    ['files'],
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

/**
 * What a question or a thread change refreshes: the task (its open questions), the lists' badges,
 * My tasks' questions and the files (attachments, rule B2).
 */
const THREAD: QueryKey[] = [tasksKeys.all, ['files']];

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

/** The medical reviewer's answer on a task in the medical stage (F09 rules 4 and 5). */
export const useMedicalReview = (id: string) =>
  useTasksMutation((input: MedicalReview) =>
    call(api.POST('/api/tasks/{id}/medical-review', { ...path(id), body: input })),
  );

export const useSetClientText = (id: string) =>
  useTasksMutation(
    (input: TaskClientTextInput) =>
      call(api.PUT('/api/tasks/{id}/client-text', { ...path(id), body: input })),
    [tasksKeys.detail(id)],
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

/** A comment, or a reply to a question; its attachments are held uploads (rule B2). */
export const useAddComment = (id: string) =>
  useTasksMutation(
    (input: TaskCommentInput) =>
      call(api.POST('/api/tasks/{id}/comments', { ...path(id), body: input })),
    THREAD,
  );

/** Rule B1: a question to a person or a department. */
export const useAskQuestion = (id: string) =>
  useTasksMutation(
    (input: TaskQuestionInput) =>
      call(api.POST('/api/tasks/{id}/questions', { ...path(id), body: input })),
    THREAD,
  );

const questionPath = (id: string, questionId: string) => ({
  params: { path: { id, questionId } },
});

/** Rule B4: answered or reopened. */
export const useSetQuestionState = (id: string) =>
  useTasksMutation(
    ({ questionId, state }: { questionId: string; state: 'answered' | 'reopen' }) =>
      state === 'answered'
        ? call(
            api.POST(
              '/api/tasks/{id}/questions/{questionId}/answered',
              questionPath(id, questionId),
            ),
          )
        : call(
            api.POST('/api/tasks/{id}/questions/{questionId}/reopen', questionPath(id, questionId)),
          ),
    THREAD,
  );

/** Rule B5: a department question forwarded to a member. */
export const useForwardQuestion = (id: string) =>
  useTasksMutation(
    ({ questionId, userId }: { questionId: string; userId: string }) =>
      call(
        api.POST('/api/tasks/{id}/questions/{questionId}/forward', {
          ...questionPath(id, questionId),
          body: { userId },
        }),
      ),
    THREAD,
  );

export const useEditComment = (id: string) =>
  useTasksMutation(
    ({ commentId, ...input }: TaskCommentUpdate & { commentId: string }) =>
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

// Subtasks (F06B part A)

/** A subtask added to the parent `id`, or a question or comment turned into one (rule B11). */
export const useAddSubtask = (id: string) =>
  useTasksMutation((input: CreateSubtask) =>
    call(api.POST('/api/tasks/{id}/subtasks', { ...path(id), body: input })),
  );

export const useReorderSubtasks = (id: string) =>
  useTasksMutation((input: SubtaskOrder) =>
    call(api.PUT('/api/tasks/{id}/subtasks/order', { ...path(id), body: input })),
  );

export const useSetRunMode = (id: string) =>
  useTasksMutation((runMode: SubtaskRunMode) =>
    call(api.PUT('/api/tasks/{id}/run-mode', { ...path(id), body: { runMode } })),
  );

export const useAddStage = (id: string) =>
  useTasksMutation(
    (input: CreateTaskStage) =>
      call(api.POST('/api/tasks/{id}/stages', { ...path(id), body: input })),
    [tasksKeys.all],
  );

export const useUpdateStage = (id: string) =>
  useTasksMutation(
    ({ stageId, ...input }: UpdateTaskStage & { stageId: string }) =>
      call(
        api.PATCH('/api/tasks/{id}/stages/{stageId}', {
          params: { path: { id, stageId } },
          body: input,
        }),
      ),
    [tasksKeys.all],
  );

export const useArchiveStage = (id: string) =>
  useTasksMutation(
    (stageId: string) =>
      call(
        api.POST('/api/tasks/{id}/stages/{stageId}/archive', { params: { path: { id, stageId } } }),
      ),
    [tasksKeys.all],
  );

/** Rule A10: delivered subtasks reopened while the parent is in revisions. */
export const useReopenSubtasks = (id: string) =>
  useTasksMutation((input: ReopenSubtasks) =>
    call(api.POST('/api/tasks/{id}/subtasks/reopen', { ...path(id), body: input })),
  );

/** Rule A12: the subtask's note to the next ones. */
export const useSetHandoverNote = (id: string) =>
  useTasksMutation(
    (input: HandoverNoteInput) =>
      call(api.PUT('/api/tasks/{id}/handover-note', { ...path(id), body: input })),
    [tasksKeys.all],
  );

// Acceptance criteria (rule C6): the checklist's endpoints under `criteria`

export const useAddCriterion = (id: string) =>
  useTasksMutation(
    (input: CreateTaskChecklistItem) =>
      call(api.POST('/api/tasks/{id}/criteria', { ...path(id), body: input })),
    [tasksKeys.all],
  );

export const useUpdateCriterion = (id: string) =>
  useTasksMutation(
    ({ itemId, ...input }: UpdateTaskChecklistItem & { itemId: string }) =>
      call(
        api.PATCH('/api/tasks/{id}/criteria/{itemId}', { ...itemPath(id, itemId), body: input }),
      ),
    [tasksKeys.all],
  );

export const useReorderCriteria = (id: string) =>
  useTasksMutation(
    (ids: string[]) =>
      call(api.PUT('/api/tasks/{id}/criteria/order', { ...path(id), body: { ids } })),
    [tasksKeys.all],
  );

export const useArchiveCriterion = (id: string) =>
  useTasksMutation(
    (itemId: string) =>
      call(api.POST('/api/tasks/{id}/criteria/{itemId}/archive', itemPath(id, itemId))),
    [tasksKeys.all],
  );
