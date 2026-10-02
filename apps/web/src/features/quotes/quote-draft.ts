import type {
  CatalogPackage,
  CatalogService,
  Currency,
  QuoteDetail,
  QuoteDraftInput,
  QuoteSection,
} from '@vertex-hub/contracts';

/*
 * The quote builder's form: the whole draft as the API saves it (`quoteDraftSchema`), plus what
 * the screen shows beside each line (its copied name, list price and archived state).
 */

export interface BuilderItem {
  serviceId: string;
  name: string;
  quantity: number;
  revisionRounds: number;
}

export interface BuilderLine {
  /** Set once saved: the line keeps its copied name, template and list price. */
  id?: string;
  section: QuoteSection;
  serviceId: string | null;
  packageId: string | null;
  name: string;
  description: string;
  quantity: number;
  unitPriceMinor: number;
  /** The catalog price in the quote's currency; null when the catalog has none. */
  listUnitPriceMinor: number | null;
  revisionRounds: number | null;
  catalogArchived: boolean;
  items: BuilderItem[];
}

export interface BuilderValues {
  contactId: string | null;
  title: string;
  currency: Currency;
  validityDays: number;
  oneOffDiscountMinor: number;
  monthlyDiscountMinor: number;
  monthlyTermMonths: number | null;
  clientNotes: string;
  terms: string;
  lines: BuilderLine[];
  installments: { name: string; percent: number }[];
}

export function builderValues(quote: QuoteDetail): BuilderValues {
  return {
    contactId: quote.contact?.id ?? null,
    title: quote.title,
    currency: quote.currency,
    validityDays: quote.validityDays,
    oneOffDiscountMinor: quote.oneOffDiscountMinor,
    monthlyDiscountMinor: quote.monthlyDiscountMinor,
    monthlyTermMonths: quote.monthlyTermMonths,
    clientNotes: quote.clientNotes ?? '',
    terms: quote.terms ?? '',
    lines: quote.lines.map((line) => ({
      id: line.id,
      section: line.section,
      serviceId: line.serviceId,
      packageId: line.packageId,
      name: line.name,
      description: line.description ?? '',
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      listUnitPriceMinor: line.listUnitPriceMinor,
      revisionRounds: line.revisionRounds,
      catalogArchived: line.catalogArchived,
      items: line.items.map((item) => ({
        serviceId: item.serviceId,
        name: item.name,
        quantity: item.quantity,
        revisionRounds: item.revisionRounds,
      })),
    })),
    installments: quote.installments.map(({ name, percent }) => ({ name, percent })),
  };
}

/** The draft the API saves: the form without what is only shown. */
export function draftInput(values: BuilderValues, updatedAt: string): QuoteDraftInput {
  return {
    updatedAt,
    contactId: values.contactId,
    title: values.title,
    currency: values.currency,
    validityDays: values.validityDays,
    oneOffDiscountMinor: values.oneOffDiscountMinor,
    monthlyDiscountMinor: values.monthlyDiscountMinor,
    monthlyTermMonths: values.monthlyTermMonths,
    clientNotes: values.clientNotes,
    terms: values.terms,
    lines: values.lines.map((line) => ({
      ...(line.id && { id: line.id }),
      section: line.section,
      serviceId: line.serviceId,
      packageId: line.packageId,
      description: line.description,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      revisionRounds: line.revisionRounds,
      items: line.items.map(({ serviceId, quantity, revisionRounds }) => ({
        serviceId,
        quantity,
        revisionRounds,
      })),
    })),
    installments: values.installments,
  };
}

type Priced = Pick<CatalogService, 'priceUsdMinor' | 'priceSypMinor'>;

/** The catalog price in a currency; null when the catalog has none in it. */
export function catalogPrice(item: Priced, currency: Currency): number | null {
  return currency === 'USD' ? item.priceUsdMinor : item.priceSypMinor;
}

/** A service line as added from the catalog: its price in the quote's currency, 0 without one. */
export function serviceLine(service: CatalogService, currency: Currency): BuilderLine {
  const price = catalogPrice(service, currency);
  return {
    section: service.billing,
    serviceId: service.id,
    packageId: null,
    name: service.name,
    description: service.description ?? '',
    quantity: 1,
    unitPriceMinor: price ?? 0,
    listUnitPriceMinor: price,
    revisionRounds: service.revisionRounds,
    catalogArchived: false,
    items: [],
  };
}

/** A package line: quantity 1 at the package price, its services with their own rounds. */
export function packageLine(
  pkg: CatalogPackage,
  currency: Currency,
  rounds: (serviceId: string) => number,
): BuilderLine {
  const price = catalogPrice(pkg, currency);
  return {
    section: pkg.billing,
    serviceId: null,
    packageId: pkg.id,
    name: pkg.name,
    description: pkg.description ?? '',
    quantity: 1,
    unitPriceMinor: price ?? 0,
    listUnitPriceMinor: price,
    revisionRounds: null,
    catalogArchived: false,
    items: pkg.items.map((item) => ({
      serviceId: item.serviceId,
      name: item.name,
      quantity: item.quantity,
      revisionRounds: rounds(item.serviceId),
    })),
  };
}

/**
 * Rule 3: a new currency prices every line from the catalog again; lines without a price in it
 * start at 0. The API does the same on save, so this only shows it before then.
 */
export function repriced(
  lines: readonly BuilderLine[],
  currency: Currency,
  catalog: {
    service: (id: string) => Priced | undefined;
    package: (id: string) => Priced | undefined;
  },
): BuilderLine[] {
  return lines.map((line) => {
    const item = line.serviceId
      ? catalog.service(line.serviceId)
      : catalog.package(line.packageId ?? '');
    const price = item ? catalogPrice(item, currency) : null;
    return { ...line, unitPriceMinor: price ?? 0, listUnitPriceMinor: price };
  });
}
