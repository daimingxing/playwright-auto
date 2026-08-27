import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { importActionTypes } from '../../shared/types';
import { parseImportExcel } from '../../server/src/services/import/import-excel';

describe('AI 导入 Excel 模板', () => {
  it('动作类型使用单元格下拉，工作簿只有用例和步骤两张表', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile('docs/templates/ai-import-template.xlsx');
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const parsed = await parseImportExcel(buffer);
    const stepSheet = workbook.getWorksheet('步骤') as
      | (ExcelJS.Worksheet & {
          dataValidations: {
            model: Record<string, { type?: string; formulae?: string[]; allowBlank?: boolean }>;
          };
        })
      | undefined;
    const validations = stepSheet?.dataValidations.model ?? {};
    const sheetNames = workbook.worksheets.map((sheet) => sheet.name);

    expect(parsed.ok).toBe(true);
    expect(sheetNames).toEqual(['用例', '步骤']);
    expect(validations.C2?.type).toBe('list');
    expect(validations.C2?.formulae?.[0]).toBe(`"${importActionTypes.join(',')}"`);
    expect(validations.C2?.allowBlank).toBe(true);
    expect(validations.C44?.type).toBe('list');
  });
});
