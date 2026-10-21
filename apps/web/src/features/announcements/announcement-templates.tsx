import { useQuery } from '@tanstack/react-query';
import {
  ANNOUNCEMENT_TEMPLATE_LIMITS,
  type AnnouncementTemplate,
  createAnnouncementTemplateSchema,
} from '@vertex-hub/contracts';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldError,
  FieldLabel,
  IconButton,
  Input,
  Skeleton,
  toast,
} from '@vertex-hub/ui';
import { ArchiveIcon, FileStackIcon, PencilIcon } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormAlert } from '../../components/form-alert';
import { LoadError } from '../../components/load-error';
import { useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import type { templateFields } from './announcement-form';
import { PriorityBadge } from './announcement-parts';
import {
  announcementTemplatesQuery,
  useArchiveAnnouncementTemplate,
  useCreateAnnouncementTemplate,
  useUpdateAnnouncementTemplate,
} from './announcements.queries';
import { readsAllAnnouncements } from './announcements-page';

/**
 * Screen 14 and rule D12: the caller's personal templates and the shared ones. "Use" fills the
 * editor; the templates the caller keeps are renamed and archived here.
 */
export function TemplatesDialog({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (template: AnnouncementTemplate) => void;
}) {
  const { t } = useTranslation();
  const templates = useQuery(announcementTemplatesQuery);
  const [renaming, setRenaming] = useState<AnnouncementTemplate | null>(null);
  const [archiving, setArchiving] = useState<AnnouncementTemplate | null>(null);
  const archive = useArchiveAnnouncementTemplate();
  const items = templates.data?.items ?? [];
  const groups = [
    {
      key: 'personal',
      title: t('announcements.templates.personal'),
      items: items.filter((item) => !item.shared),
    },
    {
      key: 'shared',
      title: t('announcements.templates.shared'),
      items: items.filter((item) => item.shared),
    },
  ];
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t('common.close')} className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('announcements.templates.title')}</DialogTitle>
          <DialogDescription>{t('announcements.templates.body')}</DialogDescription>
        </DialogHeader>
        {templates.isPending ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : templates.isError ? (
          <LoadError
            message={t('announcements.templates.loadError')}
            onRetry={() => templates.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<FileStackIcon />}
            title={t('announcements.templates.empty')}
            description={t('announcements.templates.emptyHint')}
          />
        ) : (
          <div className="flex max-h-[60vh] flex-col gap-5 overflow-y-auto">
            {groups.map(
              (group) =>
                group.items.length > 0 && (
                  <section key={group.key} className="flex flex-col gap-2">
                    <h3 className="text-sm font-medium text-muted-foreground">{group.title}</h3>
                    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                      {group.items.map((template) => (
                        <li key={template.id} className="flex items-center gap-3 p-3">
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="flex flex-wrap items-center gap-2 font-medium">
                              {template.name}
                              <PriorityBadge priority={template.priority} />
                            </span>
                            <span className="truncate text-sm text-muted-foreground">
                              {template.title}
                            </span>
                          </div>
                          {template.editable && (
                            <>
                              <IconButton
                                label={t('announcements.templates.renameNamed', {
                                  name: template.name,
                                })}
                                onClick={() => setRenaming(template)}
                              >
                                <PencilIcon />
                              </IconButton>
                              <IconButton
                                label={t('announcements.templates.archiveNamed', {
                                  name: template.name,
                                })}
                                onClick={() => setArchiving(template)}
                              >
                                <ArchiveIcon />
                              </IconButton>
                            </>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              onPick(template);
                              onClose();
                            }}
                          >
                            {t('announcements.templates.use')}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ),
            )}
          </div>
        )}
      </DialogContent>
      {renaming && <RenameTemplateDialog template={renaming} onClose={() => setRenaming(null)} />}
      <ConfirmDialog
        open={archiving !== null}
        onClose={() => setArchiving(null)}
        title={t('announcements.templates.archiveTitle')}
        body={t('announcements.templates.archiveBody', { name: archiving?.name ?? '' })}
        action={t('announcements.templates.archive')}
        destructive
        pending={archive.isPending}
        onConfirm={async () => {
          if (!archiving) return;
          await archive.mutateAsync(archiving.id);
          toast.add({ title: t('announcements.templates.archived'), type: 'success' });
        }}
      />
    </Dialog>
  );
}

const nameValid = (name: string) =>
  name.trim().length >= ANNOUNCEMENT_TEMPLATE_LIMITS.nameMin &&
  name.trim().length <= ANNOUNCEMENT_TEMPLATE_LIMITS.nameMax;

function RenameTemplateDialog({
  template,
  onClose,
}: {
  template: AnnouncementTemplate;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const update = useUpdateAnnouncementTemplate();
  const [name, setName] = useState(template.name);
  const [invalid, setInvalid] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!nameValid(name)) {
      setInvalid(true);
      return;
    }
    setFailure(null);
    try {
      await update.mutateAsync({ id: template.id, input: { name: name.trim() } });
      toast.add({ title: t('announcements.templates.renamed'), type: 'success' });
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('announcements.templates.rename')}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <Field invalid={invalid}>
            <FieldLabel htmlFor={id}>{t('announcements.templates.name')}</FieldLabel>
            <Input
              id={id}
              value={name}
              maxLength={ANNOUNCEMENT_TEMPLATE_LIMITS.nameMax}
              onChange={(event) => {
                setName(event.target.value);
                setInvalid(false);
              }}
            />
            <FieldError match={invalid}>{t('announcements.templates.nameError')}</FieldError>
          </Field>
          {failure && <FormAlert>{failure}</FormAlert>}
          <DialogFooter>
            <Button type="submit" disabled={update.isPending}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Rule D12: "Save as template" keeps the title, body, priority, acknowledgement and link. */
export function SaveTemplateDialog({
  fields,
  onClose,
}: {
  fields: ReturnType<typeof templateFields>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const nameId = useId();
  const sharedId = useId();
  const create = useCreateAnnouncementTemplate();
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    // The dialog sits in the editor's React tree: its form must not submit too.
    event.stopPropagation();
    if (!nameValid(name)) {
      setInvalid(true);
      return;
    }
    const input = createAnnouncementTemplateSchema.safeParse({ ...fields, name, shared });
    if (!input.success) {
      setFailure(t('announcements.templates.incomplete'));
      return;
    }
    setFailure(null);
    try {
      await create.mutateAsync(input.data);
      toast.add({ title: t('announcements.templates.saved'), type: 'success' });
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('announcements.templates.saveTitle')}</DialogTitle>
          <DialogDescription>{t('announcements.templates.saveBody')}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <Field invalid={invalid}>
            <FieldLabel htmlFor={nameId}>{t('announcements.templates.name')}</FieldLabel>
            <Input
              id={nameId}
              autoFocus
              value={name}
              maxLength={ANNOUNCEMENT_TEMPLATE_LIMITS.nameMax}
              placeholder={t('announcements.templates.namePlaceholder')}
              onChange={(event) => {
                setName(event.target.value);
                setInvalid(false);
              }}
            />
            <FieldError match={invalid}>{t('announcements.templates.nameError')}</FieldError>
          </Field>
          {readsAllAnnouncements(me) && (
            <label htmlFor={sharedId} className="flex cursor-pointer items-start gap-3 text-sm">
              <Checkbox id={sharedId} checked={shared} onCheckedChange={setShared} />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{t('announcements.templates.shareChoice')}</span>
                <span className="text-muted-foreground">
                  {t('announcements.templates.shareHint')}
                </span>
              </span>
            </label>
          )}
          {failure && <FormAlert>{failure}</FormAlert>}
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {t('announcements.templates.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
