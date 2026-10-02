import { createFileRoute, redirect } from '@tanstack/react-router';
import { CatalogPage, parseCatalogSearch } from '../../../features/catalog/catalog-page';
import { can } from '../../../lib/auth';

export const Route = createFileRoute('/_app/catalog/')({
  validateSearch: parseCatalogSearch,
  // Hidden from users who cannot read the catalog; the API refuses them anyway.
  beforeLoad: ({ context }) => {
    if (!can(context.me, 'catalog.read')) throw redirect({ to: '/' });
  },
  component: CatalogRoute,
});

function CatalogRoute() {
  return <CatalogPage search={Route.useSearch()} />;
}
