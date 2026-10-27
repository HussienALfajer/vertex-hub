import type { PostCheck } from '@vertex-hub/contracts';
import { Badge, Button, cn } from '@vertex-hub/ui';
import { CircleAlertIcon, TriangleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../lib/format';

/*
 * F08B rules A3–A5: the checks of a post, blocking ones first. The wizard's Review step, the post
 * page and a refused submission show them alike.
 */

/** Where a check is fixed: the captions or the media. */
export type CheckPlace = 'captions' | 'media';

const CAPTION_CHECKS: readonly PostCheck['code'][] = [
  'caption_too_long',
  'too_many_hashtags',
  'title_too_long',
  'caption_empty',
  'title_missing',
];

export const placeOfCheck = (check: PostCheck): CheckPlace =>
  CAPTION_CHECKS.includes(check.code) ? 'captions' : 'media';

export function useCheckText() {
  const { t } = useTranslation();
  return (check: PostCheck): string =>
    t(`content.checks.codes.${check.code}`, {
      group: check.group ? t(`content.captionGroups.${check.group}`) : '',
      platform: check.platform ? t(`clients.platforms.names.${check.platform}`) : '',
      limit: formatNumber(check.limit ?? 0),
      actual: formatNumber(check.actual ?? 0),
      n: formatNumber((check.mediaIndex ?? 0) + 1),
    });
}

export function PostChecksList({
  checks,
  onGoTo,
}: {
  checks: readonly PostCheck[];
  /** Offers "Go to" the step or section that fixes each check. */
  onGoTo?: (place: CheckPlace) => void;
}) {
  const { t } = useTranslation();
  const text = useCheckText();
  const sorted = [...checks].sort((a, b) => Number(b.blocking) - Number(a.blocking));
  return (
    <ul className="flex flex-col gap-2">
      {sorted.map((check, index) => {
        const Icon = check.blocking ? CircleAlertIcon : TriangleAlertIcon;
        return (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: checks have no id
            key={index}
            className="flex flex-col gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm sm:flex-row sm:items-center"
          >
            <Icon
              aria-hidden="true"
              className={cn(
                'size-4 shrink-0',
                check.blocking ? 'text-destructive-text' : 'text-status-warning-foreground',
              )}
            />
            <span className="flex-1">{text(check)}</span>
            <Badge tone={check.blocking ? 'danger' : 'warning'}>
              {check.blocking ? t('content.checks.blocking') : t('content.checks.warning')}
            </Badge>
            {onGoTo && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onGoTo(placeOfCheck(check))}
              >
                {t(`content.checks.goTo.${placeOfCheck(check)}`)}
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
