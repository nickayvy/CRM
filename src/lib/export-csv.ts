// Client-side CSV export (pattern from gtm lib/export-csv.ts). `toCsv` is pure
// and unit-tested; `downloadCsv` wraps it in a Blob download in the browser.

export type CsvColumn<T> = {
  header: string;
  accessor: (row: T) => string | number | null | undefined;
};

/** RFC 4180 quoting: wrap in quotes when the value has a comma, quote, CR or LF; double inner quotes. */
export function escapeCsv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Header line plus one line per row, joined with CRLF and ending in CRLF. null/undefined cells are empty. */
export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const header = columns.map((c) => escapeCsv(c.header)).join(",");
  const body = rows.map((row) =>
    columns
      .map((c) => {
        const v = c.accessor(row);
        return v == null ? "" : escapeCsv(String(v));
      })
      .join(","),
  );
  return [header, ...body].join("\r\n") + "\r\n";
}

/** Builds the CSV and triggers a browser download. Browser only. */
export function downloadCsv<T>(filename: string, columns: CsvColumn<T>[], rows: T[]): void {
  // BOM so spreadsheet apps open UTF-8 names correctly.
  const blob = new Blob(["﻿", toCsv(columns, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has been handled.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
