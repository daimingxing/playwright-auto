import ExcelJS from 'exceljs';
import {
  importActionTypes,
  type ImportActionType,
  type ImportExcelStep,
  type ImportParseError,
  type ImportParsedCase,
  type ImportSourceRow
} from '../../../../shared/types';

export const CASE_SHEET_NAME = '用例';
export const STEP_SHEET_NAME = '步骤';

export const CASE_COLUMNS = ['用例编号', '用例名称', '起始路径', '前置条件', '预期结果', '备注'] as const;
export const STEP_COLUMNS = ['用例编号', '步骤序号', '动作类型', '目标', '数据', '补充说明'] as const;

const CASE_REQUIRED_FIELDS = ['用例编号', '用例名称', '起始路径'] as const;

type HeaderMap = Map<string, number>;

export type ImportExcelParseResult =
  | { ok: true; cases: ImportParsedCase[] }
  | { ok: false; errors: ImportParseError[] };

/**
 * 解析 AI 导入双表 Excel。结构错误返回整批失败；内容错误隔离到单条用例。
 */
export async function parseImportExcel(buffer: Buffer): Promise<ImportExcelParseResult> {
  const workbook = new ExcelJS.Workbook();

  try {
    // exceljs 把 Buffer 声明成 ArrayBuffer 子类型，与 Node 当前 Buffer 类型不兼容。
    await workbook.xlsx.load(buffer as unknown as Parameters<ExcelJS.Xlsx['load']>[0]);
  } catch {
    return {
      ok: false,
      errors: [{ sheet: '', row: 0, reason: '不是有效的 Excel 文件' }]
    };
  }

  const caseSheet = workbook.getWorksheet(CASE_SHEET_NAME);
  const stepSheet = workbook.getWorksheet(STEP_SHEET_NAME);
  const structureErrors: ImportParseError[] = [];

  if (!caseSheet) {
    structureErrors.push({ sheet: CASE_SHEET_NAME, row: 0, reason: '缺少工作表「用例」' });
  }

  if (!stepSheet) {
    structureErrors.push({ sheet: STEP_SHEET_NAME, row: 0, reason: '缺少工作表「步骤」' });
  }

  if (!caseSheet || !stepSheet) {
    return { ok: false, errors: structureErrors };
  }

  const caseHeaders = readHeaderMap(caseSheet);
  const stepHeaders = readHeaderMap(stepSheet);
  structureErrors.push(...validateHeaders(CASE_SHEET_NAME, caseHeaders, CASE_COLUMNS));
  structureErrors.push(...validateHeaders(STEP_SHEET_NAME, stepHeaders, STEP_COLUMNS));

  if (structureErrors.length > 0) {
    return { ok: false, errors: structureErrors };
  }

  const caseRows = readSheetRows(caseSheet, caseHeaders, CASE_COLUMNS);
  const stepRows = readSheetRows(stepSheet, stepHeaders, STEP_COLUMNS);

  if (caseRows.length === 0 && stepRows.length === 0) {
    return {
      ok: false,
      errors: [{ sheet: CASE_SHEET_NAME, row: 1, reason: '没有可导入的用例' }]
    };
  }

  return { ok: true, cases: buildParsedCases(caseRows, stepRows) };
}

/**
 * 读取表头列名到 Excel 列号的映射，并记录重复列。
 */
function readHeaderMap(sheet: ExcelJS.Worksheet): { columns: HeaderMap; duplicates: string[] } {
  const row = sheet.getRow(1);
  const columns: HeaderMap = new Map();
  const duplicates: string[] = [];
  const lastCol = Math.max(row.cellCount, 1);

  for (let col = 1; col <= lastCol; col += 1) {
    const name = cellToString(row.getCell(col).value);

    if (!name) {
      continue;
    }

    if (columns.has(name) || duplicates.includes(name)) {
      if (!duplicates.includes(name)) {
        duplicates.push(name);
      }

      continue;
    }

    columns.set(name, col);
  }

  return { columns, duplicates };
}

