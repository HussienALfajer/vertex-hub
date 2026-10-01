import {
  keepPreviousData,
  type QueryKey,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  CreateFileItemInput,
  CreateFileVersion,
  ErrorResponse,
  FileOwnerType,
  FileUpload,
  UpdateFileItem,
} from '@vertex-hub/contracts';
import { ApiError, api, call } from '../../lib/api/client';
import type { paths } from '../../lib/api/schema.gen';
import { tasksKeys } from '../tasks/tasks.queries';

/** The items endpoint's query string as the API reads it: flags are `'true'` or `'false'`. */
export type FileItemsFilters = paths['/api/files/items']['get']['parameters']['query'];

export type FileLibraryFilters = paths['/api/files/library']['get']['parameters']['query'];

export type ClientDocumentsFilters = paths['/api/files/documents']['get']['parameters']['query'];

export const filesKeys = {
  all: ['files'] as const,
  items: (filters: FileItemsFilters) => ['files', 'items', filters] as const,
  library: (filters: FileLibraryFilters) => ['files', 'library', filters] as const,
  documents: (filters: ClientDocumentsFilters) => ['files', 'documents', filters] as const,
  usage: (clientId: string) => ['files', 'usage', clientId] as const,
};

const PREVIEW_POLL_MS = 3000;

export const fileItemsQuery = (filters: FileItemsFilters) =>
  queryOptions({
    queryKey: filesKeys.items(filters),
    queryFn: () => call(api.GET('/api/files/items', { params: { query: filters } })),
    // A new image shows its thumbnail once the preview job has rendered it (rule 18).
    refetchInterval: (query) =>
      query.state.data?.items.some((item) =>
        item.versions.some((version) => version.previewStatus === 'pending'),
      )
        ? PREVIEW_POLL_MS
        : false,
  });

