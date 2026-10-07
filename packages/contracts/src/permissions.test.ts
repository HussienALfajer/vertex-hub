import { describe, expect, it } from 'vitest';
import {
  DEPARTMENT_CAPABILITIES,
  effectiveRoles,
  grantedPermissions,
  hasPermission,
  PERMISSION_MAP,
  PERMISSIONS,
  permissionScopes,
  twoFactorRequired,
  type UserAccess,
} from './permissions.js';
import { ROLES } from './roles.js';

const design = { code: 'design', isManager: false } as const;

function access(
  roles: UserAccess['roles'],
  departments: UserAccess['departments'] = [design],
): UserAccess {
  return { roles, departments };
}

describe('permission map', () => {
  it('defines grants for every role', () => {
    expect(Object.keys(PERMISSION_MAP).sort()).toEqual([...ROLES].sort());
  });

  it('gives the General Manager every permission over all records', () => {
    for (const permission of PERMISSIONS) {
      expect(permissionScopes(access(['general_manager']), permission)).toEqual(['all']);
    }
  });

  it('keeps invoices away from employees and lets finance manage them', () => {
    expect(hasPermission(access(['employee']), 'invoices.read')).toBe(false);
    expect(hasPermission(access(['finance']), 'invoices.manage')).toBe(true);
    expect(hasPermission(access(['finance']), 'payments.manage')).toBe(true);
  });

  it('gives financial reports to finance but not operational reports', () => {
    expect(permissionScopes(access(['finance']), 'reports.finance')).toEqual(['all']);
    expect(hasPermission(access(['finance']), 'reports.read')).toBe(false);
    expect(hasPermission(access(['department_manager']), 'reports.finance')).toBe(false);
  });

  it('reserves discount approval for the General Manager (ADR 0007)', () => {
    const others = ROLES.filter((role) => role !== 'general_manager');
    expect(hasPermission(access(others), 'quotes.approve_discount')).toBe(false);
  });

  it('reserves approving retainer reductions for the General Manager (F05B A4)', () => {
    const others = ROLES.filter((role) => role !== 'general_manager');
    expect(hasPermission(access(others), 'retainers.approve_reduction')).toBe(false);
    expect(permissionScopes(access(['general_manager']), 'retainers.approve_reduction')).toEqual([
      'all',
    ]);
  });

  it('lets every employee read the team directory', () => {
    expect(permissionScopes(access(['employee']), 'users.read')).toEqual(['all']);
    expect(PERMISSION_MAP.department_manager['users.read']).toBeUndefined();
  });

  it('keeps user management, the audit log and template management off every role but GM', () => {
    const others = ROLES.filter((role) => role !== 'general_manager');
    for (const permission of ['users.manage', 'audit.read', 'templates.manage'] as const) {
      expect(hasPermission(access(others), permission)).toBe(false);
    }
    expect(hasPermission(access(['employee']), 'templates.read')).toBe(true);
  });

  it('lets account managers work the leads they own', () => {
    expect(permissionScopes(access(['account_manager']), 'leads.manage')).toEqual(['assigned']);
  });

  it('combines the scopes of several roles', () => {
    // A designer who is also an account manager (ADR 0007).
    expect(permissionScopes(access(['employee', 'account_manager']), 'tasks.manage')).toEqual([
      'own_clients',
      'assigned',
    ]);
    expect(permissionScopes(access(['employee']), 'clients.manage')).toEqual([]);
  });

  it('lists granted permissions once, in catalog order, with their scopes', () => {
    const granted = grantedPermissions(access(['employee', 'department_manager']));
    const names = granted.map((g) => g.permission);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(PERMISSIONS.filter((p) => names.includes(p)));
    expect(granted).toContainEqual({
      permission: 'tasks.work',
      scopes: ['department', 'assigned'],
    });
    expect(grantedPermissions(access([], []))).toEqual([]);
  });
});

