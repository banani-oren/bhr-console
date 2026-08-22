import * as XLSX from 'xlsx'

export type ExcelSheet = {
  name: string
  rows: Array<Record<string, unknown>>
}

// Excel sheet names: 31 chars max, and none of []:*?/\ allowed.
function sanitizeSheetName(name: string): string {
  return name.replace(/[[\]:*?/\\]/g, '').slice(0, 31)
}

export function exportSheetsToExcel(sheets: ExcelSheet[], filename: string): void {
  const wb = XLSX.utils.book_new()
  for (const sheet of sheets) {
    const ws = XLSX.utils.json_to_sheet(sheet.rows)
    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(sheet.name))
  }
  XLSX.writeFile(wb, filename)
}
