import { createFileRoute } from '@tanstack/react-router';
import { ContentPage, parseContentSearch } from '../../../features/content/content-page';

export const Route = createFileRoute('/_app/content/')({
  validateSearch: parseContentSearch,
  component: ContentRoute,
});

function ContentRoute() {
  return <ContentPage search={Route.useSearch()} />;
}
