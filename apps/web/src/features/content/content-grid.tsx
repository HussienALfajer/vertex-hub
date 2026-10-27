import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { GridTile } from '@vertex-hub/contracts';
import { Badge, cn, EmptyState, Skeleton } from '@vertex-hub/ui';
import { LayoutGridIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { formatCalendarDate } from '../../lib/format';
import { fileThumbnailUrl } from '../files/files.queries';
import { contentGridQuery } from './content.queries';
import { POST_TYPE_ICONS, PostStatusBadge } from './post-parts';

/**
 * Spec F08B rule C11, screen 3: a client's Instagram grid, the month shown and the two before,
 * newest first in three columns as the profile shows them. Published posts are plain, planned
 * ones marked; each tile opens its post. Read-only: the grid is never reordered here.
 */
export function ContentGrid({ clientId, month }: { clientId: string; month: string }) {
  const { t } = useTranslation();
  const grid = useQuery(contentGridQuery({ clientId, month }));
  if (grid.isPending) return <Skeleton className="mx-auto aspect-square w-full max-w-xl" />;
  if (grid.isError) {
    return <LoadError message={t('content.grid.loadError')} onRetry={() => grid.refetch()} />;
  }
  if (grid.data.tiles.length === 0) {
    return (
      <EmptyState
        icon={<LayoutGridIcon />}
        title={t('content.grid.emptyTitle')}
        description={t('content.grid.emptyHint')}
      />
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t('content.grid.hint')}</p>
      <ul aria-label={t('content.grid.title')} className="grid grid-cols-3 gap-1" data-grid>
        {grid.data.tiles.map((tile) => (
          <Tile key={tile.postId} tile={tile} />
        ))}
      </ul>
    </div>
  );
}

function Tile({ tile }: { tile: GridTile }) {
  const { t } = useTranslation();
  const planned = tile.status !== 'published';
  const Icon = POST_TYPE_ICONS[tile.type];
  return (
    <li data-tile-status={tile.status}>
      <Link
        to="/content/posts/$postId"
        params={{ postId: tile.postId }}
        aria-label={t('content.grid.tile', {
          title: tile.title,
          date: formatCalendarDate(tile.publishDate),
        })}
        className={cn(
          'relative flex aspect-square overflow-hidden rounded-sm bg-muted',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          planned && 'outline-2 -outline-offset-2 outline-dashed outline-primary',
        )}
      >
        {tile.thumbnailVersionId ? (
          <img
            src={fileThumbnailUrl(tile.thumbnailVersionId)}
            alt=""
            loading="lazy"
            className={cn('size-full object-cover', planned && 'opacity-80')}
          />
        ) : (
          <span className="flex size-full items-center justify-center">
            <Icon aria-hidden="true" className="size-8 text-muted-foreground" />
          </span>
        )}
        <span className="absolute inset-x-1 bottom-1 flex flex-wrap items-center gap-1">
          {planned ? (
            <PostStatusBadge status={tile.status} />
          ) : (
            <Badge tone="neutral" className="sr-only">
              {t('content.statuses.published')}
            </Badge>
          )}
        </span>
      </Link>
    </li>
  );
}
