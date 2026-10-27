import { createFileRoute } from '@tanstack/react-router';
import { ContentSettingsPage } from '../../../features/content/content-settings-page';

// Everyone reads the content settings; `content.review` with scope all edits them (F08B).
export const Route = createFileRoute('/_app/content/settings')({
  component: ContentSettingsPage,
});