describe('clients (F02)', () => {
  it('lets every user read every client and write in the communication log', () => {
    expect(permissionScopes(access(['employee']), 'clients.read')).toEqual(['all']);
    expect(permissionScopes(access(['employee']), 'clients.log')).toEqual(['all']);
    for (const role of ['department_manager', 'account_manager', 'finance'] as const) {
      expect(PERMISSION_MAP[role]['clients.read'], role).toBeUndefined();
    }
  });

  it('lets account managers manage their own clients only', () => {
    expect(permissionScopes(access(['employee', 'account_manager']), 'clients.manage')).toEqual([
      'own_clients',
    ]);
  });

  it('lets the Operations manager manage every client', () => {
    const manager = access(
      ['employee', 'department_manager'],
      [{ code: 'internal_operations', isManager: true }],
    );
    expect(permissionScopes(manager, 'clients.manage')).toEqual(['all']);
    const member = access(['employee'], [{ code: 'internal_operations', isManager: false }]);
    expect(hasPermission(member, 'clients.manage')).toBe(false);
  });
});

describe('projects and retainers (F05)', () => {
  const operationsManager = access(
    ['employee', 'department_manager'],
    [{ code: 'internal_operations', isManager: true }],
  );

  it('lets every user read every project and retainer', () => {
    expect(permissionScopes(access(['employee']), 'projects.read')).toEqual(['all']);
    for (const role of ['department_manager', 'account_manager', 'finance'] as const) {
      expect(PERMISSION_MAP[role]['projects.read'], role).toBeUndefined();
    }
  });

  it('lets an employee manage only the projects they are project manager of', () => {
    expect(permissionScopes(access(['employee']), 'projects.manage')).toEqual(['assigned']);
  });

  it('lets account managers manage the work of their own clients', () => {
    expect(permissionScopes(access(['employee', 'account_manager']), 'projects.manage')).toEqual([
      'own_clients',
      'assigned',
    ]);
  });

  it('leaves department managers read-only', () => {
    expect(PERMISSION_MAP.department_manager['projects.manage']).toBeUndefined();
    const designManager = access(
      ['employee', 'department_manager'],
      [{ code: 'design', isManager: true }],
    );
    expect(permissionScopes(designManager, 'projects.manage')).toEqual(['assigned']);
  });

  it('lets the Operations manager manage all work and read invoices', () => {
    expect(permissionScopes(operationsManager, 'projects.manage')).toEqual(['all', 'assigned']);
    expect(permissionScopes(operationsManager, 'invoices.read')).toEqual(['all']);
    const member = access(['employee'], [{ code: 'internal_operations', isManager: false }]);
    expect(hasPermission(member, 'invoices.read')).toBe(false);
  });
});

describe('invoices (F13)', () => {
  const operationsManager = access(
    ['employee', 'department_manager'],
    [{ code: 'internal_operations', isManager: true }],
  );

  it('lets the Operations manager issue invoices and record payments', () => {
    expect(permissionScopes(operationsManager, 'invoices.manage')).toEqual(['all']);
    expect(permissionScopes(operationsManager, 'payments.manage')).toEqual(['all']);
    const member = access(['employee'], [{ code: 'internal_operations', isManager: false }]);
    expect(hasPermission(member, 'invoices.manage')).toBe(false);
    expect(hasPermission(member, 'payments.manage')).toBe(false);
  });

  it('gives expenses to the invoice managers and to account managers for their clients', () => {
    expect(permissionScopes(access(['general_manager']), 'expenses.manage')).toEqual(['all']);
    expect(permissionScopes(access(['finance']), 'expenses.manage')).toEqual(['all']);
    expect(permissionScopes(operationsManager, 'expenses.manage')).toEqual(['all']);
    expect(permissionScopes(access(['account_manager']), 'expenses.manage')).toEqual([
      'own_clients',
    ]);
    expect(hasPermission(access(['employee', 'department_manager']), 'expenses.manage')).toBe(
      false,
    );
  });

  it('keeps invoice management off account managers', () => {
    expect(hasPermission(access(['account_manager']), 'invoices.manage')).toBe(false);
    expect(hasPermission(access(['account_manager']), 'payments.manage')).toBe(false);
  });

  it('lets the invoice managers email invoices, and account managers for their clients (F14)', () => {
    expect(permissionScopes(access(['general_manager']), 'invoices.send')).toEqual(['all']);
    expect(permissionScopes(access(['finance']), 'invoices.send')).toEqual(['all']);
    expect(permissionScopes(operationsManager, 'invoices.send')).toEqual(['all']);
    expect(permissionScopes(access(['account_manager']), 'invoices.send')).toEqual(['own_clients']);
    expect(hasPermission(access(['employee']), 'invoices.send')).toBe(false);
  });
});

