// ─────────────────────────────────────────────────────────────
// policy.ts — 国策树派生纯函数（RSIP 力学结构的代码化）
//
// 协议 → 规则映射：
//   policy_hand 隐含于 state.policies 定义（入手牌库不走事件）
//   policy_join   ：上树，前置 = 当日凭证（该国策今日有 done）+ 全局每日配额 1
//   policy_done   ：当日执行成功（凭证 + 内化天数，按自然日去重——凌晨 4:00 为日界，崩塌不清零）
//   policy_fail   ：堆栈熄灭——该节点连同全部活树子孙回手牌，父子关系当场解除
//   policy_revive ：从手牌重上（占配额，parent 只能是当前叶子或独立根——末梢原则）
//   policy_upgrade：lv 变更历史（当前值在 state.policies）
//
// 一切从事件派生：手牌/树结构/存活态/天数/凭证/配额，不存派生值。
// fail 连坐按"事件发生时的树结构"计算（正序扫描中维护父子边）。
// ─────────────────────────────────────────────────────────────

import type { AppState, PolicyKind } from '../types';
import { dayKey, daysBetween } from './day';

export interface PolicyNode {
  id: string;
  kind: PolicyKind;          // 定义副本：计数模型按类型分叉（见下）
  parent: string | null;      // 最近一次 join/revive 的父（手牌期为 null）
  alive: boolean;             // 在活树上
  onTreeSince: number | null; // 最近一次上树时间（熄灭不清空——main 以非空区分"曾上过树"）
  /** 内化进度条，按 kind 分两种计数模型：
   *  semi/active = done 事件按自然日去重（崩塌不清零，手牌期执行同样计入）；
   *  passive = 存续区间天数自动累计（[join, fail) 含头不含尾；在树段含头含尾）——
   *  被动国策无每日行为判定，"没有事件就没有判定"，不消费 done 事件。 */
  daysTotal: number;
  /** 今日是否已结算（凭证存在）；passive 恒 false 且无人消费 */
  doneToday: boolean;
  children: string[];
}

export interface PolicyView {
  nodes: Record<string, PolicyNode>;
  /** 活树上的根（parent = null 且 alive） */
  roots: string[];
  /** 手牌（有定义但不在活树上） */
  hand: string[];
  /** 今日 join+revive 次数（全局配额上限 1） */
  joinsToday: number;
}

export function policyView(s: AppState, now = Date.now()): PolicyView {
  const today = dayKey(now);
  const nodes: Record<string, PolicyNode> = {};
  for (const id of Object.keys(s.policies)) {
    nodes[id] = { id, kind: s.policies[id].kind, parent: null, alive: false, onTreeSince: null, daysTotal: 0, doneToday: false, children: [] };
  }
  const daySets = new Map<string, Set<string>>();
  let joinsToday = 0;

  const detach = (id: string) => {
    const n = nodes[id];
    if (!n) return;
    if (n.parent && nodes[n.parent]) {
      nodes[n.parent].children = nodes[n.parent].children.filter((c) => c !== id);
    }
    n.parent = null;
  };

  for (const e of s.events) {
    if (!e.policyId) continue;
    const n = nodes[e.policyId];
    if (!n) continue;
    switch (e.type) {
      case 'policy_join':
      case 'policy_revive': {
        detach(e.policyId); // 防御：重复上树先解除旧边
        // passive 防御清算：alive 仍为 true 的重复上树（缺对应 fail 的异常序列），
        // 先把上一段存续期入账再重置段起点（合法 revive 走过 fail，alive=false，不触发）
        if (n.kind === 'passive' && n.alive && n.onTreeSince !== null) {
          n.daysTotal += daysBetween(n.onTreeSince, e.ts);
        }
        n.parent = e.parent ?? null;
        n.alive = true;
        n.onTreeSince = e.ts;
        if (n.parent && nodes[n.parent]) nodes[n.parent].children.push(e.policyId);
        if (dayKey(e.ts) === today) joinsToday += 1;
        break;
      }
      case 'policy_done': {
        if (n.kind === 'passive') break; // 被动国策不消费日结算（历史手动 done 自然失效，区间计数接管）
        const set = daySets.get(e.policyId) ?? new Set<string>();
        const k = dayKey(e.ts);
        if (!set.has(k)) { set.add(k); n.daysTotal += 1; }
        daySets.set(e.policyId, set);
        if (k === today) n.doneToday = true;
        break;
      }
      case 'policy_fail': {
        // 堆栈熄灭：按当时的父子边传递，全部回手牌
        const stack: string[] = [e.policyId];
        while (stack.length > 0) {
          const cur = stack.pop() as string;
          const m = nodes[cur];
          if (!m) continue;
          detach(cur);
          m.alive = false;
          m.doneToday = false;
          // passive 清算当前存续段（[join, fail) 含头不含尾）；onTreeSince 故意不清——
          // 它兼作"曾上过树"标记（main 据此区分 revive）
          if (m.kind === 'passive' && m.onTreeSince !== null) {
            m.daysTotal += daysBetween(m.onTreeSince, e.ts);
          }
          stack.push(...m.children);
          m.children = [];
        }
        break;
      }
      default:
        break;
    }
  }

  const hand: string[] = [];
  const roots: string[] = [];
  for (const id of Object.keys(nodes)) {
    const n = nodes[id];
    // passive 当前段实时累计（含上树日与今日）——打开 App 即自动更新，无需任何事件
    if (n.kind === 'passive' && n.alive && n.onTreeSince !== null) {
      n.daysTotal += daysBetween(n.onTreeSince, now) + 1;
    }
    if (!n.alive) hand.push(id);
    else if (n.parent === null) roots.push(id);
  }
  return { nodes, roots, hand, joinsToday };
}

/** 堆栈熄灭的连坐清单：fail(id) 将熄灭的节点（含自身）——用于确认弹窗的威慑可视化 */
export function collapseList(view: PolicyView, id: string): string[] {
  const out: string[] = [];
  const walk = (pid: string) => {
    out.push(pid);
    for (const c of view.nodes[pid]?.children ?? []) walk(c);
  };
  walk(id);
  return out;
}

/** 凭证制 + 配额：某国策当前能否上树/复活。
 *  passive 免凭证（"做到"=机制配置完成，新建即成立）；全局每日配额对所有类型生效。 */
export function canJoin(view: PolicyView, id: string): { ok: boolean; reason?: string } {
  const n = view.nodes[id];
  if (!n) return { ok: false, reason: '国策不存在' };
  if (n.alive) return { ok: false, reason: '已在树上' };
  if (n.kind !== 'passive' && !n.doneToday) return { ok: false, reason: '缺少当日凭证：先在今日结算中标记执行成功' };
  if (view.joinsToday >= 1) return { ok: false, reason: '今日配额已用（每天最多添加一个）' };
  return { ok: true };
}

/** 末梢原则：复活/上树时，父节点只能是当前的叶子（或独立根） */
export function isLeaf(view: PolicyView, id: string): boolean {
  return (view.nodes[id]?.children.length ?? 0) === 0;
}
