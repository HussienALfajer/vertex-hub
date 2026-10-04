import { createFileRoute, redirect } from '@tanstack/react-router';
import {
  ProductivityPage,
  parseProductivitySearch,
} from '../../../features/reports/productivity-page';
import { reportsFor } from '../../../features/reports/reports-page';

export const Route = createFileRoute('/_app/reports/productivity')({
  validateSearch: parseProductivitySearch,
  beforeLoad: ({ context }) => {
    if (!reportsFor(context.me).productivity) throw redirect({ to: '/' });
  },
  component: ProductivityRoute,
});

function ProductivityRoute() {
  return <ProductivityPage search={Route.useSearch()} />;
}