describe('leads (F03)', () => {
  const operationsManager = access(
    ['employee', 'department_manager'],
    [{ code: 'internal_operations', isManager: true }],
  );

  it('lets General Communication and Marketing members work every lead', () => {
    for (const code of ['general_communication', 'marketing'] as const) {
      const member = access(['employee'], [{ code, isManager: false }]);
      expect(permissionScopes(member, 'leads.read')).toEqual(['all']);
      expect(permissionScopes(member, 'leads.manage')).toEqual(['all']);
    }
  });

  it('lets the Operations manager read every lead without managing them', () => {
    expect(permissionScopes(operationsManager, 'leads.read')).toEqual(['all']);
    expect(hasPermission(operationsManager, 'leads.manage')).toBe(false);
  });

  it('shows leads to nobody else', () => {
    const operationsMember = access(
      ['employee'],
      [{ code: 'internal_operations', isManager: false }],
    );
    for (const other of [access(['employee']), access(['finance']), operationsMember]) {
      expect(hasPermission(other, 'leads.read')).toBe(false);
    }
  });
});

describe('ad campaigns (F12)', () => {
  const operationsManager = access(
    ['employee', 'department_manager'],
    [{ code: 'internal_operations', isManager: true }],
  );
  const marketer = access(['employee'], [{ code: 'marketing', isManager: false }]);
  const marketingManager = access(
    ['employee', 'department_manager'],
    [{ code: 'marketing', isManager: true }],
  );

  it('lets Marketing members and the Operations manager read and manage every campaign', () => {
    for (const holder of [marketer, marketingManager, operationsManager]) {
      expect(permissionScopes(holder, 'campaigns.read')).toEqual(['all']);
      expect(permissionScopes(holder, 'campaigns.manage')).toEqual(['all']);
    }
  });

  it('keeps account managers on their own clients', () => {
    expect(permissionScopes(access(['account_manager']), 'campaigns.read')).toEqual([
      'own_clients',
    ]);
    expect(permissionScopes(access(['account_manager']), 'campaigns.manage')).toEqual([
      'own_clients',
    ]);
  });

  it('lets Finance read campaigns but not manage them', () => {
    expect(permissionScopes(access(['finance']), 'campaigns.read')).toEqual(['all']);
    expect(hasPermission(access(['finance']), 'campaigns.manage')).toBe(false);
  });

  it('gives funding to the General Manager, Finance and the Operations manager only', () => {
    expect(permissionScopes(access(['general_manager']), 'campaigns.fund')).toEqual(['all']);
    expect(permissionScopes(access(['finance']), 'campaigns.fund')).toEqual(['all']);
    expect(permissionScopes(operationsManager, 'campaigns.fund')).toEqual(['all']);
    for (const other of [marketer, marketingManager, access(['account_manager'])]) {
      expect(hasPermission(other, 'campaigns.fund')).toBe(false);
    }
  });

  it('shows campaigns to nobody else', () => {
    const designManager = access(
      ['employee', 'department_manager'],
      [{ code: 'design', isManager: true }],
    );
    const operationsMember = access(
      ['employee'],
      [{ code: 'internal_operations', isManager: false }],
    );
    for (const other of [access(['employee']), designManager, operationsMember]) {
      expect(hasPermission(other, 'campaigns.read')).toBe(false);
      expect(hasPermission(other, 'campaigns.manage')).toBe(false);
      expect(hasPermission(other, 'campaigns.fund')).toBe(false);
    }
  });
});

