import { useQuery } from '@tanstack/react-query';
import { Button, IconButton, Popover, PopoverContent, PopoverTrigger, toast } from '@vertex-hub/ui';
import { BellOffIcon, BellPlusIcon, InfoIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../lib/errors';
import { formatNumber } from '../../lib/format';
import { type FollowTarget, followingQuery, useSetFollowing } from './notifications.queries';

/**
 * F16 screen 8: "Follow" / "Following" on a task or a post, with the follower count and a hint
 * on who follows automatically (rule B12). Unfollowing stays: automatic following does not add
 * the user back.
 */
export function FollowButton({ target }: { target: FollowTarget }) {
  const { t } = useTranslation();
  const following = useQuery(followingQuery(target));
  const setFollowing = useSetFollowing(target);
  // The button waits for the state; a record the API refuses shows nothing.
  if (!following.data) return null;
  const { following: on, followers } = following.data;
  const hint = t(
    target.subject === 'task' ? 'notifications.follow.taskHint' : 'notifications.follow.postHint',
  );

  function toggle() {
    setFollowing.mutate(!on, {
      onSuccess: (result) =>
        toast.add({
          title: t(
            result.following ? 'notifications.follow.followed' : 'notifications.follow.unfollowed',
          ),
          type: 'success',
        }),
      onError: (error) => toast.add({ title: errorMessage(t, error), type: 'error' }),
    });
  }

  return (
    <span className="flex items-center gap-1">
      <Button
        variant={on ? 'secondary' : 'outline'}
        aria-pressed={on}
        disabled={setFollowing.isPending}
        focusableWhenDisabled
        onClick={toggle}
      >
        {on ? <BellOffIcon /> : <BellPlusIcon />}
        {on ? t('notifications.follow.following') : t('notifications.follow.follow')}
        <span className="text-xs text-muted-foreground tabular-nums">
          {t('notifications.follow.followers', { count: followers, n: formatNumber(followers) })}
        </span>
      </Button>
      {/* A tap opens the hint on phones, where tooltips never show. */}
      <Popover>
        <PopoverTrigger render={<IconButton label={t('notifications.follow.why')} />}>
          <InfoIcon />
        </PopoverTrigger>
        <PopoverContent align="end" className="max-w-72 p-3 text-sm">
          {hint}
        </PopoverContent>
      </Popover>
    </span>
  );
}
