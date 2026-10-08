import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import {
  CLIENT_PLATFORMS,
  type ClientDetailResponse,
  type CreatePlatformAccount,
  type CreatePlatformAccountInput,
  createPlatformAccountSchema,
  PLATFORM_ACCESS_STATES,
  type PlatformAccess,
  type PlatformAccount,
} from '@vertex-hub/contracts';
import {
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
  PlatformMark,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from '@vertex-hub/ui';
import type { TFunction } from 'i18next';
import {
  EllipsisIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  ShareIcon,
  Trash2Icon,
} from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormAlert } from '../../components/form-alert';
import { TabHeader } from '../../components/tab-header';
import { errorMessage } from '../../lib/errors';
import { formatLink, formatNumber } from '../../lib/format';
import { useReturnFocus } from '../../lib/use-return-focus';
import { useShownWhileClosing } from '../../lib/use-shown-while-closing';
import { PlatformAccessBadge } from './client-badges';
import {
  useArchivePlatformAccount,
  useCreatePlatformAccount,
  useUpdatePlatformAccount,
} from './clients.queries';

/** `null` while closed, `'new'` to add, or the account being edited. */
type Editing = PlatformAccount | 'new' | null;

/** The account's own label when it has one (two pages on one platform), else the platform. */
const accountName = (t: TFunction, account: Pick<PlatformAccount, 'platform' | 'label'>) =>
  account.label ?? t(`clients.platforms.names.${account.platform}`);

