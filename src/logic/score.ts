// ─────────────────────────────────────────────────────────────
// score.ts — 睡前评分派生（协议 G1 国策）
// 锚点：1=后悔今天 / 3=平静 / 5=由衷满足
// ─────────────────────────────────────────────────────────────

import type { AppState } from '../types';
import { dayKey } from './day';

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
  /** 次日补录的评分（时间戳已落在昨晚日界内） */
  backfill?: boolean;
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
      out.push({ ts: e.ts, score: v, note: e.note, backfill: e.backfill });
    }
  }
  return out;
}

/** 日 key 统一走 4:00 边界（凌晨睡的评分归属前一"天"），见 logic/day.ts */
export { dayKey } from './day';

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

// ── 补昨晚（backfill）：两段式漏评补救的后半段 ──
// 前半段在手机上：当场甩一行草稿。后半段在次日电脑上：窗口内补录，
// 时间戳落昨晚 23:30，事件带 backfill 标记，与当晚评分永久区分。

/** 补录窗口 = 今日 4:00–12:00：日界已翻篇（目标"昨晚"语义无歧义）、
 *  上午记忆尚新鲜；过午关闭（窗口无限大 = 事后补写，评分仪式名存实亡） */
export function backfillWindowOpen(now: number): boolean {
  const h = new Date(now).getHours();
  return h >= 4 && h < 12;
}

/** 可补录 = 窗口开 且 昨日 dayKey 无评分事件（防重复） */
export function canBackfillYesterday(s: AppState, now = Date.now()): boolean {
  if (!backfillWindowOpen(now)) return false;
  const yk = dayKey(now - 24 * 3600 * 1000);
  return !scoreHistory(s).some((e) => dayKey(e.ts) === yk);
}

/** 补录事件的时间戳落点：昨日 23:30（4:00 日界内，属昨日 dayKey） */
export function backfillTs(now: number): number {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  d.setHours(23, 30, 0, 0);
  return d.getTime();
}
