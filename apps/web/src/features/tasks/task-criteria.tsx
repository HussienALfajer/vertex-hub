import {
  createTaskChecklistItemSchema,
  TASK_LIMITS,
  type TaskChecklistItem,
  type TaskDetail,
} from '@vertex-hub/contracts';
import {
  Button,
  Checkbox,
  cn,
  Field,
  FieldError,
  FieldLabel,
  IconButton,
  Input,
  toast,
} from '@vertex-hub/ui';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormAlert } from '../../components/form-alert';
import { errorMessage } from '../../lib/errors';
import { formatNumber } from '../../lib/format';
import { useShownWhileClosing } from '../../lib/use-shown-while-closing';
import { TaskSection } from './task-parts';
import {
  useAddCriterion,
  useArchiveCriterion,
  useReorderCriteria,
  useUpdateCriterion,
} from './tasks.queries';

/**
 * F06B rule C6: the definition of done. Manage scope writes the criteria; the assignee or a
 * reviewer ticks them, and while one is unticked the task cannot go to internal review.
 */
export function CriteriaSection({ task }: { task: TaskDetail }) {
  const { t } = useTranslation();
  const items = task.criteria;
  const edit = task.permissions.canEditCriteria && !task.readOnly;
  const tick = task.permissions.canTickCriteria && !task.readOnly;
  const update = useUpdateCriterion(task.id);
  const reorder = useReorderCriteria(task.id);
  const remove = useArchiveCriterion(task.id);
  const [removing, setRemoving] = useState<TaskChecklistItem | null>(null);
  const shownRemoving = useShownWhileClosing(removing);
  if (items.length === 0 && !edit) return null;
  const done = items.filter((item) => item.done).length;

  async function attempt(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (error) {
      toast.add({ title: errorMessage(t, error), type: 'error' });
    }
  }

  function move(index: number, by: -1 | 1) {
    if (reorder.isPending) return;
    const ids = items.map((item) => item.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + by, 0, moved as string);
    void attempt(() => reorder.mutateAsync(ids));
  }

  return (
    <TaskSection
      title={t('tasks.criteria.title')}
      count={
        items.length > 0
          ? t('tasks.checklistCount', {
              done: formatNumber(done),
              total: formatNumber(items.length),
            })
          : undefined
      }
    >
      <p className="text-sm text-muted-foreground">{t('tasks.criteria.hint')}</p>
      {items.length > 0 && (
        <ul className="flex flex-col gap-1">
          {items.map((item, index) => (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50"
            >
              <label
                htmlFor={`criterion-${item.id}`}
                className="flex min-w-0 flex-1 items-center gap-3 text-sm"
              >
                <Checkbox
                  id={`criterion-${item.id}`}
                  checked={item.done}
                  disabled={!tick}
                  onCheckedChange={(checked) => {
                    if (update.isPending) return;
                    void attempt(() => update.mutateAsync({ itemId: item.id, done: checked }));
                  }}
                />
                <span className={cn('min-w-0', item.done && 'text-muted-foreground line-through')}>
                  {item.text}
                </span>
              </label>
              {edit && (
                <span className="flex shrink-0 items-center">
                  <IconButton
                    label={t('tasks.checklist.moveUp', { text: item.text })}
                    disabled={index === 0}
                    focusableWhenDisabled
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUpIcon />
                  </IconButton>
                  <IconButton
                    label={t('tasks.checklist.moveDown', { text: item.text })}
                    disabled={index === items.length - 1}
                    focusableWhenDisabled
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDownIcon />
                  </IconButton>
                  <IconButton
                    label={t('common.remove', { label: item.text })}
                    onClick={() => setRemoving(item)}
                  >
                    <XIcon />
                  </IconButton>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {edit && items.length < TASK_LIMITS.criteria && <AddCriterion task={task} />}
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t('tasks.criteria.removeTitle')}
        body={t('tasks.checklist.removeBody', { text: shownRemoving?.text ?? '' })}
        action={t('tasks.checklist.removeAction')}
        destructive
        pending={remove.isPending}
        onConfirm={async () => {
          if (removing) await remove.mutateAsync(removing.id);
        }}
      />
    </TaskSection>
  );
}

function AddCriterion({ task }: { task: TaskDetail }) {
  const { t } = useTranslation();
  const id = useId();
  const add = useAddCriterion(task.id);
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-2"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        const parsed = createTaskChecklistItemSchema.safeParse({ text });
        if (!parsed.success) {
          setInvalid(true);
          return;
        }
        setFailure(null);
        try {
          await add.mutateAsync(parsed.data);
          setText('');
        } catch (error) {
          setFailure(errorMessage(t, error));
        }
      }}
    >
      <Field invalid={invalid}>
        <FieldLabel htmlFor={id} className="sr-only">
          {t('tasks.criteria.add')}
        </FieldLabel>
        <div className="flex items-center gap-2">
          <Input
            id={id}
            maxLength={200}
            placeholder={t('tasks.criteria.placeholder')}
            value={text}
            onChange={(event) => {
              setInvalid(false);
              setText(event.target.value);
            }}
          />
          <Button type="submit" variant="outline" disabled={add.isPending}>
            <PlusIcon />
            {t('tasks.criteria.add')}
          </Button>
        </div>
        <FieldError match={invalid}>{t('tasks.checklist.invalid')}</FieldError>
      </Field>
      {failure && <FormAlert>{failure}</FormAlert>}
    </form>
  );
}