describe('tasks (F06)', () => {
  const operationsManager = access(
    ['employee', 'department_manager'],
    [{ code: 'internal_operations', isManager: true }],
  );
  const designManager = access(
    ['employee', 'department_manager'],
    [{ code: 'design', isManager: true }],
  );

  it('lets every user read every task and request work from any department', () => {
    expect(permissionScopes(access(['employee']), 'tasks.read')).toEqual(['all']);
    expect(permissionScopes(access(['employee']), 'tasks.request')).toEqual(['all']);
    for (const role of ['department_manager', 'account_manager', 'finance'] as const) {
      expect(PERMISSION_MAP[role]['tasks.read'], role).toBeUndefined();
    }
  });

  it('lets an employee work their tasks and manage the tasks of their projects', () => {
    expect(permissionScopes(access(['employee']), 'tasks.work')).toEqual(['assigned']);
    expect(permissionScopes(access(['employee']), 'tasks.manage')).toEqual(['assigned']);
  });

  it('lets department managers work and manage the tasks of their departments', () => {
    expect(permissionScopes(designManager, 'tasks.work')).toEqual(['department', 'assigned']);
    expect(permissionScopes(designManager, 'tasks.manage')).toEqual(['department', 'assigned']);
  });

  it('lets the Operations manager manage every task and read operational and financial reports', () => {
    expect(permissionScopes(operationsManager, 'tasks.manage')).toEqual([
      'all',
      'department',
      'assigned',
    ]);
    expect(permissionScopes(operationsManager, 'reports.read')).toEqual(['all', 'department']);
    expect(permissionScopes(operationsManager, 'reports.finance')).toEqual(['all']);
    const member = access(['employee'], [{ code: 'internal_operations', isManager: false }]);
    expect(permissionScopes(member, 'tasks.manage')).toEqual(['assigned']);
    expect(hasPermission(member, 'reports.read')).toBe(false);
    expect(hasPermission(member, 'reports.finance')).toBe(false);
  });
});

describe('templates (F07)', () => {
  it('lets every user read templates and keeps managing them to GM and Operations', () => {
    expect(permissionScopes(access(['employee']), 'templates.read')).toEqual(['all']);
    for (const role of ['department_manager', 'account_manager', 'finance'] as const) {
      expect(PERMISSION_MAP[role]['templates.read'], role).toBeUndefined();
      expect(PERMISSION_MAP[role]['templates.manage'], role).toBeUndefined();
    }
    expect(hasPermission(access(['employee', 'account_manager']), 'templates.manage')).toBe(false);
  });
});

describe('content (F08)', () => {
  const writer = access(['employee'], [{ code: 'content_management', isManager: false }]);
  const contentManager = access(
    ['employee', 'department_manager'],
    [{ code: 'content_management', isManager: true }],
  );
  const operationsManager = access(
    ['employee', 'department_manager'],
    [{ code: 'internal_operations', isManager: true }],
  );
  const designManager = access(
    ['employee', 'department_manager'],
    [{ code: 'design', isManager: true }],
  );

  it('lets every user read every calendar and post', () => {
    expect(permissionScopes(access(['employee']), 'content.read')).toEqual(['all']);
    for (const role of ['department_manager', 'account_manager', 'finance'] as const) {
      expect(PERMISSION_MAP[role]['content.read'], role).toBeUndefined();
    }
  });

  it('lets Content Management members edit every post, and only their manager review', () => {
    expect(permissionScopes(writer, 'content.manage')).toEqual(['all']);
    expect(hasPermission(writer, 'content.review')).toBe(false);
    expect(permissionScopes(contentManager, 'content.manage')).toEqual(['all']);
    expect(permissionScopes(contentManager, 'content.review')).toEqual(['all']);
  });

  it('lets account managers edit and review the posts of their own clients', () => {
    const accountManager = access(['employee', 'account_manager']);
    expect(permissionScopes(accountManager, 'content.manage')).toEqual(['own_clients']);
    expect(permissionScopes(accountManager, 'content.review')).toEqual(['own_clients']);
  });

  it('gives the Operations manager both over all posts', () => {
    expect(permissionScopes(operationsManager, 'content.manage')).toEqual(['all']);
    expect(permissionScopes(operationsManager, 'content.review')).toEqual(['all']);
  });

  it('gives other departments and their managers nothing but reading', () => {
    expect(PERMISSION_MAP.department_manager['content.manage']).toBeUndefined();
    for (const user of [access(['employee']), designManager]) {
      expect(hasPermission(user, 'content.manage')).toBe(false);
      expect(hasPermission(user, 'content.review')).toBe(false);
    }
  });
});

