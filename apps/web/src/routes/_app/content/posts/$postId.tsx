import { createFileRoute } from '@tanstack/react-router';
import { PostPage } from '../../../../features/content/post-page';

export const Route = createFileRoute('/_app/content/posts/$postId')({
  component: PostRoute,
});

function PostRoute() {
  const { postId } = Route.useParams();
  return <PostPage key={postId} postId={postId} />;
}
