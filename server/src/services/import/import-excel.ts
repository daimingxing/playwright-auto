import ExcelJS from 'exceljs';
import { stepTypes, targetTypes, type ImportCaseSource, type ImportDataSource, type ImportStepSource } from '../../../../shared/types';
import { badRequest } from '../../lib/http-error';

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

interface SheetHead {
  sheet: ExcelJS.Worksheet;
  columns: Map<string, number>;
}

const caseCols = ['用例编号', '用例名称', '目标页面URL', '前置条件', '预期结果', '备注'] as const;
const newStepCols = ['用例编号', '步骤序号', '动作类型', '目标类型', '目标名称', '输入/期望值', '匹配方式', '备注'] as const;
const newOnlyCols = ['动作类型', '目标类型', '目标名称', '输入/期望值', '匹配方式'] as const;
const oldStepCols = ['用例编号', '步骤序号', '操作描述', '目标对象', '数据引用', '备注'] as const;
const dataCols = ['用例编号', '数据标识', '数据名称', '数据值', '说明'] as const;

// 动作类型直接复用平台步骤枚举，避免导入侧产生执行器不认识的步骤类型。
// 目标类型来自共享枚举，当前只作为 AI 和后续页面地图的定位提示。
const matchTypes = ['contains', 'equals', 'regex'] as const;
// 匹配方式暂时对齐现有草稿步骤 MatchType，其他展示值留给后续任务扩展。

/**
 * 解析 AI 用例导入 Excel，优先使用新版两表模板，保留旧版三表兼容入口。
 */
export async function parseImportExcel(buffer: Buffer): Promise<ParsedImportCase[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

  if (hasNewSigns(workbook)) {
    return parseNewWorkbook(workbook);
  }

  if (hasOldTemplate(workbook)) {
    return parseOldWorkbook(workbook);
  }

  return parseNewWorkbook(workbook);
}

/**
 * 解析新版两表工作簿。
 */
function parseNewWorkbook(workbook: ExcelJS.Workbook) {
  const caseRows = readCaseSheet(workbook, '新版两表', false);
  const stepRows = readNewSteps(workbook);

  return joinImportRows(caseRows, stepRows, [], false);
}

/**
 * 解析旧版三表工作簿。
 */
function parseOldWorkbook(workbook: ExcelJS.Workbook) {
  const caseRows = readCaseSheet(workbook, '旧版三表', true);
  const stepRows = readOldSteps(workbook);
  const dataRows = readDataSheet(workbook);

  return joinImportRows(caseRows, stepRows, dataRows, true);
}

/**
 * 读取用例清单工作表。
 */
