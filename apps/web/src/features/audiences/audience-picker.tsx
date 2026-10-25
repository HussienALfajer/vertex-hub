import { useQuery } from '@tanstack/react-query';
import {
  AUDIENCE_LIST_MAX,
  type Audience,
  type AudienceInput,
  type AudienceMember,
  audienceSchema,
  type DepartmentCode,
  ROLES,
} from '@vertex-hub/contracts';
import {
  Avatar,
  Button,
  Field,
  FieldLabel,
  IconButton,
  MultiCombobox,
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
} from '@vertex-hub/ui';
import {
  BriefcaseBusinessIcon,
  Building2Icon,
  FolderKanbanIcon,
  GlobeIcon,
  ShieldIcon,
  UndoIcon,
  UserIcon,
  XIcon,
} from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { can, useMe } from '../../lib/auth';
import { formatNumber } from '../../lib/format';
import { clientListQuery } from '../clients/clients.queries';
import { departmentListQuery } from '../departments/departments.queries';
import { useDepartmentNames } from '../projects/project-badges';
import { projectListQuery } from '../projects/projects.queries';
import { userListQuery } from '../users/users.queries';
import { audiencePreviewQuery } from './audiences.queries';

/*
 * The audience picker (spec F16 rule D2, ADR 0038): chips for each source, a search in each, and
 * the live count and names of who it reaches, each name removable. Announcements use it first;
 * the board, chat and portal reuse it.
 */

const SOURCES = ['everyone', 'departments', 'roles', 'users', 'projects', 'clients'] as const;

type Source = (typeof SOURCES)[number];

type ListSource = Exclude<Source, 'everyone'>;

const LIST_SOURCES = SOURCES.filter((source): source is ListSource => source !== 'everyone');

const LIST_KEYS = [...LIST_SOURCES, 'exclude'] as const;

const SOURCE_ICONS = {
  everyone: GlobeIcon,
  departments: Building2Icon,
  roles: ShieldIcon,
  users: UserIcon,
  projects: FolderKanbanIcon,
  clients: BriefcaseBusinessIcon,
} as const;

/** The names shown before "Show all". */
const NAMES_SHOWN = 24;

/** The sources an audience uses. */
function usedSources(audience: AudienceInput): Source[] {
  return SOURCES.filter((source) =>
    source === 'everyone'
      ? audience.everyone === true
      : (audience[source as ListSource]?.length ?? 0) > 0,
  );
}

/** The audience without empty lists, or null while it has no source (nothing to preview). */
export function validAudience(audience: AudienceInput): Audience | null {
  const result = audienceSchema.safeParse(audience);
  if (!result.success) return null;
  const clean: Audience = {};
  if (result.data.everyone) clean.everyone = true;
  for (const key of LIST_KEYS) {
    const list = result.data[key];
    if (list?.length) Object.assign(clean, { [key]: list });
  }
  return clean;
}

type Option = { id: string; label: string };

