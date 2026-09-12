// Client-side table export: straight into a Google Sheet, or a CSV file.
// There's no Google API behind this — the rows go on the clipboard as TSV and
// a blank sheet opens to paste into, which needs no OAuth setup and lands one
// cell per column.

export interface SheetTable {
  title: string;
  headers: string[];
  rows: string[][];
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function tableToCsv(t: SheetTable): string {
  return [t.headers, ...t.rows].map((r) => r.map(csvCell).join(",")).join("\n");
}

// TSV pastes cleanly into a Google Sheet — one cell per column, no dialogs.
export function tableToTsv(t: SheetTable): string {
  const clean = (v: string) => v.replace(/[\t\n]/g, " ");
  return [t.headers, ...t.rows].map((r) => r.map(clean).join("\t")).join("\n");
}

/**
 * Copies the table and opens a fresh Google Sheet to paste into. Must be
 * called synchronously inside a click handler: browsers only allow clipboard
 * writes and popups from a user gesture.
 */
export function openInSheets(t: SheetTable): void {
  navigator.clipboard.writeText(tableToTsv(t)).catch(() => {});
  window.open("https://sheets.new", "_blank");
}

export function downloadCsv(t: SheetTable, fallbackName = "export"): void {
  const blob = new Blob([tableToCsv(t)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${t.title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || fallbackName}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