/**
 * 校验必填列是否齐全、是否出现重复列名。
 */
function validateHeaders(
  sheet: string,
  headers: { columns: HeaderMap; duplicates: string[] },
  required: readonly string[]
) {
  const errors: ImportParseError[] = [];

  for (const name of headers.duplicates) {
    errors.push({ sheet, row: 1, reason: `列「${name}」重复` });
  }

  for (const name of required) {
    if (!headers.columns.has(name)) {
      errors.push({ sheet, row: 1, reason: `缺少列「${name}」` });
    }
  }

  return errors;
}

interface SheetRow {
  row: number;
  cells: Record<string, string>;
}

/**
 * 读取数据行，跳过所有约定列均为空的行。
 */
function readSheetRows(sheet: ExcelJS.Worksheet, headers: { columns: HeaderMap }, columns: readonly string[]) {
  const rows: SheetRow[] = [];

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }

    const cells: Record<string, string> = {};

    for (const name of columns) {
      const col = headers.columns.get(name);
      cells[name] = col ? cellToString(row.getCell(col).value) : '';
    }

    if (columns.every((name) => !cells[name])) {
      return;
    }

    rows.push({ row: rowNumber, cells });
  });

  return rows;
}

/**
 * 把用例行和步骤行组装成逐条解析结果，内容错误只影响对应用例。
 */
function buildParsedCases(caseRows: SheetRow[], stepRows: SheetRow[]): ImportParsedCase[] {
  const caseNumberCounts = countCaseNumbers(caseRows);
  const stepGroups = groupStepRows(stepRows);
  const seenCaseNumbers = new Set<string>();
  const cases: ImportParsedCase[] = [];

  for (const caseRow of caseRows) {
    const caseNumber = caseRow.cells['用例编号'] ?? '';
    const isFirst = caseNumber ? !seenCaseNumbers.has(caseNumber) : true;

    if (caseNumber) {
      seenCaseNumbers.add(caseNumber);
    }

    const stepSource = isFirst && caseNumber ? stepGroups.get(caseNumber) ?? [] : [];
    const parsedSteps = parseStepRows(caseNumber, stepSource);
    cases.push(buildCaseResult(caseRow, parsedSteps, caseNumberCounts, isFirst));
  }

  for (const [caseNumber, rows] of stepGroups) {
    if (seenCaseNumbers.has(caseNumber)) {
      continue;
    }

    const parsedSteps = parseStepRows(caseNumber, rows);
    const first = rows[0];
    const source = createSource(STEP_SHEET_NAME, first?.row ?? 0, caseNumber, first?.cells ?? {});
    const errors: ImportParseError[] = [
      {
        sheet: STEP_SHEET_NAME,
        row: first?.row ?? 0,
        caseNumber,
        reason: '用例表中不存在该用例编号',
        cells: first?.cells
      },
      ...parsedSteps.errors
    ];

    cases.push({
      caseNumber,
      name: '',
      startPath: '',
      preconditions: '',
      expected: '',
      remark: '',
      status: 'parse-failed',
      source,
      steps: parsedSteps.steps,
      errors
    });
  }

  return cases;
}

/**
 * 统计用例表中的用例编号出现次数，用于文件内唯一性校验。
 */
function countCaseNumbers(caseRows: SheetRow[]) {
  const counts = new Map<string, number>();

  for (const row of caseRows) {
    const caseNumber = row.cells['用例编号'] ?? '';

    if (!caseNumber) {
      continue;
    }

    counts.set(caseNumber, (counts.get(caseNumber) ?? 0) + 1);
  }

  return counts;
}

/**
 * 按用例编号分组步骤行；空编号单独成组，互不影响其它用例。
 */