function readCaseSheet(workbook: ExcelJS.Workbook, mode: string, needExpected: boolean) {
  const head = getHead(workbook, '用例清单', caseCols, mode);
  const rows: Array<RowItem<ImportCaseSource>> = [];
  const caseNos = new Set<string>();

  head.sheet.eachRow((row, rowIndex) => {
    if (isHeadRow(rowIndex) || isBlankRow(row, head.columns)) {
      return;
    }

    const value: ImportCaseSource = {
      caseNo: readRequiredText(row, head.columns, '用例编号', rowIndex, '用例清单'),
      caseName: readRequiredText(row, head.columns, '用例名称', rowIndex, '用例清单'),
      targetUrl: readRequiredText(row, head.columns, '目标页面URL', rowIndex, '用例清单'),
      precondition: readNamedText(row, head.columns, '前置条件'),
      expectedResult: needExpected
        ? readRequiredText(row, head.columns, '预期结果', rowIndex, '用例清单')
        // 新版两表把整体预期结果改为可选，空值保留为空字符串。
        : readNamedText(row, head.columns, '预期结果'),
      note: readNamedText(row, head.columns, '备注')
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
 * 读取新版两表的步骤明细工作表。
 */
function readNewSteps(workbook: ExcelJS.Workbook) {
  const head = getHead(workbook, '步骤明细', newStepCols, '新版两表');
  const rows: Array<RowItem<ImportStepSource>> = [];

  head.sheet.eachRow((row, rowIndex) => {
    if (isHeadRow(rowIndex) || isBlankRow(row, head.columns)) {
      return;
    }

    const actionText = readRequiredText(row, head.columns, '动作类型', rowIndex, '步骤明细');
    const targetText = readRequiredText(row, head.columns, '目标类型', rowIndex, '步骤明细');
    const matchText = readNamedText(row, head.columns, '匹配方式');

    const value: ImportStepSource = {
      caseNo: readRequiredText(row, head.columns, '用例编号', rowIndex, '步骤明细'),
      stepNo: readRequiredInt(row, head.columns, '步骤序号', rowIndex, '步骤明细'),
      actionType: readEnum(actionText, stepTypes, rowIndex, '动作类型'),
      targetType: readEnum(targetText, targetTypes, rowIndex, '目标类型'),
      targetName: readRequiredText(row, head.columns, '目标名称', rowIndex, '步骤明细'),
      inputValue: readNamedText(row, head.columns, '输入/期望值'),
      actionText,
      targetText,
      // 新版两表取消测试数据工作表，保留空数组只为兼容后续旧字段读取。
      dataKeys: [],
      note: readNamedText(row, head.columns, '备注')
    };

    if (matchText) {
      value.matchType = readEnum(matchText, matchTypes, rowIndex, '匹配方式');
    }

    rows.push({
      rowIndex,
      value
    });
  });

  return rows;
}

/**
 * 读取旧版三表的步骤明细工作表。
 */
function readOldSteps(workbook: ExcelJS.Workbook) {
  const head = getHead(workbook, '步骤明细', oldStepCols, '旧版三表');
  const rows: Array<RowItem<ImportStepSource>> = [];

  head.sheet.eachRow((row, rowIndex) => {
    if (isHeadRow(rowIndex) || isBlankRow(row, head.columns)) {
      return;
    }

    rows.push({
      rowIndex,
      value: {
        caseNo: readRequiredText(row, head.columns, '用例编号', rowIndex, '步骤明细'),
        stepNo: readRequiredInt(row, head.columns, '步骤序号', rowIndex, '步骤明细'),
        actionText: readRequiredText(row, head.columns, '操作描述', rowIndex, '步骤明细'),
        targetText: readNamedText(row, head.columns, '目标对象'),
        dataKeys: readDataKeys(row, head.columns, '数据引用'),
        note: readNamedText(row, head.columns, '备注')
      }
    });
  });

  return rows;
}

/**
 * 读取测试数据工作表。
 */
function readDataSheet(workbook: ExcelJS.Workbook) {
  const head = getHead(workbook, '测试数据', dataCols, '旧版三表');
  const rows: Array<RowItem<ImportDataSource>> = [];

  head.sheet.eachRow((row, rowIndex) => {
    if (isHeadRow(rowIndex) || isBlankRow(row, head.columns)) {
      return;
    }

    rows.push({
      rowIndex,
      value: {
        caseNo: readRequiredText(row, head.columns, '用例编号', rowIndex, '测试数据'),
        dataKey: readRequiredText(row, head.columns, '数据标识', rowIndex, '测试数据'),
        dataName: readRequiredText(row, head.columns, '数据名称', rowIndex, '测试数据'),
        dataValue: readRequiredText(row, head.columns, '数据值', rowIndex, '测试数据'),
        note: readNamedText(row, head.columns, '说明')
      }
    });
  });

  return rows;
}

/**
 * 按用例编号关联导入工作表。
 */
function joinImportRows(
  caseRows: Array<RowItem<ImportCaseSource>>,
  stepRows: Array<RowItem<ImportStepSource>>,
  dataRows: Array<RowItem<ImportDataSource>>,
  checkData: boolean
): ParsedImportCase[] {
  const caseNos = new Set(caseRows.map((row) => row.value.caseNo));

  assertKnownRows(stepRows, caseNos, '步骤明细');
  assertKnownRows(dataRows, caseNos, '测试数据');

  return caseRows.map((caseRow) => {
    const steps = stepRows.filter((row) => row.value.caseNo === caseRow.value.caseNo).sort((a, b) => a.value.stepNo - b.value.stepNo);
    const data = dataRows.filter((row) => row.value.caseNo === caseRow.value.caseNo);

    assertStepOrder(caseRow.value.caseNo, steps.map((row) => row.value));

    if (checkData) {
      assertDataKeys(caseRow.value.caseNo, steps.map((row) => row.value), data.map((row) => row.value));
    }

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
 * 判断是否应走旧版三表兼容解析。
 */
function hasOldTemplate(workbook: ExcelJS.Workbook) {
  // 旧版三表只能在完全没有新版专属列时兜底，避免半新版模板被旧兼容逻辑吞掉。
  return Boolean(workbook.getWorksheet('测试数据') && hasStepCols(workbook, oldStepCols));
}

/**
 * 判断步骤明细是否出现新版专属列。
 */
function hasNewSigns(workbook: ExcelJS.Workbook) {
  // 任一新版专属列表明用户正在使用新版模板，缺列错误应由新版 getHead 明确抛出。
  return hasAnyStepCol(workbook, newOnlyCols);
}

/**
 * 判断步骤明细是否包含指定模板列集合。
 */
function hasStepCols(workbook: ExcelJS.Workbook, labels: readonly string[]) {
  const stepSheet = workbook.getWorksheet('步骤明细');

  if (!stepSheet) {
    return false;
  }

  const head = readColumns(stepSheet);

  return labels.every((label) => head.has(label));
}

/**
 * 判断步骤明细是否包含任意指定列。
 */
function hasAnyStepCol(workbook: ExcelJS.Workbook, labels: readonly string[]) {
  const stepSheet = workbook.getWorksheet('步骤明细');

  if (!stepSheet) {
    return false;
  }

  const head = readColumns(stepSheet);

  return labels.some((label) => head.has(label));
}

/**
 * 校验步骤和数据引用的用例编号存在。
 */
function assertKnownRows<T extends { caseNo: string }>(rows: Array<RowItem<T>>, caseNos: Set<string>, sheetName: string) {
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
 * 读取工作表和表头列号。
 */
function getHead(workbook: ExcelJS.Workbook, name: string, labels: readonly string[], mode: string): SheetHead {
  const sheet = workbook.getWorksheet(name);

  if (!sheet) {
    throw badRequest(`${mode}缺少工作表：${name}`);
  }

  const columns = readColumns(sheet);

  for (const label of labels) {
    if (!columns.has(label)) {
      throw badRequest(`${mode}${name}缺少必填列：${label}`);
    }
  }

  return { sheet, columns };
}

/**
 * 从首行读取表头列号。
 */
function readColumns(sheet: ExcelJS.Worksheet) {
  const columns = new Map<string, number>();
  const row = sheet.getRow(1);

  row.eachCell((cell, colNumber) => {
    const label = readCellText(cell);

    if (label) {
      columns.set(label, colNumber);
    }
  });

  return columns;
}

/**
 * 判断当前行是否为表头行。
 */
function isHeadRow(rowIndex: number) {
  // Excel 模板固定第 1 行为表头，数据行从第 2 行开始。
  return rowIndex === 1;
}

/**
 * 判断 Excel 行是否为空。
 */
function isBlankRow(row: ExcelJS.Row, columns: Map<string, number>) {
  return Array.from(columns.values()).every((index) => !readText(row, index));
}

/**
 * 读取必填文本单元格。
 */
function readRequiredText(row: ExcelJS.Row, columns: Map<string, number>, label: string, rowIndex: number, sheetName: string) {
  const text = readNamedText(row, columns, label);

  if (!text) {
    throw badRequest(`${sheetName}第 ${rowIndex} 行${label}不能为空`);
  }

  return text;
}

/**
 * 读取必填整数单元格。
 */
function readRequiredInt(row: ExcelJS.Row, columns: Map<string, number>, label: string, rowIndex: number, sheetName: string) {
  const text = readRequiredText(row, columns, label, rowIndex, sheetName);
  const value = Number(text);

  if (!Number.isInteger(value) || value <= 0) {
    throw badRequest(`${sheetName}第 ${rowIndex} 行${label}必须是正整数`);
  }

  return value;
}

/**
 * 读取枚举值，兼容中文(英文)和纯英文输入。
 */
function readEnum<T extends string>(text: string, values: readonly T[], rowIndex: number, label: string): T {
  const value = pickEnumText(text);

  // 枚举必须由平台白名单接收，不能把测试人员填写的任意英文透传给后续 AI 和执行器。
  if (!values.includes(value as T)) {
    throw badRequest(`步骤明细第 ${rowIndex} 行${label}不支持：${text}`);
  }

  return value as T;
}

/**
 * 提取中文展示值括号内的英文枚举。
 */
function pickEnumText(text: string) {
  const match = text.match(/[（(]\s*([^()（）]+?)\s*[）)]$/);

  // 兼容模板下拉值“中文(英文)”、全角括号、括号空格和自动化导出的纯英文枚举。
  return (match?.[1] ?? text).trim();
}

/**
 * 读取数据引用列表。
 */
function readDataKeys(row: ExcelJS.Row, columns: Map<string, number>, label: string) {
  return readNamedText(row, columns, label)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * 按表头名称读取单元格文本。
 */
function readNamedText(row: ExcelJS.Row, columns: Map<string, number>, label: string) {
  const index = columns.get(label);

  // 表头已由 getHead 校验；这里兜底返回空串，避免可选列未来调整时抛内部错误。
  return index ? readText(row, index) : '';
}

/**
 * 读取单元格文本。
 */
function readText(row: ExcelJS.Row, cellIndex: number) {
  return readCellText(row.getCell(cellIndex));
}

/**
 * 读取 ExcelJS 单元格文本。
 */
function readCellText(cell: ExcelJS.Cell) {
  const value = cell.value;

  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'object' && 'text' in value && typeof value.text === 'string') {
    return value.text.trim();
  }

  return String(value).trim();
}
