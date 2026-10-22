import { useQuery } from '@tanstack/react-query';
import {
  type AttendanceKiosk,
  type AttendanceKioskPairing,
  createAttendanceKioskSchema,
  KIOSK_LIMITS,
} from '@vertex-hub/contracts';
import {
  Badge,
  Button,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@vertex-hub/ui';
import { KeyRoundIcon, MonitorSmartphoneIcon, PlusIcon, UnplugIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { LoadError } from '../../components/load-error';
import { TabHeader } from '../../components/tab-header';
import { errorMessage } from '../../lib/errors';
import { formatDateTime, formatRelativeTime, formatTime } from '../../lib/format';
import { FormDialog } from '../quotes/quote-dialogs';
import { kiosksQuery, useArchiveKiosk, useCreateKiosk, useKioskPairingCode } from './hr.queries';

/**
 * Entrance screens (spec screen "HR settings", rule C4): create a screen, show its pairing code
 * (8 characters, 15 minutes) to type on the office screen's `/kiosk`, see when each was last
 * seen, and unpair one (archived).
 */
export function KiosksTab() {
  const { t } = useTranslation();
  const kiosks = useQuery(kiosksQuery);
  const [creating, setCreating] = useState(false);
  const [pairing, setPairing] = useState<AttendanceKioskPairing | null>(null);
  const [unpairing, setUnpairing] = useState<AttendanceKiosk | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const newCode = useKioskPairingCode();
  const archive = useArchiveKiosk();
  const live = (kiosks.data?.items ?? []).filter((kiosk) => !kiosk.archivedAt);

  return (
    <div className="flex flex-col gap-4">
      <TabHeader
        title={t('hr.kiosks.title')}
        description={t('hr.kiosks.hint')}
        action={
          <Button ref={addButton} onClick={() => setCreating(true)}>
            <PlusIcon />
            {t('hr.kiosks.add')}
          </Button>
        }
      />
      {kiosks.isPending ? (
        <Skeleton className="h-40" />
      ) : kiosks.isError ? (
        <LoadError message={t('hr.kiosks.loadError')} onRetry={() => kiosks.refetch()} />
      ) : live.length === 0 ? (
        <EmptyState
          icon={<MonitorSmartphoneIcon />}
          title={t('hr.kiosks.emptyTitle')}
          description={t('hr.kiosks.emptyHint')}
        />
      ) : (
        <div className="rounded-lg border border-border bg-surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('hr.kiosks.name')}</TableHead>
                <TableHead>{t('hr.kiosks.state')}</TableHead>
                <TableHead>{t('hr.kiosks.lastSeen')}</TableHead>
                <TableHead>{t('hr.kiosks.address')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('hr.kiosks.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {live.map((kiosk) => (
                <TableRow key={kiosk.id} data-kiosk={kiosk.name}>
                  <TableCell className="font-medium">{kiosk.name}</TableCell>
                  <TableCell>
                    {kiosk.paired ? (
                      <Badge tone="success">{t('hr.kiosks.paired')}</Badge>
                    ) : kiosk.pairingExpiresAt ? (
                      <Badge tone="warning">
                        {t('hr.kiosks.waiting', { time: formatTime(kiosk.pairingExpiresAt) })}
                      </Badge>
                    ) : (
                      <Badge tone="neutral">{t('hr.kiosks.unpaired')}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {kiosk.lastSeenAt ? (
                      <time dateTime={kiosk.lastSeenAt} title={formatDateTime(kiosk.lastSeenAt)}>
                        {formatRelativeTime(kiosk.lastSeenAt)}
                      </time>
                    ) : (
                      <span className="text-muted-foreground">{t('hr.kiosks.neverSeen')}</span>
                    )}
                  </TableCell>
                  <TableCell dir="ltr" className="text-end tabular-nums">
                    {kiosk.lastIpAddress ?? '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <IconButton
                        label={t('hr.kiosks.newCodeOf', { name: kiosk.name })}
                        disabled={newCode.isPending}
                        onClick={async () => {
                          try {
                            setPairing(await newCode.mutateAsync(kiosk.id));
                          } catch (error) {
                            toast.add({ title: errorMessage(t, error), type: 'error' });
                          }
                        }}
                      >
                        <KeyRoundIcon />
                      </IconButton>
                      <IconButton
                        label={t('hr.kiosks.unpairOf', { name: kiosk.name })}
                        onClick={() => setUnpairing(kiosk)}
                      >
                        <UnplugIcon />
                      </IconButton>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <CreateKioskDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={setPairing}
        finalFocus={() => addButton.current ?? true}
      />
      <PairingCodeDialog pairing={pairing} onClose={() => setPairing(null)} />
      <ConfirmDialog
        open={unpairing !== null}
        onClose={() => setUnpairing(null)}
        title={t('hr.kiosks.unpairTitle', { name: unpairing?.name ?? '' })}
        body={t('hr.kiosks.unpairBody')}
        action={t('hr.kiosks.unpair')}
        destructive
        pending={archive.isPending}
        onConfirm={async () => {
          if (!unpairing) return;
          await archive.mutateAsync(unpairing.id);
          toast.add({ title: t('hr.kiosks.unpaired'), type: 'success' });
        }}
        finalFocus={() => addButton.current ?? true}
      />
    </div>
  );
}

function CreateKioskDialog({
  open,
  onClose,
  onCreated,
  finalFocus,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (pairing: AttendanceKioskPairing) => void;
  finalFocus: () => HTMLElement | boolean;
}) {
  const { t } = useTranslation();
  const create = useCreateKiosk();
  const [name, setName] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onClosed={() => {
        setName('');
        setInvalid(false);
        setFailure(null);
      }}
      finalFocus={finalFocus}
      submitting={create.isPending}
      title={t('hr.kiosks.addTitle')}
      description={t('hr.kiosks.addHint')}
      action={t('hr.kiosks.create')}
      failure={failure}
      onSubmit={async (event) => {
        event?.preventDefault();
        setFailure(null);
        const parsed = createAttendanceKioskSchema.safeParse({ name });
        if (!parsed.success) {
          setInvalid(true);
          field.current?.focus();
          return;
        }
        try {
          const pairing = await create.mutateAsync(parsed.data);
          onClose();
          onCreated(pairing);
        } catch (error) {
          setFailure(errorMessage(t, error));
        }
      }}
    >
      <Field invalid={invalid}>
        <FieldLabel>{t('hr.kiosks.name')}</FieldLabel>
        <Input
          ref={field}
          maxLength={KIOSK_LIMITS.name}
          value={name}
          placeholder={t('hr.kiosks.namePlaceholder')}
          onChange={(event) => {
            setName(event.target.value);
            setInvalid(false);
          }}
        />
        <FieldError match={invalid}>{t('hr.kiosks.nameRequired')}</FieldError>
      </Field>
    </FormDialog>
  );
}

/** The pairing code, shown once: typed on the office screen's `/kiosk` within 15 minutes. */
function PairingCodeDialog({
  pairing,
  onClose,
}: {
  pairing: AttendanceKioskPairing | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={pairing !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('hr.kiosks.codeTitle', { name: pairing?.name ?? '' })}</DialogTitle>
          <DialogDescription>
            {t('hr.kiosks.codeHint', { url: `${window.location.origin}/kiosk` })}
          </DialogDescription>
        </DialogHeader>
        <p
          dir="ltr"
          className="rounded-md bg-muted py-4 text-center text-4xl font-bold tabular-nums"
          data-testid="pairing-code"
        >
          {pairing?.pairingCode}
        </p>
        {pairing?.pairingExpiresAt && (
          <p className="text-sm text-muted-foreground">
            {t('hr.kiosks.codeExpires', { time: formatTime(pairing.pairingExpiresAt) })}
          </p>
        )}
        <DialogFooter>
          <Button onClick={onClose}>{t('common.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
