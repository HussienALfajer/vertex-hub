import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ANNOUNCEMENT_LIMITS, type AnnouncementSummary } from '@vertex-hub/contracts';
import { Button, IconButton } from '@vertex-hub/ui';
import { ChevronDownIcon, ChevronUpIcon, MegaphoneIcon, PinIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMe } from '../../lib/auth';
import { formatRelativeTime } from '../../lib/format';
import { announcementTime, PriorityBadge, ReceiptBadge } from './announcement-parts';
import { announcementHomeQuery } from './announcements.queries';

/** Rule D7: pinned announcements a recipient folded, per user on this device. */
const collapsedKey = (userId: string) => `vertex-hub-folded-pins:${userId}`;

function readFolded(userId: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(collapsedKey(userId)) ?? '[]');
    return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeFolded(userId: string, ids: string[]) {
  try {
    localStorage.setItem(collapsedKey(userId), JSON.stringify(ids));
  } catch {
    // A blocked storage only forgets the folding.
  }
}

/**
 * Screen 9: the caller's pinned announcements above the Company section, newest first, three at
 * most, then "More announcements". Each one folds for this user (not unpinned).
 */
export function PinnedAnnouncements() {
  const { t } = useTranslation();
  const me = useMe();
  const home = useQuery(announcementHomeQuery);
  const [folded, setFolded] = useState(() => readFolded(me.user.id));
  const pinned = home.data?.pinned ?? [];
  if (pinned.length === 0) return null;
  const shown = pinned.slice(0, ANNOUNCEMENT_LIMITS.homePinned);
  const toggle = (id: string) => {
    // Only ids still pinned are kept, so the list does not grow forever.
    const next = folded.includes(id)
      ? folded.filter((other) => other !== id)
      : [...folded.filter((other) => pinned.some((item) => item.id === other)), id];
    setFolded(next);
    writeFolded(me.user.id, next);
  };
  return (
    <section
      aria-labelledby="pinned-announcements"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 md:p-6"
    >
      <h2 id="pinned-announcements" className="flex items-center gap-2 text-lg font-bold">
        <PinIcon className="size-5 text-muted-foreground" aria-hidden="true" />
        {t('announcements.home.title')}
      </h2>
      <ul className="flex flex-col divide-y divide-border">
        {shown.map((announcement) => (
          <PinnedItem
            key={announcement.id}
            announcement={announcement}
            folded={folded.includes(announcement.id)}
            onToggle={() => toggle(announcement.id)}
          />
        ))}
      </ul>
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        render={<Link to="/announcements" />}
      >
        <MegaphoneIcon />
        {t('announcements.home.more')}
      </Button>
    </section>
  );
}

function PinnedItem({
  announcement,
  folded,
  onToggle,
}: {
  announcement: AnnouncementSummary;
  folded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/announcements/$announcementId"
            params={{ announcementId: announcement.id }}
            className="rounded-sm font-medium text-foreground outline-offset-2 hover:underline"
          >
            {announcement.title}
          </Link>
          <PriorityBadge priority={announcement.priority} />
          <ReceiptBadge announcement={announcement} />
        </div>
        {!folded && (
          <>
            <p className="line-clamp-2 text-sm text-muted-foreground">{announcement.excerpt}</p>
            <p className="text-xs text-muted-foreground">
              {announcement.author.name} · {formatRelativeTime(announcementTime(announcement))}
            </p>
          </>
        )}
      </div>
      <IconButton
        label={
          folded
            ? t('announcements.home.unfold', { title: announcement.title })
            : t('announcements.home.fold', { title: announcement.title })
        }
        aria-expanded={!folded}
        onClick={onToggle}
      >
        {folded ? <ChevronDownIcon /> : <ChevronUpIcon />}
      </IconButton>
    </li>
  );
}
