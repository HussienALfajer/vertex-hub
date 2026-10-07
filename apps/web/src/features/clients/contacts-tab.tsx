import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import {
  type ClientDetailResponse,
  type Contact,
  type CreateContact,
  type CreateContactInput,
  createContactSchema,
} from '@vertex-hub/contracts';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  IconButton,
  Input,
  Switch,
  Textarea,
  toast,
} from '@vertex-hub/ui';
import {
  BadgeCheckIcon,
  EllipsisIcon,
  MailIcon,
  MessageCircleIcon,
  PencilIcon,
  PhoneIcon,
  Trash2Icon,
  UserPlusIcon,
  UsersRoundIcon,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormAlert } from '../../components/form-alert';
import { TabHeader } from '../../components/tab-header';
import { errorMessage } from '../../lib/errors';
import { useReturnFocus } from '../../lib/use-return-focus';
import { useShownWhileClosing } from '../../lib/use-shown-while-closing';
import { useArchiveContact, useCreateContact, useUpdateContact } from './clients.queries';

/** `null` while closed, `'new'` to add, or the contact being edited. */
type Editing = Contact | 'new' | null;

export function ContactsTab({
  client,
  editable,
  adding,
  onAddingChange,
}: {
  client: ClientDetailResponse;
  editable: boolean;
  /** The button that asked to add a contact from outside the tab (the "no approval" notice). */
  adding: HTMLElement | null;
  onAddingChange: (adding: HTMLElement | null) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<Contact | null>(null);
  // The removed contact stays named while the confirmation fades out.
  const shownRemoving = useShownWhileClosing(removing);
  const archive = useArchiveContact(client.id);
  // Only one "add" button shows at a time (header or empty state): the focus falls back to it
  // when the button that opened a dialog left with the change (the notice, a removed card).
  const addButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useReturnFocus(addButton);
  useEffect(() => {
    if (adding) returnFocus.from(adding);
  }, [adding, returnFocus]);
  // People who can approve first, then by name as the API sorts them.
  const contacts = [...client.contacts].sort(
    (a, b) => Number(b.hasFinalApproval) - Number(a.hasFinalApproval),
  );
  const dialog = adding ? 'new' : editing;

  const addAction = editable && (
    <Button
      ref={addButton}
      onClick={(event) => {
        returnFocus.from(event.currentTarget);
        setEditing('new');
      }}
    >
      <UserPlusIcon />
      {t('clients.contacts.add')}
    </Button>
  );

  return (
    <>
      <TabHeader
        title={t('clients.contacts.title')}
        description={t('clients.contacts.description')}
        action={contacts.length > 0 && addAction}
      />
      {contacts.length === 0 ? (
        <EmptyState
          icon={<UsersRoundIcon />}
          title={t('clients.contacts.emptyTitle')}
          description={
            editable ? t('clients.contacts.emptyHint') : t('clients.contacts.emptyReadOnlyHint')
          }
          action={addAction}
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {contacts.map((contact) => (
            <li key={contact.id}>
              <ContactCard
                contact={contact}
                editable={editable}
                onEdit={(opener) => {
                  returnFocus.from(opener);
                  setEditing(contact);
                }}
                onRemove={(opener) => {
                  returnFocus.from(opener);
                  setRemoving(contact);
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <ContactDialog
          clientId={client.id}
          editing={dialog}
          onClose={() => {
            setEditing(null);
            onAddingChange(null);
          }}
          finalFocus={returnFocus.target}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t('clients.contacts.removeTitle', { name: shownRemoving?.name ?? '' })}
        body={t('clients.contacts.removeBody')}
        action={t('clients.contacts.remove')}
        destructive
        pending={archive.isPending}
        finalFocus={() => returnFocus.target() ?? true}
        onConfirm={async () => {
          if (!removing) return;
          await archive.mutateAsync(removing.id);
          toast.add({ title: t('clients.contacts.removed'), type: 'success' });
        }}
      />
    </>
  );
}

/** WhatsApp opens a chat from the international number without the plus sign. */
const whatsappUrl = (phone: string) => `https://wa.me/${phone.replace(/\D/g, '')}`;

function ContactCard({
  contact,
  editable,
  onEdit,
  onRemove,
}: {
  contact: Contact;
  editable: boolean;
  /** Each gets the menu's button, where the focus returns. */
  onEdit: (opener: HTMLElement | null) => void;
  onRemove: (opener: HTMLElement | null) => void;
}) {
  const { t } = useTranslation();
  const menuButton = useRef<HTMLButtonElement>(null);
  const name = contact.name;
  return (
    <Card
      className={
        contact.hasFinalApproval
          ? 'h-full gap-4 border-t-2 border-t-accent p-5'
          : 'h-full gap-4 p-5'
      }
    >
      <div className="flex items-start gap-3">
        <Avatar name={name} size="lg" tone={contact.hasFinalApproval ? 'accent' : 'brand'} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="truncate text-lg font-bold">{name}</h3>
          {contact.jobTitle && (
            <p className="truncate text-sm text-muted-foreground">{contact.jobTitle}</p>
          )}
          {contact.hasFinalApproval && (
            <Badge tone="gold">
              <BadgeCheckIcon aria-hidden="true" />
              {t('clients.contacts.finalApproval')}
            </Badge>
          )}
        </div>
        {editable && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <IconButton ref={menuButton} label={t('clients.contacts.actions', { name })} />
              }
            >
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(menuButton.current)}>
                <PencilIcon />
                {t('clients.contacts.edit')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => onRemove(menuButton.current)}>
                <Trash2Icon />
                {t('clients.contacts.remove')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {(contact.phone || contact.email) && (
        <div className="flex flex-col gap-2 border-t border-border pt-4 text-sm">
          {contact.phone && (
            <div className="flex items-center gap-2">
              <PhoneIcon aria-hidden="true" className="size-4 text-muted-foreground" />
              <a
                dir="ltr"
                href={`tel:${contact.phone}`}
                className="flex-1 text-end hover:underline"
              >
                {contact.phone}
              </a>
              <IconButton
                variant="outline"
                label={t('clients.contacts.call', { name })}
                render={<a href={`tel:${contact.phone}`} />}
              >
                <PhoneIcon />
              </IconButton>
              <IconButton
                variant="outline"
                label={t('clients.contacts.whatsapp', { name })}
                render={<a href={whatsappUrl(contact.phone)} target="_blank" rel="noreferrer" />}
              >
                <MessageCircleIcon />
              </IconButton>
            </div>
          )}
          {contact.email && (
            <div className="flex items-center gap-2">
              <MailIcon aria-hidden="true" className="size-4 text-muted-foreground" />
              <a
                dir="ltr"
                href={`mailto:${contact.email}`}
                className="min-w-0 flex-1 truncate text-end hover:underline"
              >
                {contact.email}
              </a>
            </div>
          )}
        </div>
      )}

      {contact.notes && (
        <p className="rounded-md bg-muted px-3 py-2 text-sm whitespace-pre-line text-muted-foreground">
          {contact.notes}
        </p>
      )}
    </Card>
  );
}

const emptyContact: CreateContactInput = {
  name: '',
  jobTitle: '',
  phone: '',
  email: '',
  hasFinalApproval: false,
  notes: '',
};

const contactValues = (contact: Contact | null): CreateContactInput =>
  contact
    ? {
        name: contact.name,
        jobTitle: contact.jobTitle ?? '',
        phone: contact.phone ?? '',
        email: contact.email ?? '',
        hasFinalApproval: contact.hasFinalApproval,
        notes: contact.notes ?? '',
      }
    : emptyContact;

function ContactDialog({
  clientId,
  editing,
  onClose,
  finalFocus,
}: {
  clientId: string;
  editing: Editing;
  onClose: () => void;
  /** Where the focus goes when it closes: the button that opened it, or a fallback. */
  finalFocus: () => HTMLElement | null;
}) {
  const { t } = useTranslation();
  const ids = { approval: useId() };
  const create = useCreateContact(clientId);
  const update = useUpdateContact(clientId);
  const [failure, setFailure] = useState<string | null>(null);
  // The title and fields stay while the dialog fades out.
  const shown = useShownWhileClosing(editing);
  const contact = shown === 'new' ? null : shown;
  const form = useForm<CreateContactInput, unknown, CreateContact>({
    resolver: standardSchemaResolver(createContactSchema),
    // A refetch keeps what the user already changed.
    resetOptions: { keepDirtyValues: true },
    values: contactValues(contact),
  });
  // Read while rendering: React Hook Form updates only the state a component reads.
  const { errors, isDirty } = form.formState;

  // After the exit animation, so the next opening starts afresh. A plain `reset()` would apply
  // `keepDirtyValues` and keep what was typed.
  function closed() {
    setFailure(null);
    form.reset(contactValues(contact), { keepDirtyValues: false });
  }

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    // Nothing changed: close without a request or a "saved" toast.
    if (contact && !isDirty) return onClose();
    try {
      if (contact) {
        await update.mutateAsync({ contactId: contact.id, ...values });
        toast.add({ title: t('clients.contacts.saved'), type: 'success' });
      } else {
        await create.mutateAsync(values);
        toast.add({ title: t('clients.contacts.added'), type: 'success' });
      }
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });

  return (
    <Dialog
      open={editing !== null}
      onOpenChange={(open) => !open && onClose()}
      onOpenChangeComplete={(open) => !open && closed()}
    >
      <DialogContent
        closeLabel={t('common.close')}
        className="max-w-xl"
        finalFocus={() => finalFocus() ?? true}
      >
        <form className="grid gap-5" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>
              {contact ? t('clients.contacts.form.editTitle') : t('clients.contacts.form.addTitle')}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field invalid={!!errors.name}>
              <FieldLabel>{t('clients.contacts.form.name')}</FieldLabel>
              <Input autoComplete="off" {...form.register('name')} />
              <FieldError match={!!errors.name}>
                {t('clients.contacts.form.errors.name')}
              </FieldError>
            </Field>
            <Field invalid={!!errors.jobTitle}>
              <FieldLabel>{t('clients.contacts.form.jobTitle')}</FieldLabel>
              <Input
                autoComplete="off"
                placeholder={t('clients.contacts.form.jobTitlePlaceholder')}
                {...form.register('jobTitle')}
              />
              <FieldError match={!!errors.jobTitle}>
                {t('clients.contacts.form.errors.jobTitle')}
              </FieldError>
            </Field>
            <Field invalid={!!errors.phone}>
              <FieldLabel>{t('clients.contacts.form.phone')}</FieldLabel>
              <Input type="tel" dir="ltr" autoComplete="off" {...form.register('phone')} />
              <FieldDescription>{t('clients.contacts.form.phoneHint')}</FieldDescription>
              <FieldError match={!!errors.phone}>
                {t('clients.contacts.form.errors.phone')}
              </FieldError>
            </Field>
            <Field invalid={!!errors.email}>
              <FieldLabel>{t('clients.contacts.form.email')}</FieldLabel>
              <Input type="email" dir="ltr" autoComplete="off" {...form.register('email')} />
              <FieldError match={!!errors.email}>
                {t('clients.contacts.form.errors.email')}
              </FieldError>
            </Field>
          </div>
          <Controller
            control={form.control}
            name="hasFinalApproval"
            render={({ field }) => (
              <label
                htmlFor={ids.approval}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-4 transition-colors duration-150 ease-out hover:bg-muted/50 has-data-checked:border-accent"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-status-gold text-status-gold-foreground">
                  <BadgeCheckIcon className="size-5" />
                </span>
                <span className="flex flex-1 flex-col gap-0.5">
                  <span className="font-medium">{t('clients.contacts.form.finalApproval')}</span>
                  <span className="text-sm text-muted-foreground">
                    {t('clients.contacts.form.finalApprovalHint')}
                  </span>
                </span>
                <Switch
                  id={ids.approval}
                  checked={field.value ?? false}
                  onCheckedChange={(checked) => field.onChange(checked)}
                  className="mt-1"
                />
              </label>
            )}
          />
          <Field invalid={!!errors.notes}>
            <FieldLabel>{t('clients.contacts.form.notes')}</FieldLabel>
            <Textarea
              placeholder={t('clients.contacts.form.notesPlaceholder')}
              {...form.register('notes')}
            />
            <FieldError match={!!errors.notes}>
              {t('clients.contacts.form.errors.notes')}
            </FieldError>
          </Field>
          {failure && <FormAlert>{failure}</FormAlert>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              {t('common.cancel')}
            </DialogClose>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? t('common.saving') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
