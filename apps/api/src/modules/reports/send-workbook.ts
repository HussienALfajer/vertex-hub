import type { ServerResponse } from 'node:http';
import { contentDisposition } from '../files/index.js';

export const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Sends an Excel file built on request as a download (F15 rule 24); never cached. */
export function sendWorkbook(response: ServerResponse, name: string, file: Buffer): void {
  response.statusCode = 200;
  response.setHeader('Content-Type', XLSX_MIME_TYPE);
  response.setHeader('Content-Length', file.length);
  response.setHeader('Content-Disposition', contentDisposition(false, name));
  response.setHeader('Cache-Control', 'no-store');
  response.end(file);
}
