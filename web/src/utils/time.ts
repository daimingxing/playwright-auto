/**
 * 将时间字符串格式化为 `YYYY-MM-DD HH:MM:SS`。
 */
export function formatDateTime(value?: string) {
  if (!value) {
    return "-";
  }

  // 优先按接口返回的 ISO 字符串直接截取，避免 `Z` 结尾被浏览器自动换算成本地时区后改变展示值。
  const isoMatch = value.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2}:\d{2})/);

  if (isoMatch) {
    return `${isoMatch[1]} ${isoMatch[2]}`;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}