describe('calendar, shoots and meetings (F11)', () => {
  const photographer = access(['employee'], [{ code: 'photography', isManager: false }]);
  const photographyManager = access(
    ['employee', 'department_manager'],
    [{ code: 'photography', isManager: true }],
  );
  const operationsManager = access(
    ['employee', 'department_manager'],
    [{ code: 'internal_operations', isManager: true }],
  );
  const designManager = access(
    ['employee', 'department_manager'],
    [{ code: 'design', isManager: true }],
  );
  const accountManager = access(['employee', 'account_manager']);

  it('lets every user read the whole calendar', () => {
    expect(permissionScopes(access(['employee']), 'calendar.read')).toEqual(['all']);
    for (const role of ['department_manager', 'account_manager', 'finance'] as const) {
      expect(PERMISSION_MAP[role]['calendar.read'], role).toBeUndefined();
    }
  });

  it('lets Photography members, their manager and the Operations manager manage every shoot', () => {
    for (const user of [photographer, photographyManager, operationsManager]) {
      expect(permissionScopes(user, 'shoots.manage')).toEqual(['all']);
    }
  });

  it('lets account managers manage the shoots and meetings of their own clients', () => {
    expect(permissionScopes(accountManager, 'shoots.manage')).toEqual(['own_clients']);
    expect(permissionScopes(accountManager, 'meetings.manage')).toEqual([
      'own_clients',
      'assigned',
    ]);
  });

  it('gives other departments and their managers no shoot management', () => {
    expect(PERMISSION_MAP.department_manager['shoots.manage']).toBeUndefined();
    for (const user of [access(['employee']), designManager]) {
      expect(hasPermission(user, 'shoots.manage')).toBe(false);
    }
  });

  it('lets every user manage the meetings they organize, and the Operations manager all', () => {
    expect(permissionScopes(access(['employee']), 'meetings.manage')).toEqual(['assigned']);
    expect(permissionScopes(photographyManager, 'meetings.manage')).toEqual(['assigned']);
    expect(permissionScopes(operationsManager, 'meetings.manage')).toEqual(['all', 'assigned']);
  });
});

describe('department capabilities', () => {
  it('only names known departments', () => {
    expect(Object.keys(DEPARTMENT_CAPABILITIES).sort()).toEqual([
      'content_management',
      'general_communication',
      'internal_operations',
      'marketing',
      'medical_consultation',
      'photography',
    ]);
  });

  it('gives the Operations manager user management, the audit log and templates', () => {
    const manager = access(
      ['employee', 'department_manager'],
      [{ code: 'internal_operations', isManager: true }],
    );
    for (const permission of [
      'users.manage',
      'audit.read',
      'templates.read',
      'templates.manage',
    ] as const) {
      expect(permissionScopes(manager, permission)).toEqual(['all']);
    }
  });

  it('gives nothing extra to a plain member of Internal Operations', () => {
    const member = access(['employee'], [{ code: 'internal_operations', isManager: false }]);
    expect(hasPermission(member, 'users.manage')).toBe(false);
    expect(hasPermission(member, 'audit.read')).toBe(false);
  });

  it('grants member capabilities through a secondary membership too', () => {
    const member = access(
      ['employee'],
      [design, { code: 'medical_consultation', isManager: false }],
    );
    expect(permissionScopes(member, 'approvals.review_medical')).toEqual(['all']);
  });

  it('keeps medical review to Medical Consultation and the General Manager (F09)', () => {
    const primary = access(['employee'], [{ code: 'medical_consultation', isManager: false }]);
    expect(permissionScopes(primary, 'approvals.review_medical')).toEqual(['all']);
    expect(permissionScopes(access(['general_manager']), 'approvals.review_medical')).toEqual([
      'all',
    ]);
    expect(hasPermission(access(['employee', 'account_manager']), 'approvals.review_medical')).toBe(
      false,
    );
    expect(
      hasPermission(
        access(['employee', 'department_manager'], [design]),
        'approvals.review_medical',
      ),
    ).toBe(false);
    // Internal review is `tasks.manage`: the old `approvals.review` is gone.
    expect(PERMISSIONS).not.toContain('approvals.review');
  });

  it('unions department and role scopes for the same permission', () => {
    const marketer = access(
      ['employee', 'account_manager'],
      [{ code: 'marketing', isManager: false }],
    );
    expect(permissionScopes(marketer, 'leads.read')).toEqual(['all', 'assigned']);
  });
});

