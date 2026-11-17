/** CSV 单元格转义：双引号加倍，并阻止 Excel 将危险前缀当作公式 */
export function escapeCsvCell(value: unknown): string {
  const text = String(value ?? '')
  const safe = /^\s*[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}