function groupStepRows(stepRows: SheetRow[]) {
  const groups = new Map<string, SheetRow[]>();

  for (const row of stepRows) {
    const caseNumber = row.cells['用例编号'] ?? '';
    const key = caseNumber || `__empty_${row.row}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  return groups;
}

/**
 * 校验单条用例行，并合并其步骤错误。
 */
function buildCaseResult(
  caseRow: SheetRow,
  parsedSteps: { steps: ImportExcelStep[]; errors: ImportParseError[] },
  caseNumberCounts: Map<string, number>,
  attachSteps: boolean
): ImportParsedCase {
  const cells = caseRow.cells;
  const caseNumber = cells['用例编号'] ?? '';
  const source = createSource(CASE_SHEET_NAME, caseRow.row, caseNumber, cells);
  const errors: ImportParseError[] = [];

  for (const field of CASE_REQUIRED_FIELDS) {
    if (!cells[field]) {
      errors.push(createRowError(CASE_SHEET_NAME, caseRow.row, caseNumber, `${field}不能为空`, cells));
    }
  }

  if (caseNumber && (caseNumberCounts.get(caseNumber) ?? 0) > 1) {
    errors.push(createRowError(CASE_SHEET_NAME, caseRow.row, caseNumber, '用例编号在文件内重复', cells));
  }

  const startPath = cells['起始路径'] ?? '';

  if (startPath && !isRelativePath(startPath)) {
    errors.push(createRowError(CASE_SHEET_NAME, caseRow.row, caseNumber, '起始路径必须是相对路径，不能填写环境地址', cells));
  }

  if (attachSteps && parsedSteps.steps.length === 0 && parsedSteps.errors.length === 0) {
    errors.push(createRowError(CASE_SHEET_NAME, caseRow.row, caseNumber, '没有关联步骤', cells));
  }

  if (attachSteps) {
    errors.push(...parsedSteps.errors);
  }

  return {
    caseNumber,
    name: cells['用例名称'] ?? '',
    startPath,
    preconditions: cells['前置条件'] ?? '',
    expected: cells['预期结果'] ?? '',
    remark: cells['备注'] ?? '',
    status: errors.length > 0 ? 'parse-failed' : 'parsed',
    source,
    steps: attachSteps ? parsedSteps.steps : [],
    errors
  };
}

/**
 * 解析同一用例下的步骤行，非法枚举、空值和序号问题记为该用例的内容错误。
 */
function parseStepRows(caseNumber: string, rows: SheetRow[]) {
  const steps: ImportExcelStep[] = [];
  const errors: ImportParseError[] = [];
  const orderCount = new Map<number, number>();

  for (const row of rows) {
    const order = parseStepOrder(row.cells['步骤序号'] ?? '');

    if (order != null) {
      orderCount.set(order, (orderCount.get(order) ?? 0) + 1);
    }
  }

  for (const row of rows) {
    const cells = row.cells;
    const rowCaseNumber = cells['用例编号'] ?? '';
    const actionRaw = cells['动作类型'] ?? '';
    const target = cells['目标'] ?? '';
    const data = cells['数据'] ?? '';
    const note = cells['补充说明'] ?? '';
    const orderRaw = cells['步骤序号'] ?? '';
    const order = parseStepOrder(orderRaw);
    const rowErrors: ImportParseError[] = [];

    if (!rowCaseNumber) {
      rowErrors.push(createRowError(STEP_SHEET_NAME, row.row, caseNumber, '用例编号不能为空', cells));
    }

    if (!orderRaw) {
      rowErrors.push(createRowError(STEP_SHEET_NAME, row.row, rowCaseNumber || caseNumber, '步骤序号不能为空', cells));
    } else if (order == null) {
      rowErrors.push(createRowError(STEP_SHEET_NAME, row.row, rowCaseNumber || caseNumber, '步骤序号必须是正整数', cells));
    } else if ((orderCount.get(order) ?? 0) > 1) {
      rowErrors.push(createRowError(STEP_SHEET_NAME, row.row, rowCaseNumber || caseNumber, '步骤序号在同一用例内重复', cells));
    }

    if (!actionRaw) {
      rowErrors.push(createRowError(STEP_SHEET_NAME, row.row, rowCaseNumber || caseNumber, '动作类型不能为空', cells));
    } else if (!isImportActionType(actionRaw)) {
      rowErrors.push(
        createRowError(
          STEP_SHEET_NAME,
          row.row,
          rowCaseNumber || caseNumber,
          `动作类型必须是：${importActionTypes.join('、')}`,
          cells
        )
      );
    }

    if (isImportActionType(actionRaw)) {
      rowErrors.push(...validateActionFields(row.row, rowCaseNumber || caseNumber, actionRaw, target, data, cells));
    } else if (!target) {
      rowErrors.push(createRowError(STEP_SHEET_NAME, row.row, rowCaseNumber || caseNumber, '目标不能为空', cells));
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      continue;
    }

    if (order == null || !isImportActionType(actionRaw)) {
      continue;
    }

    const source = createSource(STEP_SHEET_NAME, row.row, rowCaseNumber, cells);
    steps.push({
      order,
      action: actionRaw,
      target,
      data,
      note,
      source
    });
  }

  steps.sort((left, right) => left.order - right.order || left.source.row - right.source.row);
  return { steps, errors };
}

/**
 * 按动作类型校验目标和数据：填写/选择/检查文本需要数据，打开页面的目标必须是相对路径。
 */
function validateActionFields(
  row: number,
  caseNumber: string,
  action: ImportActionType,
  target: string,
  data: string,
  cells: Record<string, string>
) {
  const errors: ImportParseError[] = [];

  if (!target) {
    errors.push(createRowError(STEP_SHEET_NAME, row, caseNumber, '目标不能为空', cells));
  } else if (action === '打开页面' && !isRelativePath(target)) {
    errors.push(createRowError(STEP_SHEET_NAME, row, caseNumber, '打开页面的目标必须是相对路径，不能填写环境地址', cells));
  }

  if ((action === '填写' || action === '选择' || action === '检查文本') && !data) {
    errors.push(createRowError(STEP_SHEET_NAME, row, caseNumber, '数据不能为空', cells));
  }

  return errors;
}

/**
 * 判断是否为业务级封闭动作类型，不接受 Playwright 步骤类型或其它别名。
 */
function isImportActionType(value: string): value is ImportActionType {
  return (importActionTypes as readonly string[]).includes(value);
}

/**
 * 解析步骤序号，接受 Excel 整数和「1.0」形式，拒绝小数和文本。
 */
function parseStepOrder(raw: string) {
  const value = raw.trim();

  if (!/^\d+(\.0+)?$/.test(value)) {
    return null;
  }

  const order = Number(value);

  if (!Number.isInteger(order) || order < 1) {
    return null;
  }

  return order;
}

/**
 * 起始路径只允许相对路径，拒绝带协议或协议相对地址。
 */
function isRelativePath(value: string) {
  if (/^[a-zA-Z][a-zA-Z+\-.]*:/.test(value)) {
    return false;
  }

  return !value.startsWith('//');
}

/**
 * 把单元格值转成去掉首尾空白的文本。
 */
function cellToString(value: ExcelJS.CellValue) {
  if (value == null) {
    return '';
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : String(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('').trim();
    }

    if ('text' in value && typeof value.text === 'string') {
      return value.text.trim();
    }

    if ('result' in value) {
      return cellToString(value.result);
    }
  }

  return String(value).trim();
}

/**
 * 构造来源行引用。
 */
function createSource(sheet: string, row: number, caseNumber: string, cells: Record<string, string>): ImportSourceRow {
  return { sheet, row, caseNumber, cells };
}

/**
 * 构造带原始单元格的行级内容错误。
 */
function createRowError(
  sheet: string,
  row: number,
  caseNumber: string,
  reason: string,
  cells: Record<string, string>
): ImportParseError {
  return { sheet, row, caseNumber: caseNumber || undefined, reason, cells };
}