describe('effective roles', () => {
  it('adds employee to every user and keeps catalog order', () => {
    expect(effectiveRoles(['finance', 'general_manager'], [design])).toEqual([
      'general_manager',
      'employee',
      'finance',
    ]);
  });

  it('adds department manager while the user manages a department', () => {
    expect(effectiveRoles([], [{ code: 'design', isManager: true }])).toEqual([
      'department_manager',
      'employee',
    ]);
    expect(effectiveRoles([], [])).toEqual(['employee']);
  });
});

describe('two-factor requirement', () => {
  it('requires 2FA for General Managers, Finance and the Operations manager', () => {
    expect(twoFactorRequired(access(['general_manager', 'employee']))).toBe(true);
    expect(twoFactorRequired(access(['employee', 'finance']))).toBe(true);
    expect(
      twoFactorRequired(access(['employee'], [{ code: 'internal_operations', isManager: true }])),
    ).toBe(true);
  });

  it('leaves it optional for everyone else', () => {
    expect(twoFactorRequired(access(['employee', 'account_manager']))).toBe(false);
    expect(
      twoFactorRequired(access(['employee'], [{ code: 'internal_operations', isManager: false }])),
    ).toBe(false);
    expect(
      twoFactorRequired(access(['department_manager'], [{ code: 'design', isManager: true }])),
    ).toBe(false);
  });
});

describe('catalog and quotes (F04)', () => {
  const operationsManager = access(
    ['employee', 'department_manager'],
    [{ code: 'internal_operations', isManager: true }],
  );
  const operationsMember = access(
    ['employee'],
    [{ code: 'internal_operations', isManager: false }],
  );

  it('lets the Operations manager manage the catalog and every quote', () => {
    for (const permission of [
      'catalog.read',
      'catalog.manage',
      'quotes.read',
      'quotes.manage',
    ] as const) {
      expect(permissionScopes(operationsManager, permission), permission).toEqual(['all']);
      expect(hasPermission(operationsMember, permission), permission).toBe(false);
    }
    expect(hasPermission(operationsManager, 'quotes.approve_discount')).toBe(false);
  });

  it('keeps account managers on their own clients and Finance read-only', () => {
    const accountManager = access(['employee', 'account_manager']);
    expect(permissionScopes(accountManager, 'quotes.manage')).toEqual(['own_clients']);
    expect(hasPermission(accountManager, 'catalog.manage')).toBe(false);
    const finance = access(['employee', 'finance']);
    expect(permissionScopes(finance, 'quotes.read')).toEqual(['all']);
    expect(hasPermission(finance, 'quotes.manage')).toBe(false);
    expect(hasPermission(access(['employee']), 'quotes.read')).toBe(false);
    expect(hasPermission(access(['employee']), 'catalog.read')).toBe(false);
  });

  it('gives every quote reader invoices.read with the same or a wider scope', () => {
    const users = [
      access(['general_manager', 'employee']),
      access(['employee', 'account_manager']),
      access(['employee', 'finance']),
      operationsManager,
    ];
    for (const user of users) {
      const invoiceScopes = permissionScopes(user, 'invoices.read');
      for (const scope of permissionScopes(user, 'quotes.read')) {
        expect(invoiceScopes.includes(scope) || invoiceScopes.includes('all')).toBe(true);
      }
    }
  });
});
