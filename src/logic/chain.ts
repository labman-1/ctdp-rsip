// ─────────────────────────────────────────────────────────────
// chain.ts — 链规则纯函数（协议 "C1 主链定义" 的代码化）
//
// 协议 → 规则映射：
//   trigger：触发后进入专注态（activeSince），结算前不许再触发
//   done   ：结算一次专注，当前链长 +1
//   fail   ：判失败，链清零；历史 done 仍计入 totalDone（内化进度不丢失）
//   verdict：判允许，登记判例，链状态不变
//   booking：预约信号，仅记账（v1.1 才做倒计时约束）
//
// 实现说明：三遍独立扫描，各答一个问题（活跃态 / 当前链长 / 全量统计）。
// 事件量级是"每天几条"，性能无关紧要，直白优先。
// ─────────────────────────────────────────────────────────────

import type { AppState, ChainView, EventType } from '../types';

/** 预约链参数：正式窗口 15 分钟（协议），宽限 5 分钟（缓冲实现细节） */
export const BOOKING_WINDOW_MS = 15 * 60 * 1000;
export const BOOKING_GRACE_MS = 5 * 60 * 1000;

/** 预约链（id 形如 "C1预约"）的事件归一化：booking 在预约链上视同 trigger */
function normalizeType(chainId: string, type: EventType): EventType {
  return chainId.endsWith('预约') && type === 'booking' ? 'trigger' : type;
}

/** 从事件历史派生某条链的当前视图。 */
export function computeChain(s: AppState, chainId: string): ChainView | null {
  const meta = s.chains[chainId];
  if (!meta) return null;

  const evs = s.events.filter((e) => e.chain === chainId);
  const empty: ChainView = {
    id: chainId, name: meta.name, length: 0, activeSince: null, totalDone: 0, scoutCount: 0, lastFailAt: null,
  };
  if (evs.length === 0) return empty;

  // 1) 活跃态：最后一条结算类事件（trigger/done/fail，booking 在预约链上归一化为 trigger）若是 trigger → 进行中
  let activeSince: number | null = null;
  for (let i = evs.length - 1; i >= 0; i--) {
    const t = normalizeType(chainId, evs[i].type);
    if (t === 'trigger' || t === 'done' || t === 'fail') {
      activeSince = t === 'trigger' ? evs[i].ts : null;
      break;
    }
  }

  // 2) 当前链长：倒序数 done，遇到最近一次 fail 即止
  let length = 0;
  for (let i = evs.length - 1; i >= 0; i--) {
    if (normalizeType(chainId, evs[i].type) === 'fail') break;
    if (normalizeType(chainId, evs[i].type) === 'done') length += 1;
  }

  // 3) 全量统计
  let totalDone = 0;
  let scoutCount = 0;
  let lastFailAt: number | null = null;
  for (const e of evs) {
    if (normalizeType(chainId, e.type) === 'done') totalDone += 1;
    if (e.type === 'scout') scoutCount += 1;
    if (normalizeType(chainId, e.type) === 'fail') lastFailAt = e.ts;
  }

  return { id: chainId, name: meta.name, length, activeSince, totalDone, scoutCount, lastFailAt };
}

/** 判例库：全部判允许的裁决，按时间正序 */
export function verdictList(s: AppState): Array<{ ts: number; text: string; chain?: string }> {
  return s.events
    .filter((e) => e.type === 'verdict' && e.verdictText)
    .map((e) => ({ ts: e.ts, text: e.verdictText as string, chain: e.chain }));
}

/** 防御：判定某链当前能否触发（要求 idle；链不存在则否） */
export function canTrigger(s: AppState, chainId: string): boolean {
  const v = computeChain(s, chainId);
  return v !== null && v.activeSince === null;
}

/** 预约状态机：none → booked(15min) → due(宽限5min) → overdue(强制裁决) */
export type BookingPhase = 'none' | 'booked' | 'due' | 'overdue';

export interface BookingView {
  phase: BookingPhase;
  bookingTs: number | null;
  deadline: number | null;
}

/**
 * 主链的预约状态。兑现 = 窗口内出现主链 trigger，或对预约链做出裁决（fail/verdict）。
 * 触发主链时由 UI 层同步追加预约链的 done 事件（见 main.ts 的双事件提交）。
 */
export function bookingState(s: AppState, mainChainId: string, now = Date.now()): BookingView {
  const bId = mainChainId + '预约';
  let lastBooking: number | null = null;
  let settled = false;
  for (const e of s.events) {
    if (e.chain === bId && e.type === 'booking') {
      lastBooking = e.ts;
      settled = false;
    } else if (lastBooking !== null && !settled) {
      if (e.chain === mainChainId && e.type === 'trigger' && e.ts <= lastBooking + BOOKING_WINDOW_MS) {
        settled = true; // 预约兑现
      } else if (e.chain === bId && (e.type === 'fail' || e.type === 'verdict')) {
        settled = true; // 已裁决（失约判失败 / 判允许）
      }
    }
  }
  if (lastBooking === null || settled) return { phase: 'none', bookingTs: null, deadline: null };
  const deadline = lastBooking + BOOKING_WINDOW_MS;
  if (now < deadline) return { phase: 'booked', bookingTs: lastBooking, deadline };
  if (now < deadline + BOOKING_GRACE_MS) return { phase: 'due', bookingTs: lastBooking, deadline };
  return { phase: 'overdue', bookingTs: lastBooking, deadline };
}
