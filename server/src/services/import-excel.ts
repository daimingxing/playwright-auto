import ExcelJS from 'exceljs';
import type { ImportCaseSource, ImportDataSource, ImportStepSource } from '../../../shared/types';
import { badRequest } from '../lib/http-error';

export interface ParsedImportCase {
  caseInfo: ImportCaseSource;
  steps: ImportStepSource[];
  data: ImportDataSource[];
  rowRefs: {
    caseRow: number;
    stepRows: number[];
    dataRows: number[];
  };
}

interface RowItem<T> {
  rowIndex: number;
  value: T;
}

/**
 * 解析 AI 用例导入 Excel。
 */
export async function parseImportExcel(buffer: Buffer): Promise<ParsedImportCase[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

  const caseRows = readCaseSheet(workbook);
  const stepRows = readStepSheet(workbook);
  const dataRows = readDataSheet(workbook);

  return joinImportRows(caseRows, stepRows, dataRows);
}

/**
 * 读取用例清单工作表。
 */
function readCaseSheet(workbook: ExcelJS.Workbook) {
  const sheet = getSheet(workbook, '用例清单');
  const rows: Array<RowItem<ImportCaseSource>> = [];
  const caseNos = new Set<string>();

  sheet.eachRow((row, rowIndex) => {
    if (rowIndex === 1 || isBlankRow(row)) {
      return;
    }

    const value: ImportCaseSource = {
      caseNo: readRequiredText(row, 1, rowIndex, '用例编号'),
      caseName: readRequiredText(row, 2, rowIndex, '用例名称'),
      targetUrl: readRequiredText(row, 3, rowIndex, '目标页面URL'),
      precondition: readText(row, 4),
      expectedResult: readRequiredText(row, 5, rowIndex, '预期结果'),
      note: readText(row, 6)
    };

    if (caseNos.has(value.caseNo)) {
      throw badRequest(`用例编号重复：${value.caseNo}`);
    }

    caseNos.add(value.caseNo);
    rows.push({ rowIndex, value });
  });

  if (rows.length === 0) {
    throw badRequest('用例清单不能为空');
  }

  return rows;
}

/**
 * 读取步骤明细工作表。
 */
function readStepSheet(workbook: ExcelJS.Workbook) {
  const sheet = getSheet(workbook, '步骤明细');
  const rows: Array<RowItem<ImportStepSource>> = [];

  sheet.eachRow((row, rowIndex) => {
    if (rowIndex === 1 || isBlankRow(row)) {
      return;
    }

    rows.push({
      rowIndex,
      value: {
        caseNo: readRequiredText(row, 1, rowIndex, '用例编号'),
        stepNo: readRequiredInt(row, 2, rowIndex, '步骤序号'),
        actionText: readRequiredText(row, 3, rowIndex, '操作描述'),
        targetText: readText(row, 4),
        dataKeys: readDataKeys(row, 5),
        note: readText(row, 6)
      }
    });
  });

  return rows;
}

/**
 * 读取测试数据工作表。
 */
function readDataSheet(workbook: ExcelJS.Workbook) {
  const sheet = getSheet(workbook, '测试数据');
  const rows: Array<RowItem<ImportDataSource>> = [];

  sheet.eachRow((row, rowIndex) => {
    if (rowIndex === 1 || isBlankRow(row)) {
      return;
    }

    rows.push({
      rowIndex,
      value: {
        caseNo: readRequiredText(row, 1, rowIndex, '用例编号'),
        dataKey: readRequiredText(row, 2, rowIndex, '数据标识'),
        dataName: readRequiredText(row, 3, rowIndex, '数据名称'),
        dataValue: readRequiredText(row, 4, rowIndex, '数据值'),
        note: readText(row, 5)
      }
    });
  });

  return rows;
}

/**
 * 按用例编号关联三张工作表。
 */
