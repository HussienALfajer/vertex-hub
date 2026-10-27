import {
  CONTENT_PLANNING_LIMITS,
  POST_PLATFORMS,
  type PostingWindow,
  type PostPlatform,
} from '@vertex-hub/contracts';
import {
  Button,
  IconButton,
  Input,
  PlatformMark,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ToggleGroup,
  ToggleGroupItem,
} from '@vertex-hub/ui';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatTimeOfDay, formatWeekdayNumber } from '../../lib/format';

/*
 * Best publishing times (spec F08B rule C3): windows of a platform on some weekdays, edited for
 * the agency on the content settings and per platform for a client, whose windows replace the
 * agency's for the platforms it lists.
 */

/** The weekdays from Saturday, as the calendar's weeks run (0 = Sunday). */
export const WEEKDAYS_FROM_SATURDAY = [6, 0, 1, 2, 3, 4, 5] as const;

/** A new window: every day but Friday, at noon. */
const newWindow = (platform: PostPlatform): PostingWindow => ({
  platform,
  weekdays: [6, 0, 1, 2, 3, 4],
  from: '12:00',
  to: '14:00',
});

/** The windows grouped by platform, in the platforms' order, each edited in place. */
export function PostingTimesEditor({
  value,
  onChange,
  readOnly = false,
  idPrefix,
}: {
  value: PostingWindow[];
  onChange: (next: PostingWindow[]) => void;
  readOnly?: boolean;
  idPrefix: string;
}) {
  const { t } = useTranslation();
  const listed = POST_PLATFORMS.filter((platform) =>
    value.some((window) => window.platform === platform),
  );
  const unlisted = POST_PLATFORMS.filter((platform) => !listed.includes(platform));
  const update = (index: number, next: Partial<PostingWindow>) =>
    onChange(value.map((window, at) => (at === index ? { ...window, ...next } : window)));
  const remove = (index: number) => onChange(value.filter((_, at) => at !== index));

  return (
    <div className="flex flex-col gap-4" data-posting-times>
      {listed.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('content.times.none')}</p>
      )}
      {listed.map((platform) => {
        const windows = value
          .map((window, index) => ({ window, index }))
          .filter(({ window }) => window.platform === platform);
        const platformName = t(`clients.platforms.names.${platform}`);
        return (
          <div key={platform} className="flex flex-col gap-2" data-platform={platform}>
            <h4 className="flex items-center gap-2 text-sm font-medium">
              <PlatformMark platform={platform} size="sm" label={platformName} />
              {platformName}
            </h4>
            {readOnly ? (
              <ul className="flex flex-col gap-1 text-sm">
                {windows.map(({ window, index }) => (
                  <li key={index} className="flex flex-wrap items-center gap-2">
                    <span className="tabular-nums" dir="ltr">
                      {formatTimeOfDay(window.from)} – {formatTimeOfDay(window.to)}
                    </span>
                    <span className="text-muted-foreground">
                      {WEEKDAYS_FROM_SATURDAY.filter((day) => window.weekdays.includes(day))
                        .map((day) => formatWeekdayNumber(day, 'long'))
                        .join('، ')}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="flex flex-col gap-2">
                {windows.map(({ window, index }, position) => {
                  const label = t('content.times.window', {
                    platform: platformName,
                    n: position + 1,
                  });
                  return (
                    <li
                      key={index}
                      className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2"
                    >
                      <ToggleGroup
                        multiple
                        aria-label={t('content.times.days', { window: label })}
                        value={window.weekdays.map(String)}
                        onValueChange={(next: string[]) =>
                          update(index, { weekdays: next.map(Number) })
                        }
                      >
                        {WEEKDAYS_FROM_SATURDAY.map((day) => (
                          <ToggleGroupItem key={day} value={String(day)} className="px-2">
                            {formatWeekdayNumber(day)}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                      <span className="flex items-center gap-1.5">
                        <Input
                          id={`${idPrefix}-${index}-from`}
                          type="time"
                          dir="ltr"
                          className="w-36"
                          aria-label={t('content.times.from', { window: label })}
                          value={window.from}
                          onChange={(event) => update(index, { from: event.target.value })}
                        />
                        <span aria-hidden="true">–</span>
                        <Input
                          type="time"
                          dir="ltr"
                          className="w-36"
                          aria-label={t('content.times.to', { window: label })}
                          value={window.to}
                          onChange={(event) => update(index, { to: event.target.value })}
                        />
                      </span>
                      <IconButton
                        label={t('content.times.remove', { window: label })}
                        className="ms-auto"
                        onClick={() => remove(index)}
                      >
                        <Trash2Icon />
                      </IconButton>
                    </li>
                  );
                })}
              </ul>
            )}
            {!readOnly && windows.length < CONTENT_PLANNING_LIMITS.windowsPerPlatform && (
              <Button
                variant="ghost"
                size="sm"
                className="w-fit"
                onClick={() => onChange([...value, newWindow(platform)])}
              >
                <PlusIcon />
                {t('content.times.addWindow', { platform: platformName })}
              </Button>
            )}
          </div>
        );
      })}
      {!readOnly && unlisted.length > 0 && (
        <Select
          items={unlisted.map((platform) => ({
            value: platform,
            label: t(`clients.platforms.names.${platform}`),
          }))}
          value={null}
          onValueChange={(platform: PostPlatform | null) => {
            if (platform) onChange([...value, newWindow(platform)]);
          }}
        >
          <SelectTrigger className="w-fit" aria-label={t('content.times.addPlatform')}>
            <SelectValue placeholder={t('content.times.addPlatform')} />
          </SelectTrigger>
          <SelectContent>
            {unlisted.map((platform) => (
              <SelectItem key={platform} value={platform}>
                {t(`clients.platforms.names.${platform}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
