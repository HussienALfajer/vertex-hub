import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { Link } from '@tanstack/react-router';
import {
  APPROVAL_LIMITS,
  type CreateApprovalRequest,
  type CreateApprovalRequestInput,
  createApprovalRequestSchema,
  type IssuedApprovalRequest,
  type ReadyClient,
  type ReadyTask,
} from '@vertex-hub/contracts';
import {
  Button,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@vertex-hub/ui';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { errorMessage } from '../../lib/errors';
import { formatDateTime, formatNumber, isolateLtr } from '../../lib/format';
import { IssuedLink } from './approval-parts';
import { useCreateApprovalRequest } from './approvals.queries';

/** What a ready task would send: its snapshot's files and whether it has a text (rule 2). */
export function SnapshotSummary({ snapshot }: { snapshot: ReadyTask['snapshot'] }) {
  const { t } = useTranslation();
  const parts = [
    snapshot.files > 0 && t('approvals.ready.files', { n: formatNumber(snapshot.files) }),
    snapshot.hasText && t('approvals.ready.text'),
  ].filter(Boolean);
  return <>{parts.join(' · ')}</>;
}

/**
 * A new approval request (spec F09, screen 2): ready tasks of one client for a contact with
 * final-approval authority, with the titles the client will read. On success the link is shown
 * this once (rule 9).
 */
export function RequestDialog({
  client,
  tasks,
  onClose,
}: {
  client: ReadyClient;
  tasks: ReadyTask[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [issued, setIssued] = useState<IssuedApprovalRequest | null>(null);
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')} className="max-w-2xl">
        {issued ? (
          <IssuedStep request={issued} onClose={onClose} />
        ) : (
          <RequestForm client={client} tasks={tasks} onIssued={setIssued} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RequestForm({
  client,
  tasks,
  onIssued,
}: {
  client: ReadyClient;
  tasks: ReadyTask[];
  onIssued: (request: IssuedApprovalRequest) => void;
}) {
  const { t } = useTranslation();
  const ids = { contact: useId(), message: useId(), items: useId() };
  const create = useCreateApprovalRequest();
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<CreateApprovalRequestInput, unknown, CreateApprovalRequest>({
    resolver: standardSchemaResolver(createApprovalRequestSchema),
    defaultValues: {
      clientId: client.client.id,
      contactId: client.contacts.length === 1 ? client.contacts[0]?.id : '',
      message: '',
      items: tasks.map((task) => ({ taskId: task.id, title: task.title })),
    },
  });
  const errors = form.formState.errors;
  const contactId = form.watch('contactId');
  const contact = client.contacts.find((candidate) => candidate.id === contactId);
  const contactItems = client.contacts.map((candidate) => ({
    value: candidate.id,
    label: candidate.phone
      ? t('approvals.request.contactWithPhone', {
          name: candidate.name,
          phone: isolateLtr(candidate.phone),
        })
      : candidate.name,
  }));
  const titles = form.watch('items');
  const message = form.watch('message');

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      onIssued(await create.mutateAsync(values));
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });

  return (
    <form className="grid gap-5" onSubmit={submit} noValidate>
      <DialogHeader>
        <DialogTitle>{t('approvals.request.title', { client: client.client.name })}</DialogTitle>
        <DialogDescription>
          {t('approvals.request.body', { days: formatNumber(APPROVAL_LIMITS.linkDays) })}
        </DialogDescription>
      </DialogHeader>
      <Field invalid={!!errors.contactId}>
        <FieldLabel id={ids.contact} render={<span />}>
          {t('approvals.request.contact')}
        </FieldLabel>
        <Select
          items={contactItems}
          value={contactId || null}
          onValueChange={(next) => {
            form.setValue('contactId', next ?? '');
            form.clearErrors('contactId');
          }}
        >
          <SelectTrigger aria-labelledby={ids.contact}>
            <SelectValue placeholder={t('approvals.request.contactPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {contactItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                <span dir="auto">{item.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {contact && !contact.phone && (
          <FieldDescription>{t('approvals.request.noPhone')}</FieldDescription>
        )}
        <FieldError match={!!errors.contactId}>{t('approvals.request.errors.contact')}</FieldError>
      </Field>
      <Field invalid={!!errors.message}>
        <FieldLabel htmlFor={ids.message}>{t('approvals.request.message')}</FieldLabel>
        <Textarea
          id={ids.message}
          rows={2}
          placeholder={t('approvals.request.messagePlaceholder')}
          {...form.register('message')}
        />
        <FieldError match={!!errors.message}>{t('approvals.request.errors.message')}</FieldError>
      </Field>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">{t('approvals.request.items')}</legend>
        <p className="text-sm text-muted-foreground">{t('approvals.request.itemsHint')}</p>
        {tasks.map((task, index) => {
          const error = errors.items?.[index]?.title;
          const id = `${ids.items}-${task.id}`;
          return (
            <Field key={task.id} invalid={!!error}>
              <FieldLabel htmlFor={id} className="sr-only">
                {t('approvals.request.itemTitle', { title: task.title })}
              </FieldLabel>
              <Input id={id} dir="auto" {...form.register(`items.${index}.title`)} />
              <FieldDescription>
                <SnapshotSummary snapshot={task.snapshot} />
              </FieldDescription>
              <FieldError match={!!error}>{t('approvals.request.errors.title')}</FieldError>
            </Field>
          );
        })}
      </fieldset>
      <div className="flex flex-col gap-2 rounded-md bg-muted p-4 text-sm">
        <span className="text-xs text-muted-foreground">{t('approvals.request.preview')}</span>
        <p className="font-bold">
          {t('approvals.public.greeting', {
            name: contact?.name ?? t('approvals.request.contactPlaceholder'),
          })}
        </p>
        {message && <p className="whitespace-pre-line">{message}</p>}
        <ol className="flex list-inside list-decimal flex-col gap-1">
          {tasks.map((task, index) => (
            <li key={task.id} dir="auto">
              {titles[index]?.title || task.title}
            </li>
          ))}
        </ol>
      </div>
      {failure && <FormAlert>{failure}</FormAlert>}
      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          {t('common.cancel')}
        </DialogClose>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {t('approvals.request.create')}
        </Button>
      </DialogFooter>
    </form>
  );
}

function IssuedStep({ request, onClose }: { request: IssuedApprovalRequest; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-5">
      <DialogHeader>
        <DialogTitle>{t('approvals.request.issuedTitle')}</DialogTitle>
        <DialogDescription>
          {t('approvals.request.issuedBody', {
            contact: request.contact.name,
            date: formatDateTime(request.expiresAt),
          })}
        </DialogDescription>
      </DialogHeader>
      <IssuedLink
        link={request.link}
        contactName={request.contact.name}
        contactPhone={request.contactPhone}
      />
      <DialogFooter>
        <Button
          variant="outline"
          render={<Link to="/approvals/requests/$requestId" params={{ requestId: request.id }} />}
        >
          {t('approvals.request.open')}
        </Button>
        <Button onClick={onClose}>{t('approvals.request.done')}</Button>
      </DialogFooter>
    </div>
  );
}
