import type { FileItem, FileVersion } from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  toast,
} from '@vertex-hub/ui';
import type { TFunction } from 'i18next';
import {
  ArchiveRestoreIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  CircleOffIcon,
  DownloadIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  EyeIcon,
  LockIcon,
  LockOpenIcon,
  PencilIcon,
  UploadIcon,
  XIcon,
} from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../lib/errors';
import { formatDateTime, formatNumber } from '../../lib/format';
import {
  FileThumbnail,
  FinalBadge,
  latestVersion,
  RemovedBadge,
  VersionBadge,
  versionSize,
} from './file-parts';
import type { PreviewEntry } from './file-preview-dialog';
import {
  type FileOwnerRef,
  fileDownloadUrl,
  useRestoreFileItem,
  useRestoreFileVersion,
  useSetFileFinal,
} from './files.queries';

/*
 * A versioned file item (spec F10 screens 2, 4, 5): a task deliverable, a brand file or a
 * document. Its latest version, the version history and the actions its `permissions` allow.
 */

export type Removing = { kind: 'item' | 'version'; id: string; label: string } | null;

/** What a card asks its host to open; the host owns the dialogs. */
export interface FileItemActions {
  owner: FileOwnerRef;
  onPreview: (entries: PreviewEntry[], index: number) => void;
  onNewVersion: (item: FileItem) => void;
  onRename: (item: FileItem) => void;
  onRemove: (removing: Removing) => void;
  onSetConfidential: (item: FileItem, confidential: boolean) => void;
}

/** Runs a change and reports it in a toast. */
async function attempt(t: TFunction, action: Promise<unknown>, done: string) {
  try {
    await action;
    toast.add({ title: done, type: 'success' });
  } catch (error) {
    toast.add({ title: errorMessage(t, error), type: 'error' });
  }
}

/** Who added a version and when, and its size or the link's host. */
export function VersionMeta({ version }: { version: FileVersion }) {
  return (
    <span className="text-xs text-muted-foreground">
      {[version.uploadedBy.name, formatDateTime(version.createdAt), versionSize(version)]
        .filter(Boolean)
        .join(' · ')}
    </span>
  );
}

/** Download an upload, open a link. */
export function OpenButton({ version, name }: { version: FileVersion; name: string }) {
  const { t } = useTranslation();
  return version.kind === 'upload' ? (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={t('files.downloadNamed', { name })}
      render={<a href={fileDownloadUrl(version.id)} />}
    >
      <DownloadIcon />
    </Button>
  ) : (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={t('files.openLinkNamed', { name })}
      render={<a href={version.url ?? ''} target="_blank" rel="noopener noreferrer" />}
    >
      <ExternalLinkIcon />
    </Button>
  );
}

export function ConfidentialBadge() {
  const { t } = useTranslation();
  return (
    <Badge tone="warning">
      <LockIcon aria-hidden="true" />
      {t('files.confidential')}
    </Badge>
  );
}

const entriesOf = (item: FileItem, versions: FileVersion[]): PreviewEntry[] =>
  versions.map((version) => ({ name: item.name, version }));

export function FileItemCard({
  item,
  actions,
  finalMarkable = false,
  meta,
  versionMark,
}: {
  item: FileItem;
  actions: FileItemActions;
  /** Rule 10: the final marker can be set (the task is approved or delivered). */
  finalMarkable?: boolean;
  /** A line under the name: where a document belongs. */
  meta?: ReactNode;
  /** A badge next to a version's number: where it stands in the task's review (F09). */
  versionMark?: (version: FileVersion) => ReactNode;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const historyId = useId();
  const restore = useRestoreFileItem(actions.owner);
  const live = item.versions.filter((version) => !version.archivedAt);
  const latest = latestVersion(item.versions) ?? item.versions[0];
  const final = live.find((version) => version.isFinal);
  const removed = item.archivedAt !== null;
  const { permissions } = item;
  if (!latest) return null;
  const previewAt = (version: FileVersion) =>
    actions.onPreview(entriesOf(item, live), Math.max(0, live.indexOf(version)));

  return (
    <li
      className={cn(
        'flex flex-col gap-3 rounded-md border border-border p-3',
        removed && 'bg-muted',
      )}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          className="rounded-md focus-visible:outline-2 focus-visible:outline-ring"
          aria-label={t('files.previewNamed', { name: item.name })}
          onClick={() => previewAt(latest)}
        >
          <FileThumbnail version={latest} className="size-16" />
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 truncate font-medium" dir="auto">
              {item.name}
            </span>
            <VersionBadge number={latest.number} />
            {versionMark?.(latest)}
            {final &&
              (final.id === latest.id ? (
                <FinalBadge source={final.finalSource} />
              ) : (
                <Badge tone="success">{t('files.finalIs', { number: final.number })}</Badge>
              ))}
            {item.confidential && <ConfidentialBadge />}
            {removed && <RemovedBadge />}
          </div>
          {meta}
          {latest.note && <p className="text-sm whitespace-pre-line">{latest.note}</p>}
          <VersionMeta version={latest} />
        </div>
        <div className="flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('files.previewNamed', { name: item.name })}
            onClick={() => previewAt(latest)}
          >
            <EyeIcon />
          </Button>
          <OpenButton version={latest} name={item.name} />
          {removed
            ? permissions.canRestore && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={restore.isPending}
                  onClick={() => attempt(t, restore.mutateAsync(item.id), t('files.restoredDone'))}
                >
                  <ArchiveRestoreIcon />
                  {t('files.restore')}
                </Button>
              )
            : (permissions.canAddVersion ||
                permissions.canRename ||
                permissions.canRemove ||
                permissions.canSetConfidential) && <ItemMenu item={item} actions={actions} />}
        </div>
      </div>
      <div>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={expanded}
          aria-controls={historyId}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronDownIcon className={cn('transition-transform', expanded && 'rotate-180')} />
          {t('files.versions', {
            count: item.versions.length,
            n: formatNumber(item.versions.length),
          })}
        </Button>
      </div>
      {expanded && (
        <ol id={historyId} className="flex flex-col gap-2 border-s-2 border-border ps-3">
          {item.versions.map((version) => (
            <VersionRow
              key={version.id}
              item={item}
              version={version}
              liveCount={live.length}
              actions={actions}
              finalMarkable={finalMarkable}
              mark={versionMark?.(version)}
              onPreview={() => previewAt(version)}
            />
          ))}
        </ol>
      )}
    </li>
  );
}

