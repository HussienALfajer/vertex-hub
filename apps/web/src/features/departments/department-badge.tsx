import { useQuery } from '@tanstack/react-query';
import type { DepartmentCode, DepartmentResponse } from '@vertex-hub/contracts';
import { Badge, cn, DepartmentMark } from '@vertex-hub/ui';
import { useTranslation } from 'react-i18next';
import { departmentListQuery } from './departments.queries';
import { departmentLabel } from './pickable-departments';

/** The department of a code, from the departments list (names and identity are editable, F23). */
export function useDepartmentByCode(): (code: DepartmentCode) => DepartmentResponse | undefined {
  const departments = useQuery(departmentListQuery);
  const byCode = new Map(
    departments.data?.items.map((department) => [department.code, department]),
  );
  return (code) => byCode.get(code);
}

type Identity = Pick<DepartmentResponse, 'name' | 'color' | 'icon' | 'archivedAt'>;

/**
 * A department's icon on its color beside its name, muted with the archived mark once it is
 * archived (F23 "Department identity across the app"). `plain` drops the chip's frame, for rows
 * of text.
 */
export function DepartmentBadge({
  department,
  plain = false,
  className,
}: {
  department: Identity;
  plain?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const archived = !!department.archivedAt;
  const content = (
    <>
      <DepartmentMark
        color={department.color}
        icon={department.icon}
        size="sm"
        muted={archived}
        className={plain ? 'size-4 [&_svg]:size-2.5' : undefined}
      />
      <span className="truncate">{departmentLabel(t, department)}</span>
    </>
  );
  return plain ? (
    <span
      className={cn(
        'inline-flex min-w-0 items-center gap-1.5',
        archived && 'text-muted-foreground',
        className,
      )}
    >
      {content}
    </span>
  ) : (
    <Badge
      tone="outline"
      className={cn('max-w-full ps-1', archived && 'text-muted-foreground', className)}
    >
      {content}
    </Badge>
  );
}

/** `DepartmentBadge` by code; nothing until the departments load. */
export function DepartmentCodeBadge({
  code,
  plain,
  className,
}: {
  code: DepartmentCode;
  plain?: boolean;
  className?: string;
}) {
  const department = useDepartmentByCode()(code);
  return department ? (
    <DepartmentBadge department={department} plain={plain} className={className} />
  ) : null;
}

/** A department's color as a dot, for options in pickers and filters. */
export function DepartmentDot({ department }: { department: Identity }) {
  return (
    <DepartmentMark
      color={department.color}
      icon={department.icon}
      size="dot"
      muted={!!department.archivedAt}
    />
  );
}
