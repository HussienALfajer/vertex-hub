import { createFileRoute } from '@tanstack/react-router';
import { TemplatePage } from '../../../features/templates/template-page';

export const Route = createFileRoute('/_app/templates/$templateId')({
  component: TemplateRoute,
});

function TemplateRoute() {
  const { templateId } = Route.useParams();
  return <TemplatePage key={templateId} templateId={templateId} />;
}
