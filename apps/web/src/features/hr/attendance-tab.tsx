import { useQuery } from '@tanstack/react-query';
import type { AttendancePasskey, AttendancePunch, EmployeeFile } from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  Skeleton,
  Textarea,
  toast,
} from '@vertex-hub/ui';
import { FingerprintIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { LoadError } from '../../components/load-error';
import { can, useMe } from '../../lib/auth';
import { formatDateTime } from '../../lib/format';
import { AttendanceMonth, monthOrCurrent } from './attendance-month';
import { passkeysQuery, useRevokePasskey } from './hr.queries';
import { RejectPunchDialog } from './hr-today-page';

const passkeyTone = { active: 'success', pending: 'info', revoked: 'neutral' } as const;

/**
 * The file's Attendance tab (spec screen "Employee file"): the passkey and its history (rules C3,
 * C9, C10; `hr.approve` revokes one), then the month's days and items. `hr.approve` rejects a
 * field or shoot punch from a day (rule C12).
 */
export function AttendanceTab({
  file,
  self,
  month,
  onMonthChange,
}: {
  file: EmployeeFile;
  self: boolean;
  month: string | undefined;
  onMonthChange: (month: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const approves = !self && can(me, 'hr.approve');
  const [rejecting, setRejecting] = useState<AttendancePunch | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);

  return (
    <div className="flex flex-col gap-6">
      {!self && <Passkeys userId={file.userId} approves={approves} />}
      <AttendanceMonth
        userId={self ? 'me' : file.userId}
        month={monthOrCurrent(month)}
        onMonthChange={onMonthChange}
        self={self}
        punchAction={
          approves
            ? (punch) =>
                !punch.archivedAt &&
                (punch.method === 'field' || punch.method === 'shoot') && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(event) => {
                      opener.current = event.currentTarget;
                      setRejecting(punch);
                    }}
                  >
                    {t('hr.today.reject')}
                  </Button>
                )
            : undefined
        }
      />
      <RejectPunchDialog
        punch={rejecting}
        onClose={() => setRejecting(null)}
        finalFocus={() => opener.current ?? true}
      />
    </div>
  );
}

function Passkeys({ userId, approves }: { userId: string; approves: boolean }) {
  const { t } = useTranslation();
  const passkeys = useQuery(passkeysQuery(userId));
  const revoke = useRevokePasskey();
  const [revoking, setRevoking] = useState<AttendancePasskey | null>(null);
  const [note, setNote] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle ref={heading} tabIndex={-1} className="flex items-center gap-2 text-lg">
          <FingerprintIcon aria-hidden="true" className="size-5 text-muted-foreground" />
          {t('hr.attendance.passkey.title')}
        </CardTitle>
      </CardHeader>
      {passkeys.isPending ? (
        <Skeleton className="h-16" />
      ) : passkeys.isError ? (
        <LoadError
          message={t('hr.attendance.passkey.loadError')}
          onRetry={() => passkeys.refetch()}
        />
      ) : passkeys.data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="no-passkey">
          {t('hr.attendance.passkey.noneYet')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {passkeys.data.items.map((passkey) => (
            <li
              key={passkey.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border p-2"
            >
              <span className="font-medium">{passkey.deviceLabel}</span>
              <Badge tone={passkeyTone[passkey.status]}>
                {t(`hr.attendance.passkey.statuses.${passkey.status}`)}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {t('hr.attendance.passkey.since', { date: formatDateTime(passkey.createdAt) })}
              </span>
              {approves && passkey.status !== 'revoked' && (
                <Button
                  variant="outline"
                  size="sm"
                  className="ms-auto"
                  onClick={() => setRevoking(passkey)}
                >
                  {t('hr.attendance.passkey.revoke')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={revoking !== null}
        onClose={() => {
          setRevoking(null);
          setNote('');
        }}
        title={t('hr.attendance.passkey.revokeTitle')}
        body={t('hr.attendance.passkey.revokeBody')}
        action={t('hr.attendance.passkey.revoke')}
        destructive
        pending={revoke.isPending}
        onConfirm={async () => {
          if (!revoking) return;
          await revoke.mutateAsync({
            id: revoking.id,
            note: note.trim() || t('hr.attendance.passkey.revokeDefaultNote'),
          });
          toast.add({ title: t('hr.attendance.passkey.revoked'), type: 'success' });
        }}
        finalFocus={() => heading.current ?? true}
      >
        <Textarea
          aria-label={t('hr.attendance.passkey.revokeNote')}
          rows={2}
          maxLength={500}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </ConfirmDialog>
    </Card>
  );
}
