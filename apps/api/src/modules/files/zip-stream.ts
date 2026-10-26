import { Readable, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { crc32 } from 'node:zlib';

/** One file of an archive: its name inside it, its size and a fresh reader of its bytes. */
export interface ZipEntry {
  name: string;
  size: number;
  read: () => Readable;
}

/** A text file of an archive, in UTF-8. */
export function textEntry(name: string, text: string): ZipEntry {
  const bytes = Buffer.from(text, 'utf8');
  return { name, size: bytes.length, read: () => Readable.from([bytes]) };
}

const MAX_32 = 0xffffffff;
const MAX_16 = 0xffff;
/** UTF-8 names (general purpose bit 11). */
const UTF8_FLAG = 0x0800;
/** 4.5: ZIP64; 2.0: plain stored files. */
const ZIP64_VERSION = 45;
const PLAIN_VERSION = 20;

/** MS-DOS time and date of `at`, in UTC. */
function dosDateTime(at: Date): { time: number; date: number } {
  return {
    time: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | (at.getUTCSeconds() >> 1),
    date: ((at.getUTCFullYear() - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
  };
}

async function crcOf(stream: Readable): Promise<number> {
  let crc = 0;
  for await (const chunk of stream) crc = crc32(chunk as Buffer, crc);
  return crc;
}

async function write(out: Writable, bytes: Buffer): Promise<void> {
  if (out.write(bytes)) return;
  await new Promise<void>((resolve, reject) => {
    const done = (error?: Error) => {
      out.off('drain', done);
      out.off('error', done);
      out.off('close', closed);
      if (error) reject(error);
      else resolve();
    };
    const closed = () => done(new Error('The output closed'));
    out.once('drain', done);
    out.once('error', done);
    out.once('close', closed);
  });
}

/**
 * Streams a ZIP archive of stored (uncompressed) files to `out` and ends it: the media of a
 * publishing pack are already compressed (spec F08B rule A11). Each file is read twice, once for
 * its CRC, so every local header carries its sizes. Files stay under 4 GiB (F10's upload limit);
 * offsets past it use ZIP64 records.
 */
export async function writeZip(
  entries: readonly ZipEntry[],
  out: Writable,
  now: Date = new Date(),
): Promise<void> {
  const { time, date } = dosDateTime(now);
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    if (entry.size >= MAX_32) throw new Error(`${entry.name} is too large for the archive`);
    const crc = await crcOf(entry.read());
    const name = Buffer.from(entry.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(PLAIN_VERSION, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.size, 18);
    local.writeUInt32LE(entry.size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    await write(out, Buffer.concat([local, name]));
    let written = 0;
    const reader = entry.read();
    reader.on('data', (chunk: Buffer) => {
      written += chunk.length;
    });
    await pipeline(reader, out, { end: false });
    if (written !== entry.size) throw new Error(`${entry.name} changed while it was archived`);

    const zip64 = offset >= MAX_32;
    const extra = Buffer.alloc(zip64 ? 12 : 0);
    if (zip64) {
      extra.writeUInt16LE(0x0001, 0);
      extra.writeUInt16LE(8, 2);
      extra.writeBigUInt64LE(BigInt(offset), 4);
    }
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(ZIP64_VERSION, 4);
    header.writeUInt16LE(zip64 ? ZIP64_VERSION : PLAIN_VERSION, 6);
    header.writeUInt16LE(UTF8_FLAG, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(time, 12);
    header.writeUInt16LE(date, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(entry.size, 20);
    header.writeUInt32LE(entry.size, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt16LE(extra.length, 30);
    header.writeUInt32LE(zip64 ? MAX_32 : offset, 42);
    central.push(header, name, extra);
    offset += local.length + name.length + entry.size;
  }

  const directory = Buffer.concat(central);
  const directoryOffset = offset;
  const zip64 =
    directoryOffset >= MAX_32 ||
    directoryOffset + directory.length >= MAX_32 ||
    entries.length >= MAX_16;
  const records: Buffer[] = [directory];
  if (zip64) {
    const record = Buffer.alloc(56);
    record.writeUInt32LE(0x06064b50, 0);
    record.writeBigUInt64LE(44n, 4);
    record.writeUInt16LE(ZIP64_VERSION, 12);
    record.writeUInt16LE(ZIP64_VERSION, 14);
    record.writeBigUInt64LE(BigInt(entries.length), 24);
    record.writeBigUInt64LE(BigInt(entries.length), 32);
    record.writeBigUInt64LE(BigInt(directory.length), 40);
    record.writeBigUInt64LE(BigInt(directoryOffset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(BigInt(directoryOffset + directory.length), 8);
    locator.writeUInt32LE(1, 16);
    records.push(record, locator);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Math.min(entries.length, MAX_16), 8);
  end.writeUInt16LE(Math.min(entries.length, MAX_16), 10);
  end.writeUInt32LE(zip64 ? MAX_32 : directory.length, 12);
  end.writeUInt32LE(zip64 ? MAX_32 : directoryOffset, 16);
  records.push(end);
  await write(out, Buffer.concat(records));
  out.end();
}
