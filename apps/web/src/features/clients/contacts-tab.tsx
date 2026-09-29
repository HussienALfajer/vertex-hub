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
import { useId, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormAlert } from '../../components/form-alert';
import { TabHeader } from '../../components/tab-header';
import { errorMessage } from '../../lib/errors';
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
  /** The profile asks to add a contact (from the "no approval contact" notice). */
  adding: boolean;
  onAddingChange: (adding: boolean) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<Contact | null>(null);
  const archive = useArchiveContact(client.id);
  // People who can approve first, then by name as the API sorts them.
  const contacts = [...client.contacts].sort(
    (a, b) => Number(b.hasFinalApproval) - Number(a.hasFinalApproval),
  );
  const dialog = adding ? 'new' : editing;

  const addButton = editable && (
    <Button onClick={() => setEditing('new')}>
      <UserPlusIcon />
      {t('clients.contacts.add')}
    </Button>
  );

  return (
    <>
      <TabHeader
        title={t('clients.contacts.title')}
        description={t('clients.contacts.description')}
        action={contacts.length > 0 && addButton}
      />
      {contacts.length === 0 ? (
        <EmptyState
          icon={<UsersRoundIcon />}
          title={t('clients.contacts.emptyTitle')}
          description={t('clients.contacts.emptyHint')}
          action={addButton}
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {contacts.map((contact) => (
            <li key={contact.id}>
              <ContactCard
                contact={contact}
                editable={editable}
                onEdit={() => setEditing(contact)}
                onRemove={() => setRemoving(contact)}
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
            onAddingChange(false);
          }}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t('clients.contacts.removeTitle', { name: removing?.name ?? '' })}
        body={t('clients.contacts.removeBody')}
        action={t('clients.contacts.remove')}
        destructive
        pending={archive.isPending}
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
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
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
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('clients.contacts.actions', { name })}
                />
              }
            >
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <PencilIcon />
                {t('clients.contacts.edit')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onRemove}>
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
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={t('clients.contacts.call', { name })}
                title={t('clients.contacts.call', { name })}
                render={<a href={`tel:${contact.phone}`} />}
              >
                <PhoneIcon />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={t('clients.contacts.whatsapp', { name })}
                title={t('clients.contacts.whatsapp', { name })}
                render={<a href={whatsappUrl(contact.phone)} target="_blank" rel="noreferrer" />}
              >
                <MessageCircleIcon />
              </Button>
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

function ContactDialog({
  clientId,
  editing,
  onClose,
}: {
  clientId: string;
  editing: Editing;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ids = { approval: useId() };
  const create = useCreateContact(clientId);
  const update = useUpdateContact(clientId);
  const [failure, setFailure] = useState<string | null>(null);
  const contact = editing === 'new' ? null : editing;
  const form = useForm<CreateContactInput, unknown, CreateContact>({
    resolver: standardSchemaResolver(createContactSchema),
    values: contact
      ? {
          name: contact.name,
          jobTitle: contact.jobTitle ?? '',
          phone: contact.phone ?? '',
          email: contact.email ?? '',
          hasFinalApproval: contact.hasFinalApproval,
          notes: contact.notes ?? '',
        }
      : emptyContact,
  });
  const { errors } = form.formState;

  function close() {
    setFailure(null);
    form.reset(emptyContact);
    onClose();
  }

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      if (contact) {
        await update.mutateAsync({ contactId: contact.id, ...values });
        toast.add({ title: t('clients.contacts.saved'), type: 'success' });
      } else {
        await create.mutateAsync(values);
        toast.add({ title: t('clients.contacts.added'), type: 'success' });
      }
      close();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });

  return (
    <Dialog open={editing !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent closeLabel={t('common.close')} className="max-w-xl">
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
              <Input
                type="tel"
                dir="ltr"
                className="text-end"
                autoComplete="off"
                {...form.register('phone')}
              />
              <FieldDescription>{t('clients.contacts.form.phoneHint')}</FieldDescription>
              <FieldError match={!!errors.phone}>
                {t('clients.contacts.form.errors.phone')}
              </FieldError>
            </Field>
            <Field invalid={!!errors.email}>
              <FieldLabel>{t('clients.contacts.form.email')}</FieldLabel>
              <Input
                type="email"
                dir="ltr"
                className="text-end"
                autoComplete="off"
                {...form.register('email')}
              />
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
