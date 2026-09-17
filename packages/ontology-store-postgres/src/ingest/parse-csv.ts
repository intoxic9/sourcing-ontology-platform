/**
 * Minimal RFC4180-ish CSV parser: comma-separated, double-quote escaping, no BOM handling.
 */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const nonEmpty = lines.filter((line) => line.trim() !== '');
  if (nonEmpty.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = parseCsvLine(nonEmpty[0] ?? '');
  const rows: string[][] = [];
  for (const line of nonEmpty.slice(1)) {
    rows.push(parseCsvLine(line));
  }
  return { headers, rows };
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i] ?? '';
    if (inQuotes) {
      if (ch === '"') {
        const next = line[i + 1];
        if (next === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out;
}

export function csvRowsToObjects<T>(
  file: string,
  headers: string[],
  rows: string[][],
  mapRow: (record: Record<string, string>) => T,
): { file: string; rows: { line: number; raw: T }[] } {
  const parsed: { line: number; raw: T }[] = [];
  for (const [index, cells] of rows.entries()) {
    const record: Record<string, string> = {};
    for (const [i, header] of headers.entries()) {
      record[header] = cells[i] ?? '';
    }
    parsed.push({ line: index + 2, raw: mapRow(record) });
  }
  return { file, rows: parsed };
}
