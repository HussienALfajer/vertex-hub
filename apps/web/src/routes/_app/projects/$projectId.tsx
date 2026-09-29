import { createFileRoute } from '@tanstack/react-router';
import { ProjectPage, parseProjectPageSearch } from '../../../features/projects/project-page';

export const Route = createFileRoute('/_app/projects/$projectId')({
  validateSearch: parseProjectPageSearch,
  component: ProjectRoute,
});

function ProjectRoute() {
  const { projectId } = Route.useParams();
  return <ProjectPage key={projectId} projectId={projectId} search={Route.useSearch()} />;
}
