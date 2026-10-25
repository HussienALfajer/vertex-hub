import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ImageSubjectType, SetImage } from '@vertex-hub/contracts';
import { api, call } from '../../lib/api/client';

/** The record an image belongs to (F01C). */
export interface ImageSubject {
  type: ImageSubjectType;
  id: string;
}

const path = (id: string) => ({ params: { path: { id } } });

function putImage({ type, id }: ImageSubject, body: SetImage) {
  switch (type) {
    case 'user':
      return call(api.PUT('/api/users/{id}/image', { ...path(id), body }));
    case 'client':
      return call(api.PUT('/api/clients/{id}/image', { ...path(id), body }));
    case 'project':
      return call(api.PUT('/api/projects/{id}/image', { ...path(id), body }));
    case 'retainer':
      return call(api.PUT('/api/retainers/{id}/image', { ...path(id), body }));
  }
}

function deleteImage({ type, id }: ImageSubject) {
  switch (type) {
    case 'user':
      return call(api.DELETE('/api/users/{id}/image', path(id)));
    case 'client':
      return call(api.DELETE('/api/clients/{id}/image', path(id)));
    case 'project':
      return call(api.DELETE('/api/projects/{id}/image', path(id)));
    case 'retainer':
      return call(api.DELETE('/api/retainers/{id}/image', path(id)));
  }
}

/**
 * Every screen showing the record carries its `imageId` (a client's logo also shows on its
 * projects, retainers, tasks and invoices; a photo on every list and the session user), so a change
 * refreshes them all, also on failure: a 403 reloads the page with its current actions.
 */
function useImageMutation<Input, Output>(mutationFn: (input: Input) => Promise<Output>) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn, onSettled: () => queryClient.invalidateQueries() });
}

export const useSetImage = (subject: ImageSubject) =>
  useImageMutation((body: SetImage) => putImage(subject, body));

export const useRemoveImage = (subject: ImageSubject) =>
  useImageMutation(() => deleteImage(subject));
