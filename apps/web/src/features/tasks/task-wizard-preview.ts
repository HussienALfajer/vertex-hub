import type { SubtaskRunMode } from '@vertex-hub/contracts';
import type { WizardValues } from './task-wizard-draft';

/*
 * F06B rule C1: the live preview draws the flow of the draft. Subtasks become lanes by the run
 * mode: one line for sequential, one lane each side by side for parallel, a column per stage.
 */

export interface PreviewItem {
  /** The subtask's index in the draft. */
  index: number;
  title: string;
}

export interface PreviewLane {
  /** The stage's index in stages mode; null otherwise. */
  stage: number | null;
  name: string | null;
  items: PreviewItem[];
}

export interface PreviewLayout {
  /** Null without subtasks: the preview shows the task alone. */
  mode: SubtaskRunMode | null;
  /** `vertical`: one after another; `horizontal`: lanes side by side. */
  direction: 'vertical' | 'horizontal';
  lanes: PreviewLane[];
}

export function previewLayout(values: WizardValues): PreviewLayout {
  const subtasks = (values.subtasks ?? []).map((subtask, index) => ({
    index,
    title: subtask.title,
    stage: subtask.stageIndex ?? null,
  }));
  if (subtasks.length === 0) return { mode: null, direction: 'vertical', lanes: [] };
  const mode = values.runMode ?? 'sequential';
  const item = ({ index, title }: (typeof subtasks)[number]): PreviewItem => ({ index, title });
  if (mode === 'sequential') {
    return {
      mode,
      direction: 'vertical',
      lanes: [{ stage: null, name: null, items: subtasks.map(item) }],
    };
  }
  if (mode === 'parallel') {
    return {
      mode,
      direction: 'horizontal',
      lanes: subtasks.map((subtask) => ({ stage: null, name: null, items: [item(subtask)] })),
    };
  }
  return {
    mode,
    direction: 'horizontal',
    lanes: (values.stages ?? []).map((stage, index) => ({
      stage: index,
      name: stage.name,
      items: subtasks.filter((subtask) => subtask.stage === index).map(item),
    })),
  };
}
