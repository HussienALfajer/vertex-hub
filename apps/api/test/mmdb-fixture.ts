import { isIPv4 } from 'node:net';

/*
 * A minimal MMDB writer for test fixtures (IPv6 tree, 24-bit records, maps, strings and
 * unsigned integers), so the GeoIP tests need no downloaded database. Format:
 * https://maxmind.github.io/MaxMind-DB/
 */

type Value = string | number | { [key: string]: Value };

type Record = null | { node: number } | { data: number };

function control(type: number, size: number): Buffer {
  if (size < 29) return Buffer.from([(type << 5) | size]);
  if (size < 285) return Buffer.from([(type << 5) | 29, size - 29]);
  throw new Error('Value too long for the fixture writer');
}

function encode(value: Value): Buffer {
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8');
    return Buffer.concat([control(2, bytes.length), bytes]);
  }
  if (typeof value === 'number') {
    const bytes: number[] = [];
    for (let rest = value; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
    return Buffer.concat([control(6, bytes.length), Buffer.from(bytes)]);
  }
  const entries = Object.entries(value);
  return Buffer.concat([
    control(7, entries.length),
    ...entries.flatMap(([key, item]) => [encode(key), encode(item)]),
  ]);
}

/** The 128 bits of an address; IPv4 sits in `::a.b.c.d`, where MMDB readers look for it. */
function bitsOf(address: string): number[] {
  const bytes: number[] = [];
  if (isIPv4(address)) {
    bytes.push(...new Array(12).fill(0), ...address.split('.').map(Number));
  } else {
    const [head = '', tail = ''] = address.split('::');
    const groups = (part: string) =>
      part ? part.split(':').map((group) => parseInt(group, 16)) : [];
    const start = groups(head);
    const end = groups(tail);
    const all = [...start, ...new Array(8 - start.length - end.length).fill(0), ...end];
    for (const group of all) bytes.push(group >> 8, group & 0xff);
  }
  return bytes.flatMap((byte) => [7, 6, 5, 4, 3, 2, 1, 0].map((shift) => (byte >> shift) & 1));
}

/** An MMDB file mapping each network (`address/prefix`) to its record. */
export function mmdbFixture(networks: [network: string, record: Value][]): Buffer {
  const nodes: [Record, Record][] = [[null, null]];
  const data: Buffer[] = [];
  let dataSize = 0;
  for (const [network, record] of networks) {
    const [address = '', prefixText = ''] = network.split('/');
    const prefix = Number(prefixText) + (isIPv4(address) ? 96 : 0);
    const bits = bitsOf(address);
    const encoded = encode(record);
    const leaf = { data: dataSize };
    data.push(encoded);
    dataSize += encoded.length;
    let node = 0;
    for (let depth = 0; depth < prefix; depth++) {
      const bit = bits[depth] as 0 | 1;
      const current = nodes[node] as [Record, Record];
      if (depth === prefix - 1) {
        current[bit] = leaf;
        break;
      }
      const next = current[bit];
      if (next && 'node' in next) {
        node = next.node;
      } else {
        nodes.push([null, null]);
        node = nodes.length - 1;
        current[bit] = { node };
      }
    }
  }
  const count = nodes.length;
  const value = (record: Record) =>
    record === null ? count : 'node' in record ? record.node : count + 16 + record.data;
  const tree = Buffer.alloc(count * 6);
  nodes.forEach(([left, right], index) => {
    tree.writeUIntBE(value(left), index * 6, 3);
    tree.writeUIntBE(value(right), index * 6 + 3, 3);
  });
  const metadata = encode({
    node_count: count,
    record_size: 24,
    ip_version: 6,
    database_type: 'DBIP-City-Lite',
    binary_format_major_version: 2,
    binary_format_minor_version: 0,
  });
  return Buffer.concat([
    tree,
    Buffer.alloc(16),
    ...data,
    Buffer.from('abcdef4d61784d696e642e636f6d', 'hex'),
    metadata,
  ]);
}