/** A client's final deliverables (rule 13). */
export const fileLibraryQuery = (filters: FileLibraryFilters) =>
  queryOptions({
    queryKey: filesKeys.library(filters),
    queryFn: () => call(api.GET('/api/files/library', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

/** The documents of a client, its projects and retainers (rule 14). */
export const clientDocumentsQuery = (filters: ClientDocumentsFilters) =>
  queryOptions({
    queryKey: filesKeys.documents(filters),
    queryFn: () => call(api.GET('/api/files/documents', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

/** Storage used by a client and in total, with the free space (rule 19; scope all only). */
export const fileUsageQuery = (clientId: string) =>
  queryOptions({
    queryKey: filesKeys.usage(clientId),
    queryFn: () => call(api.GET('/api/files/usage', { params: { query: { clientId } } })),
  });

/** What files are attached to: a task, a client, a project, a retainer or a post. */
export interface FileOwnerRef {
  type: FileOwnerType;
  id: string;
}

// Content (rules 16–18): the API authorizes each request, so these are plain same-origin links.

const versionUrl = (versionId: string, part: 'content' | 'thumbnail' | 'preview') =>
  `/api/files/versions/${versionId}/${part}`;

export const fileContentUrl = (versionId: string) => versionUrl(versionId, 'content');

export const fileDownloadUrl = (versionId: string) =>
  `${versionUrl(versionId, 'content')}?download=1`;

export const fileThumbnailUrl = (versionId: string) => versionUrl(versionId, 'thumbnail');

export const filePreviewUrl = (versionId: string) => versionUrl(versionId, 'preview');

// Upload (rule 1)

/** The upload could not reach the API (offline, connection dropped). */
export class UploadNetworkError extends Error {
  constructor() {
    super('The upload did not reach the server');
    this.name = 'UploadNetworkError';
  }
}

/**
 * Uploads one file (step 1) with progress (0 to 1), which `fetch` cannot report. Rejects with `ApiError`
 * for an API refusal, `UploadNetworkError` when the connection fails, and an `AbortError`
 * `DOMException` when `signal` aborts.
 */
export function uploadFile(
  file: File,
  { onProgress, signal }: { onProgress: (sent: number) => void; signal: AbortSignal },
): Promise<FileUpload> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const body = new FormData();
    body.append('file', file);
    request.open('POST', '/api/files/uploads');
    request.responseType = 'json';
    // The share of the request sent: the multipart envelope counts too.
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve(request.response as FileUpload);
        return;
      }
      const error = (request.response ?? {}) as Partial<ErrorResponse>;
      reject(
        new ApiError(
          request.status,
          error.code,
          error.details,
          error.message ?? `HTTP ${request.status}`,
        ),
      );
    };
    request.onerror = () => reject(new UploadNetworkError());
    request.onabort = () => reject(new DOMException('The upload was cancelled', 'AbortError'));
    signal.addEventListener('abort', () => request.abort(), { once: true });
    request.send(body);
  });
}

// Changes

/**
 * A change to an owner's files, refreshing also on failure: a 403 or 409 after the owner changed
 * (edge case 14) reloads the section with its current actions. A task's page also shows its file
 * counts, a post's page its media.
 */
function useFilesMutation<Input, Output>(
  owner: FileOwnerRef,
  mutationFn: (input: Input) => Promise<Output>,
) {
  const queryClient = useQueryClient();
  const refreshes: QueryKey[] = [filesKeys.all];
  if (owner.type === 'task') refreshes.push(tasksKeys.detail(owner.id));
  // A post's files are its media and part of its content token (F08 rules 5 and 11).
  if (owner.type === 'post') refreshes.push(['content']);
  return useMutation({
    mutationFn,
    onSettled: () =>
      Promise.all(refreshes.map((queryKey) => queryClient.invalidateQueries({ queryKey }))),
  });
}

const path = (id: string) => ({ params: { path: { id } } });

export const useCreateFileItem = (owner: FileOwnerRef) =>
  useFilesMutation(owner, (input: Omit<CreateFileItemInput, 'ownerType' | 'ownerId'>) =>
    call(
      api.POST('/api/files/items', {
        body: {
          ...input,
          ownerType: owner.type,
          ownerId: owner.id,
          confidential: input.confidential ?? false,
        },
      }),
    ),
  );

export const useAddFileVersion = (owner: FileOwnerRef) =>
  useFilesMutation(owner, ({ itemId, ...input }: CreateFileVersion & { itemId: string }) =>
    call(api.POST('/api/files/items/{id}/versions', { ...path(itemId), body: input })),
  );

export const useUpdateFileItem = (owner: FileOwnerRef) =>
  useFilesMutation(owner, ({ itemId, ...input }: UpdateFileItem & { itemId: string }) =>
    call(api.PATCH('/api/files/items/{id}', { ...path(itemId), body: input })),
  );

export const useArchiveFileItem = (owner: FileOwnerRef) =>
  useFilesMutation(owner, (itemId: string) =>
    call(api.POST('/api/files/items/{id}/archive', path(itemId))),
  );

export const useRestoreFileItem = (owner: FileOwnerRef) =>
  useFilesMutation(owner, (itemId: string) =>
    call(api.POST('/api/files/items/{id}/restore', path(itemId))),
  );

export const useArchiveFileVersion = (owner: FileOwnerRef) =>
  useFilesMutation(owner, (versionId: string) =>
    call(api.POST('/api/files/versions/{id}/archive', path(versionId))),
  );

export const useRestoreFileVersion = (owner: FileOwnerRef) =>
  useFilesMutation(owner, (versionId: string) =>
    call(api.POST('/api/files/versions/{id}/restore', path(versionId))),
  );

export const useSetFileFinal = (owner: FileOwnerRef) =>
  useFilesMutation(owner, ({ versionId, final }: { versionId: string; final: boolean }) =>
    call(api.POST('/api/files/versions/{id}/final', { ...path(versionId), body: { final } })),
  );