function ItemMenu({ item, actions }: { item: FileItem; actions: FileItemActions }) {
  const { t } = useTranslation();
  const { permissions } = item;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('files.actionsFor', { name: item.name })}
          />
        }
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {permissions.canAddVersion && (
          <DropdownMenuItem onClick={() => actions.onNewVersion(item)}>
            <UploadIcon />
            {t('files.newVersion')}
          </DropdownMenuItem>
        )}
        {permissions.canRename && (
          <DropdownMenuItem onClick={() => actions.onRename(item)}>
            <PencilIcon />
            {t('files.rename')}
          </DropdownMenuItem>
        )}
        {permissions.canSetConfidential && (
          <DropdownMenuItem onClick={() => actions.onSetConfidential(item, !item.confidential)}>
            {item.confidential ? <LockOpenIcon /> : <LockIcon />}
            {item.confidential ? t('files.makeNotConfidential') : t('files.makeConfidential')}
          </DropdownMenuItem>
        )}
        {permissions.canRemove && (
          <DropdownMenuItem
            variant="destructive"
            onClick={() => actions.onRemove({ kind: 'item', id: item.id, label: item.name })}
          >
            <XIcon />
            {t('files.remove')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One version in the history, with the final marker's actions on deliverables (rule 10). */
function VersionRow({
  item,
  version,
  liveCount,
  actions,
  finalMarkable,
  mark,
  onPreview,
}: {
  item: FileItem;
  version: FileVersion;
  liveCount: number;
  actions: FileItemActions;
  finalMarkable: boolean;
  mark: ReactNode;
  onPreview: () => void;
}) {
  const { t } = useTranslation();
  const setFinal = useSetFileFinal(actions.owner);
  const restore = useRestoreFileVersion(actions.owner);
  const removed = version.archivedAt !== null;
  const live = !removed && !item.archivedAt;
  const canMark = live && item.permissions.canSetFinal && !version.isFinal && finalMarkable;
  const canClear = live && item.permissions.canSetFinal && version.isFinal;
  const canRemove =
    live &&
    item.permissions.canAddVersion &&
    version.canRemove &&
    !version.isFinal &&
    liveCount > 1;
  const label = t('files.versionNamed', { name: item.name, number: version.number });

  return (
    <li className="flex flex-wrap items-start gap-2 text-sm">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <VersionBadge number={version.number} />
          {!removed && mark}
          {version.isFinal && <FinalBadge source={version.finalSource} />}
          {version.isFinal && version.finalSource !== 'client' && (
            <span className="text-xs text-muted-foreground">
              {version.finalSource === 'auto'
                ? t('files.finalAuto')
                : t('files.finalBy', { name: version.finalMarkedBy?.name ?? '' })}
            </span>
          )}
          {removed && <RemovedBadge />}
        </div>
        {version.note && <p className="whitespace-pre-line">{version.note}</p>}
        <VersionMeta version={version} />
      </div>
      <div className="flex shrink-0 flex-wrap items-center">
        {!removed && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('files.previewNamed', { name: label })}
            onClick={onPreview}
          >
            <EyeIcon />
          </Button>
        )}
        <OpenButton version={version} name={label} />
        {canMark && (
          <Button
            variant="ghost"
            size="sm"
            disabled={setFinal.isPending}
            onClick={() =>
              attempt(
                t,
                setFinal.mutateAsync({ versionId: version.id, final: true }),
                t('files.finalSet', { number: version.number }),
              )
            }
          >
            <CircleCheckIcon />
            {t('files.markFinal')}
          </Button>
        )}
        {canClear && (
          <Button
            variant="ghost"
            size="sm"
            disabled={setFinal.isPending}
            onClick={() =>
              attempt(
                t,
                setFinal.mutateAsync({ versionId: version.id, final: false }),
                t('files.finalCleared'),
              )
            }
          >
            <CircleOffIcon />
            {t('files.clearFinal')}
          </Button>
        )}
        {canRemove && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('common.remove', { label })}
            onClick={() => actions.onRemove({ kind: 'version', id: version.id, label })}
          >
            <XIcon />
          </Button>
        )}
        {removed && !item.archivedAt && item.permissions.canRestore && (
          <Button
            variant="ghost"
            size="sm"
            disabled={restore.isPending}
            onClick={() => attempt(t, restore.mutateAsync(version.id), t('files.restoredDone'))}
          >
            <ArchiveRestoreIcon />
            {t('files.restore')}
          </Button>
        )}
      </div>
    </li>
  );
}
