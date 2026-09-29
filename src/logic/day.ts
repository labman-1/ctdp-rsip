// 一天的边界：凌晨 4:00（二游式刷新）——凌晨睡的用户，00:30 的睡前评分
// 应归属"昨天"。所有按日计算（评分去重、国策凭证/配额）统一走此函数。

const DAY_BOUNDARY_MS = 4 * 3600 * 1000;

export function dayKey(ts: number): string {
  const d = new Date(ts - DAY_BOUNDARY_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
