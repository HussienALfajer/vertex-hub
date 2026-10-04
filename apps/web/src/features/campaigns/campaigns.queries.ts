import {
  keepPreviousData,
  type QueryKey,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  AdWallet,
  AdWalletQuery,
  CampaignDetail,
  CampaignStatusChange,
  CampaignUpdateInput,
  CreateCampaign,
  PatchCampaignUpdate,
  RecordWalletEntry,
  UpdateCampaign,
  UpdateWalletThreshold,
  VoidWalletEntry,
} from '@vertex-hub/contracts';
import { api, call } from '../../lib/api/client';
import type { paths } from '../../lib/api/schema.gen';
import { filesKeys } from '../files/files.queries';

/** The list endpoints' query strings as the API reads them. */
export type CampaignListFilters = NonNullable<
  paths['/api/campaigns']['get']['parameters']['query']
>;

export type WalletListFilters = NonNullable<paths['/api/ad-wallets']['get']['parameters']['query']>;

export const campaignsKeys = {
  all: ['campaigns'] as const,
  list: (filters: CampaignListFilters) => ['campaigns', 'list', filters] as const,
  detail: (id: string) => ['campaigns', 'detail', id] as const,
  wallets: (filters: WalletListFilters) => ['campaigns', 'wallets', filters] as const,
  wallet: (clientId: string, query: AdWalletQuery) =>
    ['campaigns', 'wallet', clientId, query] as const,
};

/** How often a wallet whose deposit receipt is being rendered asks again (rule 19). */
const RECEIPT_POLL_MS = 3000;