export function AudiencePicker({
  value,
  onChange,
  invalid,
  labelId,
}: {
  value: AudienceInput;
  onChange: (next: AudienceInput) => void;
  invalid?: boolean;
  /** The label of the whole picker, which names the source chips. */
  labelId?: string;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const ids = {
    departments: useId(),
    roles: useId(),
    users: useId(),
    projects: useId(),
    clients: useId(),
  };
  // A source stays open while it is empty, until its chip is pressed again.
  const [opened, setOpened] = useState<Source[]>(() => usedSources(value));
  const available = SOURCES.filter(
    (source) =>
      (source !== 'projects' || can(me, 'projects.read')) &&
      (source !== 'clients' || can(me, 'clients.read')),
  );

  const departments = useQuery(departmentListQuery);
  const users = useQuery(userListQuery({ pageSize: 100 }));
  const projects = useQuery({
    ...projectListQuery({ pageSize: 100 }),
    enabled: opened.includes('projects'),
  });
  const clients = useQuery({
    ...clientListQuery({ pageSize: 100 }),
    enabled: opened.includes('clients'),
  });

  const options: Record<ListSource, Option[]> = {
    departments: (departments.data?.items ?? []).map(({ code, name }) => ({
      id: code,
      label: name,
    })),
    roles: ROLES.map((role) => ({ id: role, label: t(`roles.${role}`) })),
    users: (users.data?.items ?? []).map(({ id, name }) => ({ id, label: name })),
    projects: (projects.data?.items ?? []).map(({ id, name, client }) => ({
      id,
      label: t('audiences.projectOption', { name, client: client.name }),
    })),
    clients: (clients.data?.items ?? []).map(({ id, tradeName }) => ({ id, label: tradeName })),
  };

  const setSources = (next: Source[]) => {
    const audience: AudienceInput = { ...value };
    for (const source of SOURCES) {
      if (next.includes(source)) continue;
      if (source === 'everyone') delete audience.everyone;
      else delete audience[source];
    }
    if (next.includes('everyone')) audience.everyone = true;
    setOpened(next);
    onChange(audience);
  };

  const setList = (source: ListSource, list: string[]) =>
    onChange({ ...value, [source]: list.length ? list : undefined });

  return (
    <div className="flex flex-col gap-4" data-invalid={invalid || undefined}>
      <ToggleGroup
        multiple
        aria-labelledby={labelId}
        value={opened}
        onValueChange={(next: Source[]) => setSources(next)}
        aria-invalid={invalid || undefined}
        className="flex-wrap aria-invalid:border-destructive-text"
      >
        {available.map((source, index) => {
          const Icon = SOURCE_ICONS[source];
          return (
            // The first chip takes the focus when the audience is refused.
            <ToggleGroupItem
              key={source}
              value={source}
              aria-invalid={(invalid && index === 0) || undefined}
            >
              <Icon />
              {t(`audiences.sources.${source}`)}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>

      {LIST_SOURCES.map((key) => {
        if (!opened.includes(key)) return null;
        const byId = new Map(options[key].map((option) => [option.id, option]));
        const selected = (value[key] ?? []) as string[];
        return (
          <Field key={key}>
            <FieldLabel htmlFor={ids[key]}>{t(`audiences.sources.${key}`)}</FieldLabel>
            <MultiCombobox
              id={ids[key]}
              items={options[key]}
              value={selected.map((id) => byId.get(id) ?? { id, label: t('audiences.unknown') })}
              onValueChange={(next) =>
                setList(key, next.map((option) => option.id).slice(0, AUDIENCE_LIST_MAX))
              }
              itemToLabel={(option) => option.label}
              itemToKey={(option) => option.id}
              placeholder={t(`audiences.placeholders.${key}`)}
              emptyLabel={t('common.noMatches')}
              removeLabel={(label) => t('common.remove', { label })}
            />
          </Field>
        );
      })}

      <AudiencePreviewPanel
        value={value}
        onExclude={(exclude) =>
          onChange({ ...value, exclude: exclude.length ? exclude : undefined })
        }
        people={users.data?.items}
      />
    </div>
  );
}

/** Rule D2: who the audience reaches now, each name removable (added to `exclude`). */
function AudiencePreviewPanel({
  value,
  onExclude,
  people,
}: {
  value: AudienceInput;
  onExclude: (exclude: string[]) => void;
  people?: { id: string; name: string }[];
}) {
  const { t } = useTranslation();
  const departmentName = useDepartmentNames();
  const [showAll, setShowAll] = useState(false);
  const titleId = useId();
  const audience = useMemo(() => validAudience(value), [value]);
  const preview = useQuery({
    ...audiencePreviewQuery(audience ?? {}),
    enabled: audience !== null,
  });
  const exclude = value.exclude ?? [];
  const nameOf = new Map(people?.map((person) => [person.id, person.name]));

  if (!audience) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
        {t('audiences.emptyHint')}
      </p>
    );
  }

  const shown = showAll ? preview.data?.users : preview.data?.users.slice(0, NAMES_SHOWN);
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={titleId} className="text-sm font-medium" aria-live="polite">
          {preview.isPending
            ? t('audiences.counting')
            : preview.isError
              ? t('audiences.previewError')
              : t('audiences.count', {
                  count: preview.data.count,
                  n: formatNumber(preview.data.count),
                })}
        </h3>
        {preview.isError && (
          <Button size="sm" variant="outline" onClick={() => preview.refetch()}>
            {t('common.retry')}
          </Button>
        )}
      </div>
      {preview.isPending ? (
        <div className="flex flex-wrap gap-2">
          {['a', 'b', 'c', 'd'].map((key) => (
            <Skeleton key={key} className="h-8 w-28 rounded-full" />
          ))}
        </div>
      ) : (
        preview.data &&
        preview.data.users.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label={t('audiences.names')}>
            {shown?.map((user) => (
              <PersonChip
                key={user.id}
                user={user}
                department={
                  user.department ? departmentName(user.department as DepartmentCode) : ''
                }
                onRemove={() => onExclude([...exclude, user.id].slice(0, AUDIENCE_LIST_MAX))}
              />
            ))}
          </ul>
        )
      )}
      {preview.data && preview.data.users.length > NAMES_SHOWN && (
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          onClick={() => setShowAll((current) => !current)}
        >
          {showAll
            ? t('audiences.showFewer')
            : t('audiences.showAll', { n: formatNumber(preview.data.users.length) })}
        </Button>
      )}
      {preview.data && preview.data.count > preview.data.users.length && (
        <p className="text-sm text-muted-foreground">
          {t('audiences.more', { n: formatNumber(preview.data.count - preview.data.users.length) })}
        </p>
      )}
      {exclude.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <p className="text-sm text-muted-foreground">{t('audiences.excluded')}</p>
          <ul className="flex flex-wrap gap-2">
            {exclude.map((id) => {
              const name = nameOf.get(id) ?? t('audiences.unknown');
              return (
                <li
                  key={id}
                  className="flex items-center gap-1 rounded-full border border-border bg-surface ps-3 pe-1 text-sm text-muted-foreground"
                >
                  <s>{name}</s>
                  <IconButton
                    label={t('audiences.restore', { name })}
                    size="icon-sm"
                    className="size-6"
                    onClick={() => onExclude(exclude.filter((other) => other !== id))}
                  >
                    <UndoIcon />
                  </IconButton>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function PersonChip({
  user,
  department,
  onRemove,
}: {
  user: AudienceMember;
  department: string;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <li className="flex items-center gap-2 rounded-full border border-border bg-surface py-0.5 ps-0.5 pe-1 text-sm">
      <Avatar name={user.name} size="sm" className="size-6" />
      <span className="flex flex-col leading-tight">
        <span>{user.name}</span>
        {department && <span className="text-xs text-muted-foreground">{department}</span>}
      </span>
      <IconButton
        label={t('audiences.exclude', { name: user.name })}
        size="icon-sm"
        className="size-6"
        onClick={onRemove}
      >
        <XIcon />
      </IconButton>
    </li>
  );
}
