import { createFileRoute } from '@tanstack/react-router';
import { ProjectsPage, parseProjectsSearch } from '../../../features/projects/projects-page';

export const Route = createFileRoute('/_app/projects/')({
  validateSearch: parseProjectsSearch,
  component: ProjectsRoute,
});

function ProjectsRoute() {
  return <ProjectsPage search={Route.useSearch()} />;
}
