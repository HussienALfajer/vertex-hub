import { useQuery } from '@tanstack/react-query';
import {
  type Amendment,
  businessDate,
  type ContractMissingField,
  type RetainerContract,
  type RetainerContractDetail,
} from '@vertex-hub/contracts';
import {
  Button,
  type ButtonProps,
  Callout,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldError,
  FieldLabel,
  Input,
  Skeleton,
  Textarea,
  toast,
} from '@vertex-hub/ui';
import type { TFunction } from 'i18next';
import {
  BanIcon,
  FileCheck2Icon,
  FilePlus2Icon,
  FileSignatureIcon,
  StampIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { LoadError } from '../../components/load-error';
import { errorMessage } from '../../lib/errors';
import { formatNumber } from '../../lib/format';
import { type Proof, ProofField } from '../files/proof-field';
import { retainerContractQuery, useIssueAnnex, useIssueContract } from './retainers.queries';

/** Where a dialog sends the focus when the button that opened it is gone. */
export type Fallback = () => HTMLElement | null | undefined;

/** "Contract VM-CCS-2026-001", or "Draft contract" before it holds a number. */
export function contractName(t: TFunction, contract: Pick<RetainerContract, 'number'>): string {
  return contract.number
    ? t('retainers.contracts.name', { number: contract.number })
    : t('retainers.contracts.draftName');
}

/** A party field as the contract prints it: "Legal name (agency)". */
export function missingFieldName(t: TFunction, field: ContractMissingField): string {
  return field.party === 'agency'
    ? t(`retainers.contractSettings.fields.${field.field as AgencyField}`)
    : t(`retainers.contracts.clientFields.${field.field as ClientField}`);
}

type AgencyField = Exclude<
  ContractMissingField['field'],
  'signatoryName' | 'fatherName' | 'nationalId' | 'title'
>;

type ClientField = Exclude<
  ContractMissingField['field'],
  'legalName' | 'companyType' | 'website' | 'representativeName' | 'representativeTitle'
>;

/** A button that opens a dialog and gets the focus back when it closes. */
function useDialog(fallback?: Fallback) {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const finalFocus = () => (button.current?.isConnected ? button.current : (fallback?.() ?? true));
  return { button, open, setOpen, finalFocus };
}

/**
 * K4: issuing a draft. The dialog reads the draft as it will print: required fields that are
 * empty block it; other empty fields print as lines to fill in by hand, listed first; blocks no
 * article prints are a warning (K7).
 */
export function IssueContractDialog({
  retainerId,
  contractId,
  disabled,
  size,
  fallback,
}: {
  retainerId: string;
  contractId: string;
  /** The draft has unsaved changes: issuing would issue the stored one. */
  disabled?: boolean;
  size?: ButtonProps['size'];
  fallback?: Fallback;
}) {
  const { t } = useTranslation();
  const dialog = useDialog(fallback);
  const contract = useQuery({
    ...retainerContractQuery(retainerId, contractId),
    enabled: dialog.open,
  });
  const issue = useIssueContract(retainerId, contractId);
  const [failure, setFailure] = useState<string | null>(null);

  async function submit() {
    setFailure(null);
    try {
      const issued = await issue.mutateAsync();
      toast.add({
        title: t('retainers.contracts.issued', { number: issued.number ?? '' }),
        type: 'success',
      });
      dialog.setOpen(false);
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }

  return (
    <>
      <Button
        ref={dialog.button}
        size={size}
        disabled={disabled}
        focusableWhenDisabled
        onClick={() => {
          setFailure(null);
          dialog.setOpen(true);
        }}
      >
        <StampIcon />
        {t('retainers.contracts.issue')}
      </Button>
      <Dialog open={dialog.open} onOpenChange={(next) => !next && dialog.setOpen(false)}>
        <DialogContent closeLabel={t('common.close')} finalFocus={dialog.finalFocus}>
          <DialogHeader>
            <DialogTitle>{t('retainers.contracts.issueTitle')}</DialogTitle>
            <DialogDescription>{t('retainers.contracts.issueBody')}</DialogDescription>
          </DialogHeader>
          {contract.isPending ? (
            <Skeleton className="h-24" />
          ) : contract.isError ? (
            <LoadError
              message={t('retainers.contracts.loadError')}
              onRetry={() => contract.refetch()}
              error={contract.error}
            />
          ) : (
            <IssueChecks contract={contract.data} />
          )}
          {failure && <FormAlert>{failure}</FormAlert>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              {t('common.cancel')}
            </DialogClose>
            <Button
              onClick={submit}
              disabled={
                issue.isPending ||
                !contract.isSuccess ||
                contract.data.missing.some((field) => field.required)
              }
            >
              <StampIcon />
              {t('retainers.contracts.issueAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function IssueChecks({ contract }: { contract: RetainerContractDetail }) {
  const { t } = useTranslation();
  const required = contract.missing.filter((field) => field.required);
  const empty = contract.missing.filter((field) => !field.required);
  const fieldList = (fields: ContractMissingField[]) => (
    <ul className="list-disc ps-5 text-sm">
      {fields.map((field) => (
        <li key={`${field.party}-${field.field}`}>
          {missingFieldName(t, field)}{' '}
          <span className="text-muted-foreground">
            ({t(`retainers.contracts.parties.${field.party}`)})
          </span>
        </li>
      ))}
    </ul>
  );
  if (required.length === 0 && empty.length === 0 && contract.absentBlocks.length === 0) {
    return <p className="text-sm">{t('retainers.contracts.issueComplete')}</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {required.length > 0 && (
        <div className="flex flex-col gap-2" role="alert">
          <p className="text-sm font-medium text-destructive-text">
            {t('retainers.contracts.issueRequired')}
          </p>
          {fieldList(required)}
        </div>
      )}
      {empty.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{t('retainers.contracts.issueEmpty')}</p>
          {fieldList(empty)}
        </div>
      )}
      {contract.absentBlocks.length > 0 && (
        <Callout
          tone="warning"
          icon={<TriangleAlertIcon />}
          title={t('retainers.contracts.absentBlocks')}
          description={contract.absentBlocks
            .map((block) => t(`retainers.contractSettings.placeholders.${block}`))
            .join('، ')}
        />
      )}
    </div>
  );
}

/** K8, K10: voiding an issued or signed contract or annex needs a reason. */
export function VoidDialog({
  title,
  body,
  onVoid,
  size = 'sm',
  fallback,
}: {
  title: string;
  body: string;
  onVoid: (reason: string) => Promise<unknown>;
  size?: ButtonProps['size'];
  fallback?: Fallback;
}) {
  const { t } = useTranslation();
  const id = useId();
  const dialog = useDialog(fallback);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    if (!reason.trim()) {
      setMissing(true);
      reasonRef.current?.focus();
      return;
    }
    setPending(true);
    try {
      await onVoid(reason.trim());
      toast.add({ title: t('retainers.contracts.voided'), type: 'success' });
      dialog.setOpen(false);
    } catch (error) {
      setFailure(errorMessage(t, error));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        ref={dialog.button}
        variant="outline"
        size={size}
        onClick={() => {
          setReason('');
          setMissing(false);
          setFailure(null);
          dialog.setOpen(true);
        }}
      >
        <BanIcon />
        {t('retainers.contracts.void')}
      </Button>
      <Dialog open={dialog.open} onOpenChange={(next) => !next && dialog.setOpen(false)}>
        <DialogContent closeLabel={t('common.close')} finalFocus={dialog.finalFocus}>
          <form className="grid gap-5" onSubmit={submit} noValidate>
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{body}</DialogDescription>
            </DialogHeader>
            <Field invalid={missing}>
              <FieldLabel htmlFor={id}>{t('retainers.contracts.voidReason')}</FieldLabel>
              <Textarea
                ref={reasonRef}
                id={id}
                rows={2}
                maxLength={500}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  setMissing(false);
                }}
              />
              <FieldError match={missing}>{t('retainers.contracts.errors.voidReason')}</FieldError>
            </Field>
            {failure && <FormAlert>{failure}</FormAlert>}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" type="button" />}>
                {t('common.cancel')}
              </DialogClose>
              <Button type="submit" variant="destructive" disabled={pending}>
                {t('retainers.contracts.void')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** K5: the signed scan (PDF or image) with the signing date; a new upload is a new version. */
export function SignedCopyDialog({
  title,
  replacing,
  onSign,
  size = 'sm',
  fallback,
}: {
  title: string;
  /** A signed copy exists: the upload replaces it. */
  replacing: boolean;
  onSign: (input: { signedOn: string; uploadId: string }) => Promise<unknown>;
  size?: ButtonProps['size'];
  fallback?: Fallback;
}) {
  const { t } = useTranslation();
  const dateId = useId();
  const dialog = useDialog(fallback);
  const [signedOn, setSignedOn] = useState('');
  const [proof, setProof] = useState<Proof | null>(null);
  const [problems, setProblems] = useState<{ date?: boolean; file?: boolean }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const today = businessDate();

  function close() {
    proof?.controller?.abort();
    setProof(null);
    dialog.setOpen(false);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    const next = { date: !signedOn || signedOn > today, file: !proof?.uploadId };
    setProblems(next);
    if (proof && !proof.uploadId && !proof.error) {
      setFailure(t('retainers.contracts.uploadWaiting'));
      return;
    }
    if (next.date || next.file || !proof?.uploadId) return;
    setPending(true);
    try {
      await onSign({ signedOn, uploadId: proof.uploadId });
      toast.add({ title: t('retainers.contracts.signedSaved'), type: 'success' });
      setProof(null);
      dialog.setOpen(false);
    } catch (error) {
      setFailure(errorMessage(t, error));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        ref={dialog.button}
        variant="outline"
        size={size}
        onClick={() => {
          setSignedOn(today);
          setProof(null);
          setProblems({});
          setFailure(null);
          dialog.setOpen(true);
        }}
      >
        <FileSignatureIcon />
        {replacing ? t('retainers.contracts.replaceSigned') : t('retainers.contracts.uploadSigned')}
      </Button>
      <Dialog open={dialog.open} onOpenChange={(next) => !next && close()}>
        <DialogContent closeLabel={t('common.close')} finalFocus={dialog.finalFocus}>
          <form className="grid gap-5" onSubmit={submit} noValidate>
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>
                {replacing
                  ? t('retainers.contracts.signedReplaceBody')
                  : t('retainers.contracts.signedBody')}
              </DialogDescription>
            </DialogHeader>
            <Field invalid={problems.date}>
              <FieldLabel htmlFor={dateId}>{t('retainers.contracts.signedOn')}</FieldLabel>
              <Input
                id={dateId}
                type="date"
                dir="ltr"
                max={today}
                value={signedOn}
                onChange={(event) => {
                  setSignedOn(event.target.value);
                  setProblems((current) => ({ ...current, date: false }));
                }}
              />
              <FieldError match={!!problems.date}>
                {t('retainers.contracts.errors.signedOn')}
              </FieldError>
            </Field>
            <ProofField
              proof={proof}
              onProof={(next) => {
                setProof(next);
                setProblems((current) => ({ ...current, file: false }));
              }}
              label={t('retainers.contracts.signedFile')}
              hint={t('retainers.contracts.signedFileHint')}
            />
            {problems.file && !proof && (
              <p role="alert" className="text-sm text-destructive-text">
                {t('retainers.contracts.errors.signedFile')}
              </p>
            )}
            {failure && <FormAlert>{failure}</FormAlert>}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" type="button" />}>
                {t('common.cancel')}
              </DialogClose>
              <Button type="submit" disabled={pending}>
                <FileCheck2Icon />
                {t('retainers.contracts.saveSigned')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** K10: "Issue annex" on an applied amendment a contract covers. */
export function IssueAnnexDialog({
  retainerId,
  amendment,
  contract,
  fallback,
}: {
  retainerId: string;
  amendment: Pick<Amendment, 'id' | 'number'>;
  contract: RetainerContract;
  fallback?: Fallback;
}) {
  const { t } = useTranslation();
  const dateId = useId();
  const dialog = useDialog(fallback);
  const issue = useIssueAnnex(retainerId);
  const [annexDate, setAnnexDate] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const annexNumber = contract.annexes.length + 1;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    if (!annexDate) {
      setInvalid(true);
      return;
    }
    try {
      await issue.mutateAsync({ amendmentId: amendment.id, annexDate });
      toast.add({ title: t('retainers.contracts.annexIssued'), type: 'success' });
      dialog.setOpen(false);
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }

  return (
    <>
      <Button
        ref={dialog.button}
        variant="outline"
        size="sm"
        onClick={() => {
          setAnnexDate(businessDate());
          setInvalid(false);
          setFailure(null);
          dialog.setOpen(true);
        }}
      >
        <FilePlus2Icon />
        {t('retainers.contracts.issueAnnex')}
      </Button>
      <Dialog open={dialog.open} onOpenChange={(next) => !next && dialog.setOpen(false)}>
        <DialogContent closeLabel={t('common.close')} finalFocus={dialog.finalFocus}>
          <form className="grid gap-5" onSubmit={submit} noValidate>
            <DialogHeader>
              <DialogTitle>
                {t('retainers.contracts.annexTitle', {
                  annex: formatNumber(annexNumber),
                  number: contract.number ?? '',
                })}
              </DialogTitle>
              <DialogDescription>
                {t('retainers.contracts.annexBody', {
                  amendment: formatNumber(amendment.number),
                })}
              </DialogDescription>
            </DialogHeader>
            <Field invalid={invalid}>
              <FieldLabel htmlFor={dateId}>{t('retainers.contracts.annexDate')}</FieldLabel>
              <Input
                id={dateId}
                type="date"
                dir="ltr"
                value={annexDate}
                onChange={(event) => {
                  setAnnexDate(event.target.value);
                  setInvalid(false);
                }}
              />
              <FieldError match={invalid}>{t('retainers.contracts.errors.date')}</FieldError>
            </Field>
            {failure && <FormAlert>{failure}</FormAlert>}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" type="button" />}>
                {t('common.cancel')}
              </DialogClose>
              <Button type="submit" disabled={issue.isPending}>
                <StampIcon />
                {t('retainers.contracts.issueAnnexAction')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
