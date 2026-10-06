// 一天的边界：凌晨 4:00（二游式刷新）——凌晨睡的用户，00:30 的睡前评分
// 应归属"昨天"。所有按日计算（评分去重、国策凭证/配额）统一走此函数。

const DAY_BOUNDARY_MS = 4 * 3600 * 1000;

export function dayKey(ts: number): string {
  const d = new Date(ts - DAY_BOUNDARY_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 两个时间戳之间的日历日差（b - a，"天"同样以 4:00 为界）。
 *  被动国策的存续区间计数用它：daysBetween(join, fail) = 含头不含尾的存续天数。 */
export function daysBetween(a: number, b: number): number {
  const parse = (k: string) => Date.UTC(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)));
  return Math.round((parse(dayKey(b)) - parse(dayKey(a))) / 86400000);
}
