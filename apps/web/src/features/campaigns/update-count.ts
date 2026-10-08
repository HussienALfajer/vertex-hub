import { rateInput } from '../../lib/money';

/**
 * A typed count: digits only, Arabic-Indic ones read as Latin. A count is whole, so a thousands
 * separator (`15,000`, `١٥٬٠٠٠`) cannot be mistaken for a decimal mark and is dropped.
 */
export const count = (text: string) => {
  const digits = rateInput(text).replace(/[,٬\s]/g, '');
  return /^\d+$/.test(digits) ? Number(digits) : Number.NaN;
};
