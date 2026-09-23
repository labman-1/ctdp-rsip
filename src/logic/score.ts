// ─────────────────────────────────────────────────────────────
// score.ts — 睡前评分派生（协议 G1 国策）
// 锚点：1=后悔今天 / 3=平静 / 5=由衷满足
// ─────────────────────────────────────────────────────────────

import type { AppState } from '../types';

export interface ScoreEntry {
  ts: number;
  score: 1 | 2 | 3 | 4 | 5;
  note?: string;
}

export function scoreHistory(s: AppState): ScoreEntry[] {
  const out: ScoreEntry[] = [];
  for (const e of s.events) {
    if (e.type === 'score' && e.score !== undefined) {
      out.push({ ts: e.ts, score: e.score, note: e.note });
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
