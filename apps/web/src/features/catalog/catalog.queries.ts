import { keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  CreateCatalogPackage,
  CreateCatalogService,
  UpdateCatalogPackage,
  UpdateCatalogService,
} from '@vertex-hub/contracts';
import { api, call } from '../../lib/api/client';
import type { paths } from '../../lib/api/schema.gen';

export type ServiceListFilters = NonNullable<
  paths['/api/catalog/services']['get']['parameters']['query']
>;

export type PackageListFilters = NonNullable<
  paths['/api/catalog/packages']['get']['parameters']['query']
>;

export const catalogKeys = {
  all: ['catalog'] as const,
  services: (filters: ServiceListFilters) => ['catalog', 'services', filters] as const,
  packages: (filters: PackageListFilters) => ['catalog', 'packages', filters] as const,
};

export const serviceListQuery = (filters: ServiceListFilters) =>
  queryOptions({
    queryKey: catalogKeys.services(filters),
    queryFn: () => call(api.GET('/api/catalog/services', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

export const packageListQuery = (filters: PackageListFilters) =>
  queryOptions({
    queryKey: catalogKeys.packages(filters),
    queryFn: () => call(api.GET('/api/catalog/packages', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

/** Packages list their services' names, so any catalog change refreshes both tabs. */
function useInvalidateCatalog() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: catalogKeys.all });
}

export function useCreateService() {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: (input: CreateCatalogService) =>
      call(api.POST('/api/catalog/services', { body: input })),
    onSuccess: invalidate,
  });
}

export function useUpdateService() {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateCatalogService & { id: string }) =>
      call(api.PATCH('/api/catalog/services/{id}', { params: { path: { id } }, body: input })),
    onSuccess: invalidate,
  });
}

export function useSetServiceArchived() {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: ({ id, archive }: { id: string; archive: boolean }) =>
      call(
        archive
          ? api.POST('/api/catalog/services/{id}/archive', { params: { path: { id } } })
          : api.POST('/api/catalog/services/{id}/restore', { params: { path: { id } } }),
      ),
    onSuccess: invalidate,
  });
}

export function useCreatePackage() {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: (input: CreateCatalogPackage) =>
      call(api.POST('/api/catalog/packages', { body: input })),
    onSuccess: invalidate,
  });
}

export function useUpdatePackage() {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateCatalogPackage & { id: string }) =>
      call(api.PATCH('/api/catalog/packages/{id}', { params: { path: { id } }, body: input })),
    onSuccess: invalidate,
  });
}

export function useSetPackageArchived() {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: ({ id, archive }: { id: string; archive: boolean }) =>
      call(
        archive
          ? api.POST('/api/catalog/packages/{id}/archive', { params: { path: { id } } })
          : api.POST('/api/catalog/packages/{id}/restore', { params: { path: { id } } }),
      ),
    onSuccess: invalidate,
  });
}
