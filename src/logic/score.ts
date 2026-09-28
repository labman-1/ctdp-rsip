// ─────────────────────────────────────────────────────────────
// score.ts — 睡前评分派生（协议 G1 国策）
// 锚点：1=后悔今天 / 3=平静 / 5=由衷满足
// ─────────────────────────────────────────────────────────────

import type { AppState } from '../types';

/** 0-10 分制锚点（2026-09-28 G1 修订：原 1/3/5 锚点按语义映射为 2/5/8）——评分刻度的唯一事实源 */
export const SCORE_ANCHORS: Record<number, string> = {
  2: '后悔今天',
  5: '平静',
  8: '由衷满足',
};

export interface ScoreEntry {
  ts: number;
  score: number; // 统一为 0-10 分制视图
  note?: string;
}

/** 旧 5 分制 → 新 10 分制的锚点语义映射：1→2（后悔）、3→5（平静）、5→8（满足），线性插值对齐 0.5 步进 */
export function legacyTo10(old: number): number {
  return Math.round(((old - 1) * 1.5 + 2) * 2) / 2;
}

export function scoreHistory(s: AppState): ScoreEntry[] {
  const out: ScoreEntry[] = [];
  for (const e of s.events) {
    if (e.type === 'score' && e.score !== undefined) {
      const v = e.scale === 10 ? e.score : legacyTo10(e.score);
      out.push({ ts: e.ts, score: v, note: e.note });
    }
  }
  return out;
}

/** 当地时区的自然日 key（YYYY-MM-DD），评分按自然日去重提示 */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function todayScore(s: AppState, now = Date.now()): ScoreEntry | null {
  const today = dayKey(now);
  let found: ScoreEntry | null = null;
  for (const e of scoreHistory(s)) {
    if (dayKey(e.ts) === today) found = e; // 同日多次评分取最后一次
  }
  return found;
}

/** 最近 7 天（含今日）的均分，无数据返回 null */
export function averageLast7(s: AppState, now = Date.now()): number | null {
  const cutoff = now - 7 * 24 * 3600 * 1000;
  const list = scoreHistory(s).filter((e) => e.ts >= cutoff);
  if (list.length === 0) return null;
  return list.reduce((acc, e) => acc + e.score, 0) / list.length;
}
