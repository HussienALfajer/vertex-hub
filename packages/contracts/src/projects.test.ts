import { describe, expect, it } from 'vitest';
import { businessDate } from './dates.js';
import {
  canChangeProjectStatus,
  completeMilestoneSchema,
  createMilestoneSchema,
  createProjectSchema,
  isProjectClosed,
  milestoneOrderSchema,
  PROJECT_STATUSES,
  projectListQuerySchema,
  projectStatusChangeSchema,
  updateMilestoneSchema,
  updateProjectSchema,
} from './projects.js';

const client = '01a0e97d-0028-7d46-8479-9fa1ea9ffcd7';
const manager = '01a0e97d-0028-7d46-8479-9fa1ea9ffcd8';

const project = {
  clientId: client,
  name: ' Brand identity ',
  projectManagerId: manager,
  departments: ['design', 'development'],
  startDate: '2026-10-01',
  dueDate: '2026-11-30',
};

describe('createProjectSchema', () => {
  it('fills the defaults and leaves money out unless sent', () => {
    expect(createProjectSchema.parse(project)).toEqual({
      ...project,
      name: 'Brand identity',
      status: 'planned',
      milestones: [],
    });
  });

  it('keeps each department once and requires one to ten', () => {
    const parsed = createProjectSchema.parse({ ...project, departments: ['design', 'design'] });
    expect(parsed.departments).toEqual(['design']);
    expect(createProjectSchema.safeParse({ ...project, departments: [] }).success).toBe(false);
    expect(createProjectSchema.safeParse({ ...project, departments: ['nope'] }).success).toBe(
      false,
    );
  });

  it('accepts only planned or active as the first status', () => {
    expect(createProjectSchema.parse({ ...project, status: 'active' }).status).toBe('active');
    for (const status of ['on_hold', 'completed', 'cancelled']) {
      expect(createProjectSchema.safeParse({ ...project, status }).success, status).toBe(false);
    }
  });

  it('refuses malformed dates and names', () => {
    expect(createProjectSchema.safeParse({ ...project, startDate: '2026-13-01' }).success).toBe(
      false,
    );
    expect(createProjectSchema.safeParse({ ...project, dueDate: '30/11/2026' }).success).toBe(
      false,
    );
    expect(createProjectSchema.safeParse({ ...project, name: '  ' }).success).toBe(false);
    expect(createProjectSchema.safeParse({ ...project, name: 'x'.repeat(121) }).success).toBe(
      false,
    );
  });

  it('accepts known currencies only', () => {
    expect(createProjectSchema.parse({ ...project, currency: 'SYP' }).currency).toBe('SYP');
    expect(createProjectSchema.safeParse({ ...project, currency: 'EUR' }).success).toBe(false);
  });

  it('stores a blank description as null', () => {
    expect(createProjectSchema.parse({ ...project, description: '  ' }).description).toBeNull();
  });
});

describe('updateProjectSchema', () => {
  it('accepts any subset of the fields', () => {
    expect(updateProjectSchema.parse({})).toEqual({});
    expect(updateProjectSchema.parse({ dueDate: '2026-12-01' })).toEqual({ dueDate: '2026-12-01' });
  });
});

describe('milestone schemas', () => {
  it('takes installments as non-negative integers in minor units', () => {
    expect(createMilestoneSchema.parse({ name: 'Design', installmentMinor: 150000 })).toEqual({
      name: 'Design',
      installmentMinor: 150000,
    });
    for (const installmentMinor of [-1, 10.5, '100']) {
      expect(
        createMilestoneSchema.safeParse({ name: 'Design', installmentMinor }).success,
        String(installmentMinor),
      ).toBe(false);
    }
  });

  it('leaves the installment out when it is not sent (edge case 11)', () => {
    expect(updateMilestoneSchema.parse({ name: 'Build' })).toEqual({ name: 'Build' });
    expect(updateMilestoneSchema.parse({ installmentMinor: null })).toEqual({
      installmentMinor: null,
    });
  });

  it('limits names to eighty characters', () => {
    expect(createMilestoneSchema.safeParse({ name: 'x'.repeat(81) }).success).toBe(false);
  });

  it('lets the complete body be left out', () => {
    expect(completeMilestoneSchema.parse(undefined)).toEqual({ confirmOpenTasks: false });
  });

  it('orders one to thirty milestones', () => {
    expect(milestoneOrderSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(milestoneOrderSchema.safeParse({ ids: [client, manager] }).success).toBe(true);
  });
});

describe('project status', () => {
  it('allows only the transitions of the diagram', () => {
    const allowed = PROJECT_STATUSES.flatMap((from) =>
      PROJECT_STATUSES.filter((to) => canChangeProjectStatus(from, to)).map(
        (to) => `${from}>${to}`,
      ),
    );
    expect(allowed.sort()).toEqual(
      [
        'planned>active',
        'planned>cancelled',
        'active>on_hold',
        'active>completed',
        'active>cancelled',
        'on_hold>active',
        'on_hold>cancelled',
        'completed>active',
        'cancelled>active',
      ].sort(),
    );
  });

  it('treats completed and cancelled projects as closed', () => {
    expect(PROJECT_STATUSES.filter(isProjectClosed)).toEqual(['completed', 'cancelled']);
  });

  it('needs a reason to cancel', () => {
    expect(projectStatusChangeSchema.safeParse({ status: 'cancelled' }).success).toBe(false);
    expect(projectStatusChangeSchema.safeParse({ status: 'cancelled', reason: ' ' }).success).toBe(
      false,
    );
    expect(
      projectStatusChangeSchema.parse({ status: 'cancelled', reason: 'Client withdrew' }),
    ).toEqual({ status: 'cancelled', reason: 'Client withdrew' });
    expect(projectStatusChangeSchema.parse({ status: 'on_hold' })).toEqual({ status: 'on_hold' });
    expect(projectStatusChangeSchema.safeParse({ status: 'planned' }).success).toBe(false);
  });

  it('takes a new project manager only when reopening', () => {
    const projectManagerId = '01a0e97d-0028-7d46-8479-9fa1ea9ffcd8';
    expect(
      projectStatusChangeSchema.safeParse({ status: 'active', projectManagerId }).success,
    ).toBe(true);
    expect(
      projectStatusChangeSchema.safeParse({ status: 'on_hold', projectManagerId }).success,
    ).toBe(false);
  });
});

describe('projectListQuerySchema', () => {
  it('lists open projects by due date by default', () => {
    expect(projectListQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 50,
      status: ['planned', 'active', 'on_hold'],
      archived: false,
      sort: 'dueDate',
      order: 'asc',
    });
  });

  it('reads repeated statuses and boolean filters', () => {
    const query = projectListQuerySchema.parse({ status: 'completed', overdue: 'true' });
    expect(query.status).toEqual(['completed']);
    expect(query.overdue).toBe(true);
  });
});

describe('businessDate', () => {
  it('returns the calendar day in Damascus (edge case 16)', () => {
    // 21:30 UTC on the last day of September is 00:30 on 1 October in Damascus (UTC+3).
    expect(businessDate(new Date('2026-09-30T21:30:00Z'))).toBe('2026-10-01');
    expect(businessDate(new Date('2026-09-30T20:59:59Z'))).toBe('2026-09-30');
  });
});
