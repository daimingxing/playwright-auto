/**
 * 生成安全的 TypeScript 字符串字面量。
 */
export function quoteText(value: string) {
  return JSON.stringify(value);
}