export function PlatformsTab({
  client,
  editable,
}: {
  client: ClientDetailResponse;
  editable: boolean;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<PlatformAccount | null>(null);
  // The removed account stays named while the confirmation fades out.
  const shownRemoving = useShownWhileClosing(removing);
  const archive = useArchivePlatformAccount(client.id);
  // Only one "add" button shows at a time (header or empty state): the focus falls back to it
  // when the button that opened a dialog left with the change (a removed card).
  const addButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useReturnFocus(addButton);
  const accounts = client.platformAccounts;
  const granted = accounts.filter((account) => account.agencyAccess === 'granted').length;

  const addAction = editable && (
    <Button
      ref={addButton}
      onClick={(event) => {
        returnFocus.from(event.currentTarget);
        setEditing('new');
      }}
    >
      <PlusIcon />
      {t('clients.platforms.add')}
    </Button>
  );

  return (
    <>
      <TabHeader
        title={t('clients.platforms.title')}
        description={
          accounts.length > 0
            ? t('clients.platforms.summary', {
                granted: formatNumber(granted),
                total: formatNumber(accounts.length),
              })
            : t('clients.platforms.description')
        }
        action={accounts.length > 0 && addAction}
      />
      {accounts.length === 0 ? (
        <EmptyState
          icon={<ShareIcon />}
          title={t('clients.platforms.emptyTitle')}
          description={
            editable ? t('clients.platforms.emptyHint') : t('clients.platforms.emptyReadOnlyHint')
          }
          action={addAction}
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {accounts.map((account) => (
            <li key={account.id}>
              <AccountCard
                account={account}
                editable={editable}
                onEdit={(opener) => {
                  returnFocus.from(opener);
                  setEditing(account);
                }}
                onRemove={(opener) => {
                  returnFocus.from(opener);
                  setRemoving(account);
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <AccountDialog
          clientId={client.id}
          editing={editing}
          onClose={() => setEditing(null)}
          finalFocus={returnFocus.target}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t('clients.platforms.removeTitle', {
          name: shownRemoving ? accountName(t, shownRemoving) : '',
        })}
        body={t('clients.platforms.removeBody')}
        action={t('clients.platforms.remove')}
        destructive
        pending={archive.isPending}
        finalFocus={() => returnFocus.target() ?? true}
        onConfirm={async () => {
          if (!removing) return;
          await archive.mutateAsync(removing.id);
          toast.add({ title: t('clients.platforms.removed'), type: 'success' });
        }}
      />
    </>
  );
}

function AccountCard({
  account,
  editable,
  onEdit,
  onRemove,
}: {
  account: PlatformAccount;
  editable: boolean;
  /** Each gets the menu's button, where the focus returns. */
  onEdit: (opener: HTMLElement | null) => void;
  onRemove: (opener: HTMLElement | null) => void;
}) {
  const { t } = useTranslation();
  const menuButton = useRef<HTMLButtonElement>(null);
  const name = accountName(t, account);
  return (
    <Card className="h-full gap-4 p-5">
      <div className="flex items-start gap-3">
        <PlatformMark platform={account.platform} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="truncate text-lg font-bold">{name}</h3>
          {account.label && (
            <p className="text-sm text-muted-foreground">
              {t(`clients.platforms.names.${account.platform}`)}
            </p>
          )}
        </div>
        {editable && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <IconButton ref={menuButton} label={t('clients.platforms.actions', { name })} />
              }
            >
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(menuButton.current)}>
                <PencilIcon />
                {t('clients.platforms.edit')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => onRemove(menuButton.current)}>
                <Trash2Icon />
                {t('clients.platforms.remove')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <a
        href={account.url}
        target="_blank"
        rel="noreferrer"
        className="group flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm transition-colors duration-150 ease-out hover:bg-secondary-hover"
      >
        <span dir="ltr" className="min-w-0 flex-1 truncate text-end group-hover:underline">
          {formatLink(account.url)}
        </span>
        <ExternalLinkIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </a>

      <div className="mt-auto flex flex-col gap-2 border-t border-border pt-4">
        <PlatformAccessBadge access={account.agencyAccess} />
        {account.adminNote && (
          <p className="flex items-start gap-2 text-sm">
            <KeyRoundIcon
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            />
            <span>
              <span className="sr-only">{t('clients.platforms.adminNote')}: </span>
              {account.adminNote}
            </span>
          </p>
        )}
      </div>
    </Card>
  );
}

const emptyAccount: CreatePlatformAccountInput = {
  platform: 'instagram',
  label: '',
  url: '',
  agencyAccess: 'none',
  adminNote: '',
};

const accountValues = (account: PlatformAccount | null): CreatePlatformAccountInput =>
  account
    ? {
        platform: account.platform,
        label: account.label ?? '',
        url: account.url,
        agencyAccess: account.agencyAccess,
        adminNote: account.adminNote ?? '',
      }
    : emptyAccount;

function AccountDialog({
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
  const ids = { platform: useId(), access: useId() };
  const create = useCreatePlatformAccount(clientId);
  const update = useUpdatePlatformAccount(clientId);
  const [failure, setFailure] = useState<string | null>(null);
  // The title and fields stay while the dialog fades out.
  const shown = useShownWhileClosing(editing);
  const account = shown === 'new' ? null : shown;
  const form = useForm<CreatePlatformAccountInput, unknown, CreatePlatformAccount>({
    resolver: standardSchemaResolver(createPlatformAccountSchema),
    // A refetch keeps what the user already changed.
    resetOptions: { keepDirtyValues: true },
    values: accountValues(account),
  });
  // Read while rendering: React Hook Form updates only the state a component reads.
  const { errors, isDirty } = form.formState;
  const platform = useWatch({ control: form.control, name: 'platform' });
  const platformItems = CLIENT_PLATFORMS.map((value) => ({
    value,
    label: t(`clients.platforms.names.${value}`),
  }));

  // After the exit animation, so the next opening starts afresh. A plain `reset()` would apply
  // `keepDirtyValues` and keep what was typed.
  function closed() {
    setFailure(null);
    form.reset(accountValues(account), { keepDirtyValues: false });
  }

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    // Nothing changed: close without a request or a "saved" toast.
    if (account && !isDirty) return onClose();
    try {
      if (account) {
        await update.mutateAsync({ accountId: account.id, ...values });
        toast.add({ title: t('clients.platforms.saved'), type: 'success' });
      } else {
        await create.mutateAsync(values);
        toast.add({ title: t('clients.platforms.added'), type: 'success' });
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
              {account
                ? t('clients.platforms.form.editTitle')
                : t('clients.platforms.form.addTitle')}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field>
              <FieldLabel>{t('clients.platforms.form.platform')}</FieldLabel>
              <Controller
                control={form.control}
                name="platform"
                render={({ field }) => (
                  <Select items={platformItems} value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id={ids.platform}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {platformItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          <span className="flex items-center gap-2">
                            <PlatformMark platform={item.value} size="sm" />
                            {item.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field invalid={!!errors.label}>
              <FieldLabel>
                {t('clients.platforms.form.label')}
                {platform !== 'other' && (
                  <span className="ms-1 font-normal text-muted-foreground">
                    ({t('common.optional')})
                  </span>
                )}
              </FieldLabel>
              <Input autoComplete="off" {...form.register('label')} />
              <FieldDescription>{t('clients.platforms.form.labelHint')}</FieldDescription>
              <FieldError match={!!errors.label}>
                {t('clients.platforms.form.errors.label')}
              </FieldError>
            </Field>
          </div>
          <Field invalid={!!errors.url}>
            <FieldLabel>{t('clients.platforms.form.url')}</FieldLabel>
            <Input
              type="url"
              dir="ltr"
              placeholder={t('clients.brandKit.form.urlPlaceholder')}
              autoComplete="off"
              {...form.register('url')}
            />
            <FieldError match={!!errors.url}>{t('clients.platforms.form.errors.url')}</FieldError>
          </Field>
          <Field>
            <FieldLabel id={ids.access} render={<span />}>
              {t('clients.platforms.form.access')}
            </FieldLabel>
            <Controller
              control={form.control}
              name="agencyAccess"
              render={({ field }) => (
                <ToggleGroup
                  aria-labelledby={ids.access}
                  value={[field.value ?? 'none']}
                  onValueChange={(next: PlatformAccess[]) => {
                    if (next[0]) field.onChange(next[0]);
                  }}
                >
                  {PLATFORM_ACCESS_STATES.map((access) => (
                    <ToggleGroupItem key={access} value={access}>
                      {t(`clients.platforms.form.accessOptions.${access}`)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              )}
            />
            <FieldDescription>{t('clients.platforms.form.accessHint')}</FieldDescription>
          </Field>
          <Field invalid={!!errors.adminNote}>
            <FieldLabel>{t('clients.platforms.form.adminNote')}</FieldLabel>
            <Textarea
              className="min-h-20"
              placeholder={t('clients.platforms.form.adminNotePlaceholder')}
              {...form.register('adminNote')}
            />
            <FieldError match={!!errors.adminNote}>
              {t('clients.platforms.form.errors.adminNote')}
            </FieldError>
          </Field>
          <p className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            <LockIcon aria-hidden="true" className="size-4 shrink-0" />
            {t('clients.platforms.form.noPasswords')}
          </p>
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
