import type { AnnouncementPoll } from '@vertex-hub/contracts';
import { Badge, Button, Checkbox, Meter, RadioCard, RadioGroup, toast } from '@vertex-hub/ui';
import { ChartBarBigIcon, LockIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormAlert } from '../../components/form-alert';
import { errorMessage } from '../../lib/errors';
import { formatDateTime, formatList, formatNumber } from '../../lib/format';
import { useClosePoll, useVote } from './announcements.queries';

/**
 * Rule D11: the poll of an announcement. A recipient votes (and changes their vote) until it
 * closes; the counts show as the author chose, the voters' names only to the author and managers
 * of a named poll.
 */
export function AnnouncementPollCard({
  announcementId,
  poll,
}: {
  announcementId: string;
  poll: AnnouncementPoll;
}) {
  const { t } = useTranslation();
  const questionId = useId();
  const vote = useVote(announcementId);
  const close = useClosePoll(announcementId);
  const [choice, setChoice] = useState<string[]>(poll.myVote);
  const [changing, setChanging] = useState(false);
  const [closing, setClosing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const voted = poll.myVote.length > 0;
  // A voter sees their choice with the results; "Change my vote" opens the choice again.
  const choosing = poll.rights.vote && (!voted || changing);
  const shownResults = poll.options.some((option) => option.votes !== null);
  const sameChoice =
    choice.length === poll.myVote.length && choice.every((id) => poll.myVote.includes(id));

  const submit = async () => {
    setFailure(null);
    try {
      await vote.mutateAsync(choice);
      setChanging(false);
      toast.add({ title: t('announcements.poll.voted'), type: 'success' });
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  };

  return (
    <section
      aria-labelledby={questionId}
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <ChartBarBigIcon className="size-4" aria-hidden="true" />
            {t('announcements.poll.title')}
          </p>
          <h2 id={questionId} className="text-base font-medium">
            {poll.question}
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {poll.closed ? (
            <Badge tone="neutral">
              <LockIcon aria-hidden="true" />
              {t('announcements.poll.closed')}
            </Badge>
          ) : (
            poll.closesAt && (
              <Badge tone="info">
                {t('announcements.poll.closesAt', { time: formatDateTime(poll.closesAt) })}
              </Badge>
            )
          )}
          <Badge tone="outline">
            {poll.multiple ? t('announcements.poll.multiple') : t('announcements.poll.single')}
          </Badge>
          {poll.anonymous && <Badge tone="outline">{t('announcements.poll.anonymous')}</Badge>}
        </div>
      </div>

      {choosing ? (
        poll.multiple ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">{poll.question}</legend>
            {poll.options.map((option) => (
              <OptionCheckbox
                key={option.id}
                label={option.label}
                checked={choice.includes(option.id)}
                onCheckedChange={(checked) =>
                  setChoice((current) =>
                    checked ? [...current, option.id] : current.filter((id) => id !== option.id),
                  )
                }
              />
            ))}
          </fieldset>
        ) : (
          <RadioGroup<string>
            aria-labelledby={questionId}
            value={choice[0] ?? ''}
            onValueChange={(value) => setChoice(value ? [value] : [])}
          >
            {poll.options.map((option) => (
              <RadioCard key={option.id} value={option.id} title={option.label} />
            ))}
          </RadioGroup>
        )
      ) : (
        <ul className="flex flex-col gap-3">
          {poll.options.map((option) => (
            <PollResult
              key={option.id}
              option={option}
              voters={poll.voters}
              mine={poll.myVote.includes(option.id)}
            />
          ))}
        </ul>
      )}

      {!choosing && !shownResults && (
        <p className="text-sm text-muted-foreground">
          {poll.results === 'author_only'
            ? t('announcements.poll.resultsAuthorOnly')
            : t('announcements.poll.resultsAfterVoting')}
        </p>
      )}
      {poll.voters !== null && (
        <p className="text-sm text-muted-foreground">
          {t('announcements.poll.voters', { count: poll.voters, n: formatNumber(poll.voters) })}
        </p>
      )}

      {failure && <FormAlert>{failure}</FormAlert>}
      <div className="flex flex-wrap items-center gap-2">
        {choosing && (
          <Button
            disabled={choice.length === 0 || sameChoice || vote.isPending}
            focusableWhenDisabled
            onClick={submit}
          >
            {voted ? t('announcements.poll.saveVote') : t('announcements.poll.vote')}
          </Button>
        )}
        {choosing && changing && (
          <Button
            variant="ghost"
            onClick={() => {
              setChanging(false);
              setChoice(poll.myVote);
            }}
          >
            {t('common.cancel')}
          </Button>
        )}
        {!choosing && poll.rights.vote && voted && (
          <Button variant="outline" onClick={() => setChanging(true)}>
            {t('announcements.poll.changeVote')}
          </Button>
        )}
        {poll.rights.close && !poll.closed && (
          <Button variant="outline" className="ms-auto" onClick={() => setClosing(true)}>
            <LockIcon />
            {t('announcements.poll.close')}
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={closing}
        onClose={() => setClosing(false)}
        title={t('announcements.poll.closeTitle')}
        body={t('announcements.poll.closeBody')}
        action={t('announcements.poll.close')}
        pending={close.isPending}
        onConfirm={async () => {
          await close.mutateAsync(undefined);
          toast.add({ title: t('announcements.poll.closedDone'), type: 'success' });
        }}
      />
    </section>
  );
}

function OptionCheckbox({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center gap-3 rounded-md border border-border bg-surface p-3 text-sm font-medium transition-colors duration-150 ease-out hover:bg-muted has-data-checked:border-primary has-data-checked:bg-muted"
    >
      <Checkbox id={id} checked={checked} onCheckedChange={onCheckedChange} />
      {label}
    </label>
  );
}

function PollResult({
  option,
  voters,
  mine,
}: {
  option: AnnouncementPoll['options'][number];
  voters: number | null;
  mine: boolean;
}) {
  const { t } = useTranslation();
  const labelId = useId();
  const share = option.votes !== null && voters ? Math.round((option.votes / voters) * 100) : 0;
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span id={labelId} className={mine ? 'font-medium' : undefined}>
          {option.label}
          {mine && (
            <Badge tone="brand" className="ms-2">
              {t('announcements.poll.myChoice')}
            </Badge>
          )}
        </span>
        {option.votes !== null && (
          <span className="shrink-0 text-muted-foreground">
            {t('announcements.poll.optionVotes', {
              count: option.votes,
              n: formatNumber(option.votes),
              share: formatNumber(share),
            })}
          </span>
        )}
      </div>
      {option.votes !== null && <Meter aria-labelledby={labelId} value={share} min={0} max={100} />}
      {option.voters && option.voters.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {formatList(option.voters.map((voter) => voter.name))}
        </p>
      )}
    </li>
  );
}
