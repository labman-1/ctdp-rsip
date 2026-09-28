// ─────────────────────────────────────────────────────────────
// policy.ts — 国策树派生纯函数（RSIP 力学结构的代码化）
//
// 协议 → 规则映射：
//   policy_hand 隐含于 state.policies 定义（入手牌库不走事件）
//   policy_join   ：上树，前置 = 当日凭证（该国策今日有 done）+ 全局每日配额 1
//   policy_done   ：当日执行成功（凭证 + 内化天数，按自然日去重，崩塌不清零）
//   policy_fail   ：堆栈熄灭——该节点连同全部活树子孙回手牌，父子关系当场解除
//   policy_revive ：从手牌重上（占配额，parent 只能是当前叶子或独立根——末梢原则）
//   policy_upgrade：lv 变更历史（当前值在 state.policies）
//
// 一切从事件派生：手牌/树结构/存活态/天数/凭证/配额，不存派生值。
// fail 连坐按"事件发生时的树结构"计算（正序扫描中维护父子边）。
// ─────────────────────────────────────────────────────────────

import type { AppState } from '../types';

export interface PolicyNode {
  id: string;
  parent: string | null;      // 最近一次 join/revive 的父（手牌期为 null）
  alive: boolean;             // 在活树上
  onTreeSince: number | null; // 最近一次上树时间
  /** 内化进度条：累计执行天数（自然日去重，崩塌不清零，手牌期执行同样计入） */
  daysTotal: number;
  /** 今日是否已结算（凭证存在） */
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

function dayKey(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function policyView(s: AppState, now = Date.now()): PolicyView {
  const today = dayKey(now);
  const nodes: Record<string, PolicyNode> = {};
  for (const id of Object.keys(s.policies)) {
    nodes[id] = { id, parent: null, alive: false, onTreeSince: null, daysTotal: 0, doneToday: false, children: [] };
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
        n.parent = e.parent ?? null;
        n.alive = true;
        n.onTreeSince = e.ts;
        if (n.parent && nodes[n.parent]) nodes[n.parent].children.push(e.policyId);
        if (dayKey(e.ts) === today) joinsToday += 1;
        break;
      }
      case 'policy_done': {
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

/** 凭证制 + 配额：某国策当前能否上树/复活 */
export function canJoin(view: PolicyView, id: string): { ok: boolean; reason?: string } {
  const n = view.nodes[id];
  if (!n) return { ok: false, reason: '国策不存在' };
  if (n.alive) return { ok: false, reason: '已在树上' };
  if (!n.doneToday) return { ok: false, reason: '缺少当日凭证：先在今日结算中标记执行成功' };
  if (view.joinsToday >= 1) return { ok: false, reason: '今日配额已用（每天最多添加一个）' };
  return { ok: true };
}

/** 末梢原则：复活/上树时，父节点只能是当前的叶子（或独立根） */
export function isLeaf(view: PolicyView, id: string): boolean {
  return (view.nodes[id]?.children.length ?? 0) === 0;
}
