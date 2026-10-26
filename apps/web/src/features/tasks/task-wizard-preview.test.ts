import { describe, expect, it } from 'vitest';
import type { WizardSubtask, WizardValues } from './task-wizard-draft';
import { previewLayout } from './task-wizard-preview';

const subtask = (title: string, stageIndex: number | null = null): WizardSubtask => ({
  title,
  department: 'design',
  dueDate: '2026-11-10',
  stageIndex,
});

const values = (extra: Partial<WizardValues>): WizardValues => ({
  title: 'Campaign',
  department: 'marketing',
  dueDate: '2026-11-12',
  ...extra,
});

describe('previewLayout', () => {
  it('shows the task alone without subtasks', () => {
    expect(previewLayout(values({}))).toEqual({ mode: null, direction: 'vertical', lanes: [] });
  });

  it('draws one line for sequential subtasks, sequential when no mode is set', () => {
    const layout = previewLayout(values({ subtasks: [subtask('Copy'), subtask('Design')] }));
    expect(layout.mode).toBe('sequential');
    expect(layout.direction).toBe('vertical');
    expect(layout.lanes).toEqual([
      {
        stage: null,
        name: null,
        items: [
          { index: 0, title: 'Copy' },
          { index: 1, title: 'Design' },
        ],
      },
    ]);
  });

  it('draws one lane per subtask side by side when parallel', () => {
    const layout = previewLayout(
      values({ runMode: 'parallel', subtasks: [subtask('Copy'), subtask('Design')] }),
    );
    expect(layout.direction).toBe('horizontal');
    expect(layout.lanes.map((lane) => lane.items.map((item) => item.title))).toEqual([
      ['Copy'],
      ['Design'],
    ]);
  });

  it('draws a column per stage, empty stages included, keeping the draft indexes', () => {
    const layout = previewLayout(
      values({
        runMode: 'stages',
        stages: [{ name: 'Copy' }, { name: 'Design' }, { name: 'Review' }],
        subtasks: [subtask('Post copy', 0), subtask('Reel', 1), subtask('Carousel', 1)],
      }),
    );
    expect(layout.lanes).toEqual([
      { stage: 0, name: 'Copy', items: [{ index: 0, title: 'Post copy' }] },
      {
        stage: 1,
        name: 'Design',
        items: [
          { index: 1, title: 'Reel' },
          { index: 2, title: 'Carousel' },
        ],
      },
      { stage: 2, name: 'Review', items: [] },
    ]);
  });
});
