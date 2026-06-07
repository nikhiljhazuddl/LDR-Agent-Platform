import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';
import type { CompanyResult } from '../types.js';
import { RESULT_HEADERS, resultToRow } from './result-columns.js';

const SHEET_NAME = 'Results';

export class ExcelClient {
  private outputPath: string;

  constructor(outputPath: string) {
    this.outputPath = outputPath;
  }

  appendResult(result: CompanyResult): void {
    const workbook = this.loadWorkbook();
    const worksheet = workbook.Sheets[SHEET_NAME] ?? XLSX.utils.aoa_to_sheet([RESULT_HEADERS]);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, blankrows: false });

    if (rows.length === 0) {
      rows.push(RESULT_HEADERS);
    }

    rows.push(resultToRow(result));
    workbook.Sheets[SHEET_NAME] = XLSX.utils.aoa_to_sheet(rows);
    if (!workbook.SheetNames.includes(SHEET_NAME)) {
      workbook.SheetNames.push(SHEET_NAME);
    }

    fs.mkdirSync(path.dirname(this.outputPath), { recursive: true });
    XLSX.writeFile(workbook, this.outputPath);
  }

  private loadWorkbook(): XLSX.WorkBook {
    if (fs.existsSync(this.outputPath)) {
      return XLSX.readFile(this.outputPath);
    }
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([RESULT_HEADERS]), SHEET_NAME);
    return workbook;
  }
}
