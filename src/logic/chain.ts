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

import type { AppState, ChainView } from '../types';

/** 从事件历史派生某条链的当前视图。 */
export function computeChain(s: AppState, chainId: string): ChainView | null {
  const meta = s.chains[chainId];
  if (!meta) return null;

  const evs = s.events.filter((e) => e.chain === chainId);
  const empty: ChainView = {
    id: chainId, name: meta.name, length: 0, activeSince: null, totalDone: 0, lastFailAt: null,
  };
  if (evs.length === 0) return empty;

  // 1) 活跃态：最后一条结算类事件（trigger/done/fail）若是 trigger → 进行中
  let activeSince: number | null = null;
  for (let i = evs.length - 1; i >= 0; i--) {
    const t = evs[i].type;
    if (t === 'trigger' || t === 'done' || t === 'fail') {
      activeSince = t === 'trigger' ? evs[i].ts : null;
      break;
    }
  }

  // 2) 当前链长：倒序数 done，遇到最近一次 fail 即止（fail 后的 done 才算本链）
  let length = 0;
  for (let i = evs.length - 1; i >= 0; i--) {
    if (evs[i].type === 'fail') break;
    if (evs[i].type === 'done') length += 1;
  }

  // 3) 全量统计：历史总节点（含被清零的）与最近一次 fail
  let totalDone = 0;
  let lastFailAt: number | null = null;
  for (const e of evs) {
    if (e.type === 'done') totalDone += 1;
    if (e.type === 'fail') lastFailAt = e.ts; // 正序扫，最后的覆盖即最近
  }

  return { id: chainId, name: meta.name, length, activeSince, totalDone, lastFailAt };
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
