import { describe, expect, it } from 'vitest';
import { quoteText } from '../../server/src/services/case/code-literal';

describe('代码字面量工具', () => {
  it('生成合法 TypeScript 字符串字面量', () => {
    expect(quoteText("You're logged in")).toBe("\"You're logged in\"");
    expect(quoteText('第一行\n第二行')).toBe('"第一行\\n第二行"');
    expect(quoteText('C:\\tmp\\case')).toBe('"C:\\\\tmp\\\\case"');
  });
});