export const campaignListQuery = (filters: CampaignListFilters) =>
  queryOptions({
    queryKey: campaignsKeys.list(filters),
    queryFn: () => call(api.GET('/api/campaigns', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

export const campaignQuery = (id: string) =>
  queryOptions({
    queryKey: campaignsKeys.detail(id),
    queryFn: () => call(api.GET('/api/campaigns/{id}', { params: { path: { id } } })),
  });

export const walletListQuery = (filters: WalletListFilters) =>
  queryOptions({
    queryKey: campaignsKeys.wallets(filters),
    queryFn: () => call(api.GET('/api/ad-wallets', { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });

export const adWalletQuery = (clientId: string, query: AdWalletQuery = {}) =>
  queryOptions({
    queryKey: campaignsKeys.wallet(clientId, query),
    queryFn: () =>
      call(api.GET('/api/clients/{id}/ad-wallet', { params: { path: { id: clientId }, query } })),
    refetchInterval: (state) =>
      state.state.data?.entries.some(
        (entry) => !entry.voided && entry.receiptPdf?.state === 'pending',
      )
        ? RECEIPT_POLL_MS
        : false,
  });

/** A deposit's receipt PDF (rule 19), served inline and never cached. */
export const depositReceiptUrl = (entryId: string) => `/api/ad-wallet-entries/${entryId}/receipt`;

/**
 * Every campaign change can move the client's wallet (spend of wallet campaigns, rule 15), so the
 * campaign lists, wallets and Ads tabs are refreshed with the changed campaign.
 */
function useSaveCampaign() {
  const queryClient = useQueryClient();
  return (campaign: CampaignDetail) => {
    queryClient.setQueryData(campaignsKeys.detail(campaign.id), campaign);
    return queryClient.invalidateQueries({
      queryKey: campaignsKeys.all,
      predicate: (query) => query.queryKey[1] !== 'detail' || query.queryKey[2] !== campaign.id,
    });
  };
}

export function useCreateCampaign() {
  const save = useSaveCampaign();
  return useMutation({
    mutationFn: (input: CreateCampaign) => call(api.POST('/api/campaigns', { body: input })),
    onSuccess: save,
  });
}

export function useUpdateCampaign(id: string) {
  const save = useSaveCampaign();
  return useMutation({
    mutationFn: (input: UpdateCampaign) =>
      call(api.PUT('/api/campaigns/{id}', { params: { path: { id } }, body: input })),
    onSuccess: save,
  });
}

export function useChangeCampaignStatus(id: string) {
  const save = useSaveCampaign();
  return useMutation({
    mutationFn: (input: CampaignStatusChange) =>
      call(api.POST('/api/campaigns/{id}/status', { params: { path: { id } }, body: input })),
    onSuccess: save,
  });
}

export function useArchiveCampaign(id: string) {
  const save = useSaveCampaign();
  return useMutation({
    mutationFn: () => call(api.POST('/api/campaigns/{id}/archive', { params: { path: { id } } })),
    onSuccess: save,
  });
}

export function useRestoreCampaign(id: string) {
  const save = useSaveCampaign();
  return useMutation({
    mutationFn: () => call(api.POST('/api/campaigns/{id}/restore', { params: { path: { id } } })),
    onSuccess: save,
  });
}

export function useAddCampaignUpdate(campaignId: string) {
  const save = useSaveCampaign();
  return useMutation({
    mutationFn: (input: CampaignUpdateInput) =>
      call(
        api.POST('/api/campaigns/{id}/updates', {
          params: { path: { id: campaignId } },
          body: input,
        }),
      ),
    onSuccess: save,
  });
}

export function useEditCampaignUpdate() {
  const save = useSaveCampaign();
  return useMutation({
    mutationFn: ({ updateId, ...input }: PatchCampaignUpdate & { updateId: string }) =>
      call(
        api.PATCH('/api/campaign-updates/{id}', {
          params: { path: { id: updateId } },
          body: input,
        }),
      ),
    onSuccess: save,
  });
}

export function useArchiveCampaignUpdate() {
  const save = useSaveCampaign();
  return useMutation({
    mutationFn: (updateId: string) =>
      call(api.POST('/api/campaign-updates/{id}/archive', { params: { path: { id: updateId } } })),
    onSuccess: save,
  });
}

/**
 * Wallet changes answer with the whole wallet; the other periods of the ledger, the wallet list,
 * the campaign pages that show the balance, and the client's documents (receipts, proofs) follow.
 */
function useSaveWallet(clientId: string) {
  const queryClient = useQueryClient();
  return (wallet: AdWallet) => {
    queryClient.setQueryData(
      campaignsKeys.wallet(clientId, {
        ...(wallet.from && { from: wallet.from }),
        ...(wallet.to && { to: wallet.to }),
      }),
      wallet,
    );
    const keys: QueryKey[] = [campaignsKeys.all, filesKeys.all];
    return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  };
}

export function useUpdateWalletThreshold(clientId: string) {
  const save = useSaveWallet(clientId);
  return useMutation({
    mutationFn: (input: UpdateWalletThreshold) =>
      call(
        api.PATCH('/api/clients/{id}/ad-wallet', {
          params: { path: { id: clientId } },
          body: input,
        }),
      ),
    onSuccess: save,
  });
}

export function useRecordWalletEntry(clientId: string) {
  const save = useSaveWallet(clientId);
  return useMutation({
    mutationFn: (input: RecordWalletEntry) =>
      call(
        api.POST('/api/clients/{id}/ad-wallet/entries', {
          params: { path: { id: clientId } },
          body: input,
        }),
      ),
    onSuccess: save,
  });
}

export function useVoidWalletEntry(clientId: string) {
  const save = useSaveWallet(clientId);
  return useMutation({
    mutationFn: ({ entryId, ...input }: VoidWalletEntry & { entryId: string }) =>
      call(
        api.POST('/api/ad-wallet-entries/{id}/void', {
          params: { path: { id: entryId } },
          body: input,
        }),
      ),
    onSuccess: save,
  });
}

/** Renders a deposit's receipt again after a failure; the wallet then follows its state. */
export function useRenderDepositReceipt(clientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) =>
      call(api.POST('/api/ad-wallet-entries/{id}/receipt', { params: { path: { id: entryId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campaigns', 'wallet', clientId] }),
  });
}
