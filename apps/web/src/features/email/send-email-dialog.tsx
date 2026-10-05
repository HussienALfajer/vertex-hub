import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery } from '@tanstack/react-query';
import {
  type ClientDetailResponse,
  type ClientEmail,
  type ClientEmailInput,
  type ClientEmailKind,
  clientEmailSchema,
  EMAIL_LIMITS,
  type EmailData,
} from '@vertex-hub/contracts';
import { type ClientEmailData, clientEmailContent, clientEmailDraft } from '@vertex-hub/messages';
import {
  Button,
  Callout,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldError,
  FieldLabel,
  Input,
  Skeleton,
  Switch,
  Textarea,
  toast,
} from '@vertex-hub/ui';
import { FileTextIcon, HourglassIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { LoadError } from '../../components/load-error';
import { ApiError } from '../../lib/api/client';
import { useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { clientQuery } from '../clients/clients.queries';
import { type ClientEmailTarget, useSendClientEmail } from './email.queries';

/**
 * A client email's kind with the document's facts, as the caller knows them: the dialog adds the
 * client's name and the sender's signature.
 */
export type ClientEmailDraft = {
  [Kind in ClientEmailKind]: { kind: Kind; data: Omit<EmailData<Kind>, 'client' | 'signature'> };
}[ClientEmailKind];

/** The record's PDF the email carries (rule 20); it must be ready before sending. */
export interface EmailAttachment {
  fileName: string;
  ready: boolean;
}

interface SendEmailDialogProps {
  open: boolean;
  onClose: () => void;
  clientId: string;
  target: ClientEmailTarget;
  draft: ClientEmailDraft;
  /** Null for the emails without one (ad budget notice). */
  attachment: EmailAttachment | null;
}

/**
 * F14 email screen 3, rules 16–18: one client email from its document, to the client's contacts
 * with an email, with copies to the account manager and the sender, and a subject and message
 * prefilled from the kind's template.
 */
export function SendEmailDialog({ open, onClose, clientId, ...props }: SendEmailDialogProps) {
  const { t } = useTranslation();
  const client = useQuery({ ...clientQuery(clientId), enabled: open });
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')} className="max-w-2xl">
        {client.isPending ? (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-32" />
            <Skeleton className="h-48" />
          </div>
        ) : client.isError ? (
          <LoadError message={t('email.send.loadError')} onRetry={() => client.refetch()} />
        ) : (
          <EmailForm
            client={client.data}
            onReload={() => void client.refetch()}
            onClose={onClose}
            {...props}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EmailForm({
  client,
  target,
  draft,
  attachment,
  onReload,
  onClose,
}: Omit<SendEmailDialogProps, 'open' | 'clientId'> & {
  client: ClientDetailResponse;
  onReload: () => void;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const ids = {
    recipients: useId(),
    ccAccountManager: useId(),
    ccMe: useId(),
    subject: useId(),
    message: useId(),
  };
  const send = useSendClientEmail(target);
  const [failure, setFailure] = useState<string | null>(null);
  // The signature is the sender's; the preview shows only the document's facts.
  const email = {
    kind: draft.kind,
    data: {
      ...draft.data,
      client: client.tradeName,
      signature: { name: me.user.name, title: null, phone: null, email: me.user.email },
    },
  } as ClientEmailData;
  const prefilled = clientEmailDraft(email);
  const facts = clientEmailContent(email, null).facts ?? [];
  const withEmail = client.contacts.filter((contact) => contact.email);
  const form = useForm<ClientEmailInput, unknown, ClientEmail>({
    resolver: standardSchemaResolver(clientEmailSchema),
    defaultValues: {
      contactIds: withEmail.length === 1 && withEmail[0] ? [withEmail[0].id] : [],
      ccAccountManager: true,
      ccMe: false,
      subject: prefilled.subject,
      message: prefilled.message,
    },
  });
  const errors = form.formState.errors;
  const blocked = attachment !== null && !attachment.ready;

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      await send.mutateAsync(values);
      toast.add({ title: t('email.send.queued'), type: 'success' });
      onClose();
    } catch (error) {
      // Edge case 10: a contact changed while the dialog was open.
      if (error instanceof ApiError && error.code === 'INVALID_RECIPIENT') onReload();
      setFailure(errorMessage(t, error));
    }
  });

  return (
    <form className="grid gap-5" onSubmit={submit} noValidate>
      <DialogHeader>
        <DialogTitle>{t('email.send.title', { kind: t(`email.kinds.${draft.kind}`) })}</DialogTitle>
        <DialogDescription>{t('email.send.body', { client: client.tradeName })}</DialogDescription>
      </DialogHeader>
      {blocked && (
        <Callout
          tone="warning"
          icon={<HourglassIcon />}
          title={t('email.send.pdfNotReady')}
          description={t('email.send.pdfNotReadyHint')}
        />
      )}
      {/* A fieldset, not a Field: each checkbox is named by its contact's label. */}
      <fieldset className="flex flex-col gap-2" aria-describedby={`${ids.recipients}-error`}>
        <legend className="mb-2 text-sm font-medium">{t('email.send.recipients')}</legend>
        <Controller
          control={form.control}
          name="contactIds"
          render={({ field }) => (
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
              {client.contacts.length === 0 && (
                <li className="px-3 py-2 text-sm text-muted-foreground">
                  {t('email.send.noContacts')}
                </li>
              )}
              {client.contacts.map((contact) => {
                const checked = field.value.includes(contact.id);
                const id = `${ids.recipients}-${contact.id}`;
                return (
                  <li key={contact.id}>
                    <label
                      htmlFor={id}
                      className={`flex items-center gap-3 px-3 py-2 text-sm ${
                        contact.email ? 'cursor-pointer' : 'text-muted-foreground'
                      }`}
                    >
                      <Checkbox
                        id={id}
                        checked={checked}
                        disabled={!contact.email}
                        onCheckedChange={(next) =>
                          field.onChange(
                            next
                              ? [...field.value, contact.id]
                              : field.value.filter((id) => id !== contact.id),
                          )
                        }
                      />
                      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2">
                        <span className="font-medium">{contact.name}</span>
                        {contact.jobTitle && (
                          <span className="text-xs text-muted-foreground">{contact.jobTitle}</span>
                        )}
                      </span>
                      {contact.email ? (
                        <bdi dir="ltr" className="text-xs text-muted-foreground">
                          {contact.email}
                        </bdi>
                      ) : (
                        <span className="text-xs">{t('email.send.noEmail')}</span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        />
        {errors.contactIds && (
          <p id={`${ids.recipients}-error`} role="alert" className="text-sm text-destructive-text">
            {t('email.send.errors.recipients', { max: EMAIL_LIMITS.to })}
          </p>
        )}
      </fieldset>
      <div className="flex flex-col gap-3">
        <Controller
          control={form.control}
          name="ccAccountManager"
          render={({ field }) => (
            <div className="flex items-center justify-between gap-4 text-sm">
              <label htmlFor={ids.ccAccountManager}>
                {t('email.send.ccAccountManager', { name: client.accountManager.name })}
              </label>
              <Switch
                id={ids.ccAccountManager}
                checked={field.value ?? true}
                onCheckedChange={field.onChange}
              />
            </div>
          )}
        />
        <Controller
          control={form.control}
          name="ccMe"
          render={({ field }) => (
            <div className="flex items-center justify-between gap-4 text-sm">
              <label htmlFor={ids.ccMe}>{t('email.send.ccMe')}</label>
              <Switch
                id={ids.ccMe}
                checked={field.value ?? false}
                onCheckedChange={field.onChange}
              />
            </div>
          )}
        />
      </div>
      <Field invalid={!!errors.subject}>
        <FieldLabel htmlFor={ids.subject}>{t('email.send.subject')}</FieldLabel>
        <Input id={ids.subject} dir="auto" {...form.register('subject')} />
        <FieldError match={!!errors.subject}>
          {t('email.send.errors.subject', { max: EMAIL_LIMITS.subject })}
        </FieldError>
      </Field>
      <Field invalid={!!errors.message}>
        <FieldLabel htmlFor={ids.message}>{t('email.send.message')}</FieldLabel>
        <Textarea id={ids.message} rows={7} dir="auto" {...form.register('message')} />
        <FieldError match={!!errors.message}>
          {t('email.send.errors.message', { max: EMAIL_LIMITS.message })}
        </FieldError>
      </Field>
      <div className="flex flex-col gap-2 rounded-md bg-muted p-4 text-sm">
        <span className="text-xs text-muted-foreground">{t('email.send.preview')}</span>
        {facts.length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            {facts.map((fact) => (
              <div key={fact.label} className="contents">
                <dt className="text-muted-foreground">{fact.label}</dt>
                <dd className="font-medium">{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="text-xs text-muted-foreground">{t('email.send.signature')}</p>
        {attachment && (
          <p className="flex items-center gap-2">
            <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
            <bdi dir="ltr">{attachment.fileName}</bdi>
          </p>
        )}
      </div>
      {failure && <FormAlert>{failure}</FormAlert>}
      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          {t('common.cancel')}
        </DialogClose>
        <Button type="submit" disabled={blocked || form.formState.isSubmitting}>
          {form.formState.isSubmitting ? t('email.send.sending') : t('email.send.submit')}
        </Button>
      </DialogFooter>
    </form>
  );
}
