import { useQuery } from '@tanstack/react-query';
import {
  CALENDAR_LIMITS,
  calendarDay,
  createMeetingSchema,
  type MeetingDetail,
  type ScheduleConflict,
  updateMeetingSchema,
} from '@vertex-hub/contracts';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Avatar,
  Button,
  Callout,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  MultiCombobox,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from '@vertex-hub/ui';
import { TriangleAlertIcon } from 'lucide-react';
import { type ComponentProps, useEffect, useId, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { ApiError } from '../../lib/api/client';
import { useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { focusFirstInvalid } from '../../lib/focus-first-invalid';
import { clientListQuery, clientQuery } from '../clients/clients.queries';
import { userListQuery } from '../users/users.queries';
import { conflictsQuery, useCreateMeeting, useUpdateMeeting } from './calendar.queries';
import { ConflictList } from './calendar-parts';
import { instantsOf, timeInput } from './shoot-form';

/*
 * Creating and editing a meeting (spec F11, screen 6, rule 14). The date and times are entered
 * apart and sent as one start and one end; the contract schema checks everything before it is
 * sent.
 */

/** The client select's value for a meeting without a client. */
const INTERNAL = 'internal';

interface MeetingFormValues {
  title: string;
  /** A client id, or `INTERNAL`. */
  client: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  onlineUrl: string;
  agenda: string;
  organizerId: string;
  attendeeIds: string[];
  contactIds: string[];
}

/** The parts of the form a refusal or a failed check is shown under. */
type Problem =
  | 'title'
  | 'client'
  | 'time'
  | 'location'
  | 'onlineUrl'
  | 'agenda'
  | 'organizer'
  | 'attendees'
  | 'contacts';

type Problems = Partial<Record<Problem, string>>;

/** The part of the form a field of the contract belongs to. */
const PROBLEM_OF_FIELD: Record<string, Problem> = {
  title: 'title',
  clientId: 'client',
  startsAt: 'time',
  endsAt: 'time',
  location: 'location',
  onlineUrl: 'onlineUrl',
  agenda: 'agenda',
  organizerId: 'organizer',
  attendeeIds: 'attendees',
  contactIds: 'contacts',
};

/** The part of the form a refusal concerns; anything else shows above the buttons. */
const PROBLEM_OF_CODE: Record<string, Problem> = {
  CLIENT_ARCHIVED: 'client',
  INVALID_ATTENDEE: 'attendees',
  UNKNOWN_CONTACT: 'contacts',
};

interface Person {
  id: string;
  name: string;
}

function defaultsOf(meeting: MeetingDetail | undefined, me: string): MeetingFormValues {
  return {
    title: meeting?.title ?? '',
    client: meeting?.client?.id ?? INTERNAL,
    date: meeting ? calendarDay(meeting.startsAt) : '',
    startTime: meeting ? timeInput(meeting.startsAt) : '',
    endTime: meeting ? timeInput(meeting.endsAt) : '',
    location: meeting?.location ?? '',
    onlineUrl: meeting?.onlineUrl ?? '',
    agenda: meeting?.agenda ?? '',
    // The creator organizes a new meeting.
    organizerId: meeting?.organizer.id ?? me,
    attendeeIds: meeting?.attendees.map((attendee) => attendee.id) ?? [],
    contactIds: meeting?.contacts.map((contact) => contact.id) ?? [],
  };
}

/**
 * A new meeting, or the edit of a scheduled one by those with meeting scope. It stays mounted, so
 * it fades out and gives the focus back; its form starts afresh on each opening.
 */
export function MeetingDialog({
  open,
  onClose,
  finalFocus,
  meeting,
}: {
  open: boolean;
  onClose: () => void;
  /** Where the focus goes when it closes, when the button that opened it may be gone. */
  finalFocus?: ComponentProps<typeof DialogContent>['finalFocus'];
  meeting?: MeetingDetail;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')} className="max-w-2xl" finalFocus={finalFocus}>
        {/* Unmounted once the dialog has faded out. */}
        <MeetingForm meeting={meeting} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}

function MeetingForm({ meeting, onClose }: { meeting?: MeetingDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const me = useMe();
  const ids = { attendees: useId(), contacts: useId() };
  const create = useCreateMeeting();
  const update = useUpdateMeeting(meeting?.id ?? '');
  const form = useForm<MeetingFormValues>({ defaultValues: defaultsOf(meeting, me.user.id) });
  const [problems, setProblems] = useState<Problems>({});
  const [failure, setFailure] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Every problem shows at once; the focus goes to the first one.
  useEffect(() => {
    if (Object.keys(problems).length > 0) focusFirstInvalid(formRef.current);
  }, [problems]);
  /** The conflicts to accept before the save goes through (rule 5). */
  const [confirming, setConfirming] = useState<ScheduleConflict[] | null>(null);

  const [client, date, startTime, endTime, organizerId, attendeeIds] = useWatch({
    control: form.control,
    name: ['client', 'date', 'startTime', 'endTime', 'organizerId', 'attendeeIds'],
  });
  const clientId = client === INTERNAL ? null : client;
  // Read while rendering: React Hook Form updates only the form state a component reads.
  const { dirtyFields, isDirty } = form.formState;
  const timeChanged = !!(dirtyFields.date || dirtyFields.startTime || dirtyFields.endTime);
  // An edit that leaves the time alone keeps the meeting's own instants.
  const instants =
    meeting && !timeChanged
      ? { startsAt: meeting.startsAt, endsAt: meeting.endsAt }
      : instantsOf({ date, startTime, endTime });
  const live = useQuery({
    ...conflictsQuery({
      userIds: [organizerId, ...attendeeIds],
      startsAt: instants?.startsAt ?? '',
      endsAt: instants?.endsAt ?? '',
      excludeMeetingId: meeting?.id,
    }),
    enabled: !!instants,
  });
  const conflicts = instants ? (live.data?.items ?? []) : [];

  const users = useQuery(userListQuery({ pageSize: 100 }));
  // Someone archived after the meeting was set stays listed, and is not in the active list.
  const people: Person[] = [
    ...(users.data?.items ?? []).map((user) => ({ id: user.id, name: user.name })),
    ...(meeting ? [meeting.organizer, ...meeting.attendees] : []).filter(
      (person) => person.archived,
    ),
  ];
  const personOf = new Map(people.map((person) => [person.id, person]));

  // Those who may not read clients are offered none: the meeting stays internal.
  const clients = useQuery(
    clientListQuery({ status: ['active', 'paused', 'ended'], pageSize: 100 }),
  );
  const clientItems = [
    { value: INTERNAL, label: t('calendar.meetings.form.noClient') },
    ...(clients.data?.items ?? []).map((item) => ({ value: item.id, label: item.tradeName })),
  ];
  if (meeting?.client && !clientItems.some((item) => item.value === meeting.client?.id)) {
    clientItems.push({ value: meeting.client.id, label: meeting.client.name });
  }
  // No placeholder: another client's contacts must never be offered while these load.
  const picked = useQuery({ ...clientQuery(clientId ?? ''), enabled: !!clientId });
  const contacts: Person[] = [
    ...(picked.data?.contacts ?? []).map((contact) => ({ id: contact.id, name: contact.name })),
    ...(meeting && meeting.client?.id === clientId ? meeting.contacts : []),
  ];
  const contactOf = new Map(contacts.map((contact) => [contact.id, contact]));

  /** Shows the first problem of each part of the form the contract refused. */
  function report(issues: readonly { path: PropertyKey[] }[]) {
    const found: Problems = {};
    for (const issue of issues) {
      const problem = PROBLEM_OF_FIELD[String(issue.path[0])];
      if (problem) found[problem] ??= t(`calendar.meetings.form.errors.${problem}`);
    }
    setProblems(found);
    if (Object.keys(found).length === 0) setFailure(t('errors.generic'));
  }

  async function save(values: MeetingFormValues, acceptConflicts: boolean) {
    setProblems({});
    setFailure(null);
    // An edit that changes nothing closes without a request or a "saved" toast.
    if (meeting && !isDirty) return onClose();
    const fields = {
      title: values.title,
      clientId: values.client === INTERNAL ? null : values.client,
      location: values.location,
      onlineUrl: values.onlineUrl.trim() || null,
      agenda: values.agenda,
      attendeeIds: values.attendeeIds,
      contactIds: values.contactIds,
      acceptConflicts,
    };
    try {
      if (meeting) {
        const input = updateMeetingSchema.safeParse({
          ...fields,
          organizerId: values.organizerId,
          ...(timeChanged && (instantsOf(values) ?? { startsAt: '', endsAt: '' })),
        });
        if (!input.success) return report(input.error.issues);
        if (conflicts.length > 0 && !acceptConflicts) return setConfirming(conflicts);
        await update.mutateAsync(input.data);
        toast.add({ title: t('calendar.meetings.form.saved'), type: 'success' });
      } else {
        const input = createMeetingSchema.safeParse({
          ...fields,
          ...(instantsOf(values) ?? { startsAt: '', endsAt: '' }),
        });
        if (!input.success) return report(input.error.issues);
        if (conflicts.length > 0 && !acceptConflicts) return setConfirming(conflicts);
        await create.mutateAsync(input.data);
        toast.add({ title: t('calendar.meetings.form.created'), type: 'success' });
      }
      onClose();
    } catch (error) {
      // Someone was booked elsewhere after the form last checked: ask before saving anyway.
      if (error instanceof ApiError && error.code === 'SCHEDULE_CONFLICT' && !acceptConflicts) {
        setConfirming(Array.isArray(error.details) ? (error.details as ScheduleConflict[]) : []);
        return;
      }
      const problem = error instanceof ApiError ? PROBLEM_OF_CODE[error.code ?? ''] : undefined;
      if (problem) setProblems({ [problem]: errorMessage(t, error) });
      else setFailure(errorMessage(t, error));
    }
  }

  const pending = form.formState.isSubmitting;
  const organizerItems = people
    .filter((person) => !attendeeIds.includes(person.id))
    .map((person) => ({ value: person.id, label: person.name }));

  return (
    <>
      <form
        ref={formRef}
        className="grid gap-5"
        noValidate
        onSubmit={form.handleSubmit((values) => save(values, false))}
      >
        <DialogHeader>
          <DialogTitle>
            {meeting ? t('calendar.meetings.form.editTitle') : t('calendar.actions.newMeeting')}
          </DialogTitle>
          <DialogDescription>{t('calendar.meetings.form.body')}</DialogDescription>
        </DialogHeader>
        <Field invalid={!!problems.title}>
          <FieldLabel>{t('calendar.meetings.form.title')}</FieldLabel>
          <Input
            autoComplete="off"
            maxLength={CALENDAR_LIMITS.title}
            placeholder={t('calendar.meetings.form.titlePlaceholder')}
            {...form.register('title')}
          />
          <FieldError match={!!problems.title}>{problems.title}</FieldError>
        </Field>
        <Field invalid={!!problems.client}>
          <FieldLabel>{t('calendar.form.client')}</FieldLabel>
          <Controller
            control={form.control}
            name="client"
            render={({ field }) => (
              <Select
                items={clientItems}
                value={field.value}
                onValueChange={(value) => {
                  if (!value || value === field.value) return;
                  field.onChange(value);
                  // Contacts belong to the client they were picked under.
                  form.setValue('contactIds', [], { shouldDirty: true });
                }}
              >
                <SelectTrigger onBlur={field.onBlur} ref={field.ref}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {clientItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.value === INTERNAL ? (
                        <span className="text-muted-foreground">{item.label}</span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <Avatar name={item.label} shape="square" size="sm" />
                          {item.label}
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <FieldError match={!!problems.client}>{problems.client}</FieldError>
        </Field>
        <div className="grid gap-5 sm:grid-cols-3">
          <Field invalid={!!problems.time}>
            <FieldLabel>{t('calendar.form.date')}</FieldLabel>
            <Input type="date" dir="ltr" {...form.register('date')} />
          </Field>
          <Field invalid={!!problems.time}>
            <FieldLabel>{t('calendar.form.startTime')}</FieldLabel>
            <Input type="time" dir="ltr" {...form.register('startTime')} />
          </Field>
          <Field invalid={!!problems.time}>
            <FieldLabel>{t('calendar.form.endTime')}</FieldLabel>
            <Input type="time" dir="ltr" {...form.register('endTime')} />
          </Field>
        </div>
        {problems.time ? (
          <p role="alert" className="text-sm text-destructive-text">
            {problems.time}
          </p>
        ) : (
          startTime &&
          endTime &&
          endTime <= startTime && (
            <p className="text-sm text-muted-foreground">
              {t('calendar.meetings.form.endsNextDay')}
            </p>
          )
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          <Field invalid={!!problems.location}>
            <FieldLabel>
              {t('calendar.form.location')}
              <Optional />
            </FieldLabel>
            <Input
              maxLength={CALENDAR_LIMITS.location}
              placeholder={t('calendar.meetings.form.locationPlaceholder')}
              {...form.register('location')}
            />
            <FieldError match={!!problems.location}>{problems.location}</FieldError>
          </Field>
          <Field invalid={!!problems.onlineUrl}>
            <FieldLabel>
              {t('calendar.meetings.form.onlineUrl')}
              <Optional />
            </FieldLabel>
            <Input
              type="url"
              dir="ltr"
              placeholder="https://meet.google.com/…"
              {...form.register('onlineUrl')}
            />
            <FieldError match={!!problems.onlineUrl}>{problems.onlineUrl}</FieldError>
          </Field>
        </div>
        <Field invalid={!!problems.agenda}>
          <FieldLabel>
            {t('calendar.meetings.agenda')}
            <Optional />
          </FieldLabel>
          <Textarea
            rows={3}
            maxLength={CALENDAR_LIMITS.brief}
            placeholder={t('calendar.meetings.form.agendaPlaceholder')}
            {...form.register('agenda')}
          />
          <FieldError match={!!problems.agenda}>{problems.agenda}</FieldError>
        </Field>
        {meeting && (
          <Field invalid={!!problems.organizer}>
            <FieldLabel>{t('calendar.meetings.organizer')}</FieldLabel>
            <Controller
              control={form.control}
              name="organizerId"
              render={({ field }) => (
                <Select
                  items={organizerItems}
                  value={field.value}
                  onValueChange={(value) => value && field.onChange(value)}
                >
                  <SelectTrigger onBlur={field.onBlur} ref={field.ref}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {organizerItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        <span className="flex items-center gap-2">
                          <Avatar name={item.label} size="sm" />
                          {item.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError match={!!problems.organizer}>{problems.organizer}</FieldError>
          </Field>
        )}
        <Field invalid={!!problems.attendees}>
          <FieldLabel htmlFor={ids.attendees}>
            {t('calendar.meetings.attendees')}
            <Optional />
          </FieldLabel>
          <Controller
            control={form.control}
            name="attendeeIds"
            render={({ field }) => (
              <MultiCombobox
                id={ids.attendees}
                // The organizer attends without being listed (rule 14).
                items={people.filter((person) => person.id !== organizerId)}
                value={field.value.flatMap((id) => personOf.get(id) ?? [])}
                onValueChange={(next) => field.onChange(next.map((person) => person.id))}
                itemToLabel={(person) => person.name}
                itemToKey={(person) => person.id}
                placeholder={t('calendar.meetings.form.attendeesPlaceholder')}
                emptyLabel={t('common.noMatches')}
                removeLabel={(label) => t('common.remove', { label })}
                invalid={!!problems.attendees}
              />
            )}
          />
          <FieldDescription>{t('calendar.meetings.form.attendeesHint')}</FieldDescription>
          <FieldError match={!!problems.attendees}>{problems.attendees}</FieldError>
        </Field>
        {conflicts.length > 0 && (
          <Callout
            tone="warning"
            icon={<TriangleAlertIcon />}
            title={t('calendar.form.conflictsTitle')}
            description={t('calendar.meetings.form.conflictsBody')}
            className="sm:flex-col sm:items-stretch"
            action={<ConflictList conflicts={conflicts} />}
          />
        )}
        {clientId && (
          <Field invalid={!!problems.contacts}>
            <FieldLabel htmlFor={ids.contacts}>
              {t('calendar.meetings.contacts')}
              <Optional />
            </FieldLabel>
            <Controller
              control={form.control}
              name="contactIds"
              render={({ field }) => (
                <MultiCombobox
                  id={ids.contacts}
                  items={[...contactOf.values()]}
                  value={field.value.flatMap((id) => contactOf.get(id) ?? [])}
                  onValueChange={(next) => field.onChange(next.map((contact) => contact.id))}
                  itemToLabel={(contact) => contact.name}
                  itemToKey={(contact) => contact.id}
                  placeholder={t('calendar.meetings.form.contactsPlaceholder')}
                  emptyLabel={t('common.noMatches')}
                  removeLabel={(label) => t('common.remove', { label })}
                  invalid={!!problems.contacts}
                />
              )}
            />
            <FieldError match={!!problems.contacts}>{problems.contacts}</FieldError>
          </Field>
        )}
        {failure && <FormAlert>{failure}</FormAlert>}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t('common.cancel')}</DialogClose>
          <Button type="submit" disabled={pending}>
            {meeting ? t('calendar.form.save') : t('calendar.meetings.form.create')}
          </Button>
        </DialogFooter>
      </form>

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('calendar.form.confirmConflictsTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('calendar.form.confirmConflictsBody')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ConflictList conflicts={confirming ?? []} />
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {t('common.cancel')}
            </AlertDialogClose>
            <Button
              disabled={pending}
              onClick={() => {
                setConfirming(null);
                return form.handleSubmit((values) => save(values, true))();
              }}
            >
              {t('calendar.form.saveAnyway')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

const Optional = () => {
  const { t } = useTranslation();
  return <span className="ms-1 font-normal text-muted-foreground">({t('common.optional')})</span>;
};