function joinImportRows(
  caseRows: Array<RowItem<ImportCaseSource>>,
  stepRows: Array<RowItem<ImportStepSource>>,
  dataRows: Array<RowItem<ImportDataSource>>
): ParsedImportCase[] {
  const caseNos = new Set(caseRows.map((row) => row.value.caseNo));

  assertKnownCaseRows(stepRows, caseNos, '步骤明细');
  assertKnownCaseRows(dataRows, caseNos, '测试数据');

  return caseRows.map((caseRow) => {
    const steps = stepRows.filter((row) => row.value.caseNo === caseRow.value.caseNo).sort((a, b) => a.value.stepNo - b.value.stepNo);
    const data = dataRows.filter((row) => row.value.caseNo === caseRow.value.caseNo);

    assertStepOrder(caseRow.value.caseNo, steps.map((row) => row.value));
    assertDataKeys(caseRow.value.caseNo, steps.map((row) => row.value), data.map((row) => row.value));

    return {
      caseInfo: caseRow.value,
      steps: steps.map((row) => row.value),
      data: data.map((row) => row.value),
      rowRefs: {
        caseRow: caseRow.rowIndex,
        stepRows: steps.map((row) => row.rowIndex),
        dataRows: data.map((row) => row.rowIndex)
      }
    };
  });
}

/**
 * 校验步骤和数据引用的用例编号存在。
 */
function assertKnownCaseRows<T extends { caseNo: string }>(rows: Array<RowItem<T>>, caseNos: Set<string>, sheetName: string) {
  for (const row of rows) {
    if (!caseNos.has(row.value.caseNo)) {
      throw badRequest(`${sheetName}第 ${row.rowIndex} 行引用的用例编号不存在：${row.value.caseNo}`);
    }
  }
}

/**
 * 校验步骤序号从 1 连续递增。
 */
function assertStepOrder(caseNo: string, steps: ImportStepSource[]) {
  if (steps.length === 0) {
    throw badRequest(`用例 ${caseNo} 缺少步骤明细`);
  }

  for (const [index, step] of steps.entries()) {
    // Excel 面向测试人员，步骤序号必须从 1 开始连续，避免 AI 输入顺序含糊。
    if (step.stepNo !== index + 1) {
      throw badRequest(`用例 ${caseNo} 的步骤序号必须从 1 连续递增`);
    }
  }
}

/**
 * 校验步骤数据引用在测试数据中存在。
 */
function assertDataKeys(caseNo: string, steps: ImportStepSource[], data: ImportDataSource[]) {
  const keys = new Set(data.map((row) => row.dataKey));

  for (const step of steps) {
    for (const key of step.dataKeys) {
      if (!keys.has(key)) {
        throw badRequest(`用例 ${caseNo} 的数据引用不存在：${key}`);
      }
    }
  }
}

/**
 * 读取指定工作表。
 */
function getSheet(workbook: ExcelJS.Workbook, name: string) {
  const sheet = workbook.getWorksheet(name);

  if (!sheet) {
    throw badRequest(`缺少工作表：${name}`);
  }

  return sheet;
}

/**
 * 判断 Excel 行是否为空。
 */
function isBlankRow(row: ExcelJS.Row) {
  return [1, 2, 3, 4, 5, 6].every((index) => !readText(row, index));
}

/**
 * 读取必填文本单元格。
 */
function readRequiredText(row: ExcelJS.Row, cellIndex: number, rowIndex: number, label: string) {
  const text = readText(row, cellIndex);

  if (!text) {
    throw badRequest(`第 ${rowIndex} 行${label}不能为空`);
  }

  return text;
}

/**
 * 读取必填整数单元格。
 */
function readRequiredInt(row: ExcelJS.Row, cellIndex: number, rowIndex: number, label: string) {
  const text = readRequiredText(row, cellIndex, rowIndex, label);
  const value = Number(text);

  if (!Number.isInteger(value) || value <= 0) {
    throw badRequest(`第 ${rowIndex} 行${label}必须是正整数`);
  }

  return value;
}

/**
 * 读取数据引用列表。
 */
function readDataKeys(row: ExcelJS.Row, cellIndex: number) {
  return readText(row, cellIndex)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * 读取单元格文本。
 */
function readText(row: ExcelJS.Row, cellIndex: number) {
  const value = row.getCell(cellIndex).value;

  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'object' && 'text' in value && typeof value.text === 'string') {
    return value.text.trim();
  }

  return String(value).trim();
}
